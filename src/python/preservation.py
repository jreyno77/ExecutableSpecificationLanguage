"""Lossless edits to explicitly identified declarations; no file writes or application execution."""
import ast
import libcst as cst
from libcst.metadata import MetadataWrapper, PositionProvider


def selector(artifact):
    return tuple((part["kind"], part["name"]) for part in artifact["locator"]["value"]["declaration"])


def associations(items):
    counts, found = {}, {}
    for item in items:
        identity = item["specId"]
        ordinal = counts.get(identity, 0)
        counts[identity] = ordinal + 1
        found[(identity, ordinal)] = item
    return found


def declarations(module):
    found, scope = {}, []

    def record(key, node):
        found[key] = None if key in found else node

    class Index(cst.CSTVisitor):
        def visit_ClassDef(self, node):
            scope.append(("class", node.name.value)); record(tuple(scope), node)

        def leave_ClassDef(self, node):
            scope.pop()

        def visit_FunctionDef(self, node):
            scope.append(("method" if scope and scope[-1][0] == "class" else "function", node.name.value))
            record(tuple(scope), node)

        def leave_FunctionDef(self, node):
            scope.pop()

        def visit_Param(self, node):
            record(tuple(scope) + (("parameter", node.name.value),), node)

        def visit_AnnAssign(self, node):
            if isinstance(node.target, cst.Name):
                for kind in ("field", "type"):
                    record(tuple(scope) + ((kind, node.target.value),), node)

    module.visit(Index())
    return found


def contract(node):
    if isinstance(node, (cst.ClassDef, cst.FunctionDef)):
        node = node.with_changes(body=cst.IndentedBlock([cst.SimpleStatementLine([cst.Pass()])]), decorators=[], leading_lines=[])
    elif isinstance(node, cst.AnnAssign):
        node = cst.SimpleStatementLine([node.with_changes(value=None)])
    tree = ast.parse(cst.Module([]).code_for_node(node))
    for item in ast.walk(tree):
        if isinstance(item, ast.arguments):
            item.defaults = [ast.Constant(None) for _ in item.defaults]
            item.kw_defaults = [ast.Constant(None) if value is not None else None for value in item.kw_defaults]
    return ast.dump(tree, include_attributes=False)


def signature(current, wanted):
    def annotation(current, wanted):
        return current.with_changes(annotation=wanted.annotation) if current and wanted else wanted

    previous = {}
    fields = ("posonly_params", "params", "kwonly_params", "star_arg", "star_kwarg")
    for field in fields:
        value = getattr(current.params, field)
        for parameter in value if isinstance(value, (tuple, list)) else [value]:
            if isinstance(parameter, cst.Param):
                previous[parameter.name.value] = parameter

    def parameter(wanted):
        old = previous.get(wanted.name.value) if isinstance(wanted, cst.Param) else None
        return old.with_changes(annotation=annotation(old.annotation, wanted.annotation),
                                default=old.default if old.default is not None else wanted.default) if old else wanted

    changes = {field: [parameter(value) for value in getattr(wanted.params, field)]
               if isinstance(getattr(wanted.params, field), (tuple, list)) else parameter(getattr(wanted.params, field)) for field in fields}
    return current.with_changes(name=current.name.with_changes(value=wanted.name.value),
                                params=current.params.with_changes(**changes, posonly_ind=wanted.params.posonly_ind),
                                returns=annotation(current.returns, wanted.returns))


def parameters(signature):
    for field in ("posonly_params", "params", "kwonly_params", "star_arg", "star_kwarg"):
        value = getattr(signature, field)
        yield from (item for item in (value if isinstance(value, (tuple, list)) else [value]) if isinstance(item, cst.Param))


def has_comment(node):
    class Comments(cst.CSTVisitor):
        found = False

        def visit_Comment(self, node):
            self.found = True
    visitor = Comments()
    node.visit(visitor)
    return visitor.found


def preserve(request, root, facts=None):
    before = declarations(cst.parse_module(request["before"]))
    after = declarations(cst.parse_module(request["after"]))
    previous = associations(request["previous"])
    desired = associations(request["next"])
    files = {item["locator"]["value"]["file"] for item in request["previous"]} | set(facts["files"] if facts else [])
    wrappers = {file: MetadataWrapper(cst.parse_module((root / file).read_bytes())) for file in sorted(files)}
    modules = {file: wrapper.module for file, wrapper in wrappers.items()}
    actual = {file: declarations(module) for file, module in modules.items()}
    replacements, additions, problems, names, removals = {}, {}, [], {}, set()

    def problem(code, file, message):
        problems.append({"code": code, "file": file, "message": message})

    for identity, artifact in desired.items():
        key = selector(artifact)
        if key[-1][0] == "parameter":
            continue  # A callable's native parameter list is one coherent contract edit.
        wanted = after.get(key)
        old = previous.get(identity)
        if old:
            file = old["locator"]["value"]["file"]
            prior, current = before.get(selector(old)), actual[file].get(selector(old))
            if not prior or not current or not wanted:
                problem("python-definition-unavailable", file, "The mapped declaration must have one native definition."); continue
            if contract(current) != contract(prior):
                problem("output-conflict", file, "A handwritten signature competes with the generated contract."); continue
            if contract(prior) == contract(wanted):
                continue
            if key[-1][1] != selector(old)[-1][1]:
                targets = [item for item in (facts or {}).get("declarations", []) if item["file"] == file
                           and tuple((part["kind"], part["name"]) for part in item["declaration"]) == selector(old)]
                if len(targets) != 1:
                    problem("python-definition-unavailable", file, "Renaming requires one exact native declaration."); continue
                if key in actual[file]:
                    problem("native-name-conflict", file, "Another native declaration already uses the requested name."); continue
                target = targets[0]["target"]
                target_key = lambda item: (item["file"], item["line"], item["column"])
                for use in facts["uses"]:
                    if use["name"] != selector(old)[-1][1]:
                        continue  # An explicit import/callable alias keeps its own name.
                    if len(use["targets"]) == 1 and target_key(use["targets"][0]) == target_key(target):
                        names[(use["file"], use["start"])] = key[-1][1]
                    elif use["member"] and len(use["targets"]) != 1:
                        problem("incomplete-native-references", use["file"], "An uncertain native member cannot authorize this rename.")
            if isinstance(current, cst.FunctionDef) and isinstance(wanted, cst.FunctionDef):
                retained = {parameter.name.value for parameter in parameters(wanted.params)}
                if any(has_comment(parameter) for parameter in parameters(current.params) if parameter.name.value not in retained):
                    problem("output-conflict", file, "Removing this parameter would discard its handwritten comment."); continue
                replacements[current] = wanted
            elif isinstance(current, cst.AnnAssign) and isinstance(wanted, cst.AnnAssign):
                replacements[current] = current.with_changes(annotation=wanted.annotation)
            else:
                problem("unsupported-python-change", file, "This native declaration change needs explicit preservation support.")
        else:
            owner = next((identity for identity, item in desired.items() if selector(item) == key[:-1]), None)
            saved = previous.get(owner)
            if not saved or not isinstance(wanted, cst.FunctionDef):
                problem("unsupported-python-change", artifact["locator"]["value"]["file"], "This new declaration needs an available mapped native owner."); continue
            file = saved["locator"]["value"]["file"]
            parent = actual[file].get(selector(saved))
            if not isinstance(parent, cst.ClassDef) or not isinstance(parent.body, cst.IndentedBlock):
                problem("python-definition-unavailable", file, "A new member requires an ordinary class suite."); continue
            if selector(saved) + (key[-1],) in actual[file]:
                problem("native-name-conflict", file, "An existing native declaration already has the requested name."); continue
            additions.setdefault(parent, []).append(wanted)
    for identity, artifact in previous.items():
        if identity not in desired:
            key, file = selector(artifact), artifact["locator"]["value"]["file"]
            if key[-1][0] == "parameter":
                continue
            prior, current = before.get(key), actual[file].get(key)
            if identity[0] in request.get("authored", []):
                problem("output-conflict", file, "Adoption does not grant ownership of handwritten declarations."); continue
            if not isinstance(prior, cst.FunctionDef) or not isinstance(current, cst.FunctionDef):
                problem("unsupported-python-change", file, "This declaration needs an explicit native retirement strategy."); continue
            code = lambda node: cst.Module([]).code_for_node(node).replace("\r\n", "\n").strip()
            if code(current) != code(prior):
                problem("output-conflict", file, "A handwritten implementation or comment cannot be retired."); continue
            targets = [item["target"] for item in (facts or {}).get("declarations", []) if item["file"] == file
                       and tuple((part["kind"], part["name"]) for part in item["declaration"]) == key]
            if len(targets) != 1:
                problem("incomplete-native-references", file, "Retirement requires one native declaration and its actual uses."); continue
            target_key = lambda item: (item["file"], item["line"], item["column"])
            incoming = [use for use in facts["uses"] if any(target_key(target) == target_key(targets[0]) for target in use["targets"])
                        or use["member"] and use["name"] == key[-1][1] and len(use["targets"]) != 1]
            if incoming:
                problem("native-reference-conflict", incoming[0]["file"], "A native caller still uses, or may use, the retiring declaration."); continue
            removals.add(current)
    if problems:
        return [], problems

    class Rewrite(cst.CSTTransformer):
        METADATA_DEPENDENCIES = (PositionProvider,)

        def __init__(self, file, module):
            self.file, self.lines, self.bom = file, module.code.splitlines(keepends=True), module.encoding == "utf-8-sig"

        def leave_Name(self, original, updated):
            at = self.get_metadata(PositionProvider, original).start
            prefix = "".join(self.lines[:at.line - 1]) + self.lines[at.line - 1][:at.column]
            name = names.get((self.file, len(prefix.encode("utf-16-le")) // 2 + self.bom))
            return updated.with_changes(value=name) if name else updated

        def leave_FunctionDef(self, original, updated):
            if original in removals:
                return cst.RemoveFromParent()
            wanted = replacements.get(original)
            return signature(updated, wanted) if wanted else updated

        def leave_AnnAssign(self, original, updated):
            return replacements.get(original, updated)

        def leave_ClassDef(self, original, updated):
            return updated.with_changes(body=updated.body.with_changes(body=[*updated.body.body, *additions[original]])) if original in additions else updated

    return [{"file": file, "text": wrapper.visit(Rewrite(file, wrapper.module)).bytes.decode("utf-8")} for file, wrapper in wrappers.items()], []
