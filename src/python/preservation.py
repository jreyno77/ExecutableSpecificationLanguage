"""Lossless edits to explicitly identified declarations; no file writes or application execution."""
import ast
import json
import libcst as cst
from libcst.metadata import MetadataWrapper, PositionProvider, ScopeProvider


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

    previous = {parameter.name.value: parameter for parameter in parameters(current.params)}
    fields = ("posonly_params", "params", "kwonly_params", "star_arg", "star_kwarg")

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


def retire(request):
    module = cst.parse_module(request['before'])
    nodes = declarations(module)
    desired = associations(request['next'])
    removed = [selector(item) for identity, item in associations(request['previous']).items() if identity not in desired]
    selected = {nodes[key] for key in removed if key in nodes}
    names = {key[0][1] for key in removed if len(key) == 1}

    class Retire(cst.CSTTransformer):
        def on_leave(self, original, updated):
            if original in selected:
                return cst.RemoveFromParent()
            if isinstance(updated, cst.Assign) and len(updated.targets) == 1 and isinstance(updated.targets[0].target, cst.Name) and updated.targets[0].target.value == '__all__':
                values = ast.literal_eval(module.code_for_node(updated.value))
                return updated.with_changes(value=cst.parse_expression(json.dumps([name for name in values if name not in names])))
            return updated
    return module.visit(Retire()).code


def support(module, artifacts):
    owned = {selector(item)[0][1] for item in artifacts}
    found = {}
    for node in module.body:
        tree = ast.parse(module.code_for_node(node))
        first = tree.body[0]
        if isinstance(first, ast.ImportFrom):
            key = ('import', first.level, first.module)
        elif isinstance(first, ast.Import):
            key = ('import', tuple(alias.name for alias in first.names))
        elif isinstance(first, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            key = ('name', first.name)
        elif isinstance(first, ast.Assign) and len(first.targets) == 1 and isinstance(first.targets[0], ast.Name):
            key = ('name', first.targets[0].id)
        else:
            continue
        if key[0] != 'name' or key[1] not in owned:
            found[key] = None if key in found else node
    return found


def preserve(request, root, facts=None, traces=None):
    old_module, new_module = cst.parse_module(request['before']), cst.parse_module(request['after'])
    before, after = declarations(old_module), declarations(new_module)
    previous = associations(request["previous"])
    desired = associations(request["next"])
    files = {item["locator"]["value"]["file"] for item in request["previous"]} | set(facts["files"] if facts else [])
    wrappers = {file: MetadataWrapper(cst.parse_module((root / file).read_bytes())) for file in sorted(files)}
    modules = {file: wrapper.module for file, wrapper in wrappers.items()}
    actual = {file: declarations(module) for file, module in modules.items()}
    replacements, additions, problems, names, removals = {}, {}, [], {}, set()

    def destination(artifact):
        file, move = artifact['locator']['value']['file'], request.get('move')
        return move['from'] if move and file == move['to'] else file

    def problem(code, file, message, start=None):
        problems.append({"code": code, "file": file, "message": message, **({'start': start} if start is not None else {})})

    def occupied(file, owner, name):
        scopes = wrappers[file].resolve(ScopeProvider)
        scope = scopes[modules[file]] if owner is modules[file] else scopes[owner.body.body[0]]
        return list(scope.assignments[name])

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
                if key in actual[file] or any(assignment.node is not current for assignment in wrappers[file].resolve(ScopeProvider)[current].assignments[key[-1][1]]):
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
            elif isinstance(current, cst.ClassDef) and isinstance(wanted, cst.ClassDef):
                replacements[current] = wanted
            else:
                problem("unsupported-python-change", file, "This native declaration change needs explicit preservation support.")
        else:
            if any(selector(item) == key[:depth] and identity not in previous for identity, item in desired.items() for depth in range(1, len(key))):
                continue  # The new ancestor already carries its complete generated body.
            file = destination(artifact)
            if len(key) == 1 and wanted is not None:
                if file not in modules:
                    problem('python-definition-unavailable', file, 'A new declaration needs an existing generated module.'); continue
                if occupied(file, modules[file], key[-1][1]):
                    problem('native-name-conflict', file, 'An existing native binding already uses the requested name.'); continue
                additions.setdefault(modules[file], []).append(wanted if not isinstance(wanted, cst.AnnAssign) else cst.SimpleStatementLine([wanted]))
                continue
            owner = next((identity for identity, item in desired.items() if selector(item) == key[:-1]), None)
            saved = previous.get(owner)
            if not saved or not isinstance(wanted, cst.FunctionDef):
                problem("unsupported-python-change", artifact["locator"]["value"]["file"], "This new declaration needs an available mapped native owner."); continue
            file = saved["locator"]["value"]["file"]
            parent = actual[file].get(selector(saved))
            if not isinstance(parent, cst.ClassDef) or not isinstance(parent.body, cst.IndentedBlock):
                problem("python-definition-unavailable", file, "A new member requires an ordinary class suite."); continue
            if selector(saved) + (key[-1],) in actual[file] or occupied(file, parent, key[-1][1]):
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
            if not isinstance(prior, (cst.ClassDef, cst.FunctionDef, cst.AnnAssign)) or not isinstance(current, type(prior)):
                problem("unsupported-python-change", file, "This declaration needs an explicit native retirement strategy."); continue
            code = lambda node: cst.Module([]).code_for_node(node).replace("\r\n", "\n").strip()
            if code(current) != code(prior):
                problem("output-conflict", file, "A handwritten implementation or comment cannot be retired."); continue
            targets = [item["target"] for item in (facts or {}).get("declarations", []) if item["file"] == file
                       and tuple((part["kind"], part["name"]) for part in item["declaration"]) == key]
            if len(targets) != 1:
                problem("incomplete-native-references", file, "Retirement requires one native declaration and its actual uses."); continue
            target_key = lambda item: (item["file"], item["line"], item["column"])
            retiring = [(item['locator']['value']['file'], selector(item)) for identity, item in previous.items() if identity not in desired]
            incoming = [use for use in facts["uses"] if not any(use['file'] == path and tuple((part['kind'], part['name']) for part in use['owner'])[:len(scope)] == scope for path, scope in retiring)
                        and (any(target_key(target) == target_key(targets[0]) for target in use["targets"])
                             or use["member"] and use["name"] == key[-1][1] and len(use["targets"]) != 1)]
            if incoming:
                for use in incoming:
                    problem("native-reference-conflict", use['file'], "A native caller still uses, or may use, the retiring declaration.", use['start'])
                continue
            removals.add(current)
    # Generated module support (imports, exports and type variables) has its own ownership.
    # A distributed adopted module receives only existing support; new bindings need a safe local destination.
    old_support, new_support = support(old_module, request['previous']), support(new_module, request['next'])
    destinations = {destination(item) for item in [*request['previous'], *request['next']]}
    for file in destinations:
        current_support = support(modules[file], [item for item in [*request['previous'], *request['next']] if destination(item) == file])
        for key in old_support.keys() | new_support.keys():
            prior, wanted, current = old_support.get(key), new_support.get(key), current_support.get(key)
            code = lambda node: cst.Module([]).code_for_node(node).replace('\r\n', '\n').strip() if node else None
            if code(prior) == code(wanted):
                continue
            if prior is not None and current is None:
                problem('output-conflict', file, 'Generated module support is missing or ambiguous.'); continue
            if current is not None and code(current) != code(prior):
                problem('output-conflict', file, 'Handwritten module support competes with the requested contract.'); continue
            if wanted is None:
                if current: removals.add(current)
            elif current is not None:
                replacements[current] = wanted
            elif len(destinations) != 1:
                problem('unsupported-python-change', file, 'New shared imports require an explicit native module placement.')
            else:
                introduced = MetadataWrapper(cst.Module([wanted])).resolve(ScopeProvider)
                for scope in set(introduced.values()):
                    if type(scope).__name__ == 'GlobalScope':
                        if any(occupied(file, modules[file], assignment.name) for assignment in scope.assignments):
                            problem('native-name-conflict', file, 'A new support declaration would hide an existing native binding.')
                additions.setdefault(modules[file], []).insert(0, wanted)
    if problems:
        return [], problems

    class Rewrite(cst.CSTTransformer):
        METADATA_DEPENDENCIES = (PositionProvider,)

        def __init__(self, file, module):
            self.file, self.lines, self.bom = file, module.code.splitlines(keepends=True), module.encoding == "utf-8-sig"
            self.names = {}

        def leave_Name(self, original, updated):
            at = self.get_metadata(PositionProvider, original).start
            prefix = "".join(self.lines[:at.line - 1]) + self.lines[at.line - 1][:at.column]
            name = names.get((self.file, len(prefix.encode("utf-16-le")) // 2 + self.bom))
            result = updated.with_changes(value=name) if name else updated
            self.names[original] = result
            return result

        def leave_FunctionDef(self, original, updated):
            if original in removals:
                return cst.RemoveFromParent()
            wanted = replacements.get(original)
            result = signature(updated, wanted) if wanted else updated
            self.names[original.name] = result.name
            return result

        def leave_AnnAssign(self, original, updated):
            if original in removals:
                return cst.RemoveFromParent()
            wanted = replacements.get(original)
            return updated.with_changes(annotation=wanted.annotation) if wanted else updated

        def leave_ClassDef(self, original, updated):
            if original in removals:
                return cst.RemoveFromParent()
            wanted = replacements.get(original)
            result = updated.with_changes(name=updated.name.with_changes(value=wanted.name.value), bases=wanted.bases, keywords=wanted.keywords) if wanted else updated
            self.names[original.name] = result.name
            return result.with_changes(body=result.body.with_changes(body=[*result.body.body, *additions[original]])) if original in additions else result

        def leave_SimpleStatementLine(self, original, updated):
            return cst.RemoveFromParent() if original in removals else replacements.get(original, updated)

        def leave_Module(self, original, updated):
            extra = additions.get(original, [])
            imports = [node for node in extra if isinstance(node, cst.SimpleStatementLine) and isinstance(node.body[0], (cst.Import, cst.ImportFrom))]
            other = [node for node in extra if node not in imports]
            body = list(updated.body)
            at = 1 if body and isinstance(body[0], cst.SimpleStatementLine) and isinstance(body[0].body[0], cst.ImportFrom) and cst.Module([]).code_for_node(body[0]).startswith('from __future__') else 0
            return updated.with_changes(body=[*body[:at], *imports, *body[at:], *other])

    rewritten = []
    for file, wrapper in wrappers.items():
        editor = Rewrite(file, wrapper.module)
        module = wrapper.visit(editor)
        if traces is not None:
            traces[file] = {"before": wrapper.module, "after": module, "names": editor.names, "file": file}
        rewritten.append({"file": file, "text": module.bytes.decode("utf-8")})
    return rewritten, []
