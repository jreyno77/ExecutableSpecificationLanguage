"""Lossless edits to explicitly identified declarations; no file writes or application execution."""
import ast
import libcst as cst


def selector(artifact):
    return tuple((part["kind"], part["name"]) for part in artifact["locator"]["value"]["declaration"])


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
    return ast.dump(ast.parse(cst.Module([]).code_for_node(node)), include_attributes=False)


def preserve(request, root):
    before = declarations(cst.parse_module(request["before"]))
    after = declarations(cst.parse_module(request["after"]))
    previous = {item["specId"]: item for item in request["previous"]}
    desired = {item["specId"]: item for item in request["next"]}
    files = {item["locator"]["value"]["file"] for item in request["previous"]}
    modules = {file: cst.parse_module((root / file).read_bytes()) for file in files}
    actual = {file: declarations(module) for file, module in modules.items()}
    replacements, additions, problems = {}, {}, []

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
            if isinstance(current, cst.FunctionDef) and isinstance(wanted, cst.FunctionDef):
                replacements[current] = wanted.with_changes(body=current.body, decorators=current.decorators, leading_lines=current.leading_lines)
            elif isinstance(current, cst.AnnAssign) and isinstance(wanted, cst.AnnAssign):
                replacements[current] = current.with_changes(annotation=wanted.annotation)
            else:
                problem("unsupported-python-change", file, "This native declaration change needs explicit preservation support.")
        else:
            owner = next((item for item in desired.values() if selector(item) == key[:-1]), None)
            saved = owner and previous.get(owner["specId"])
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
            problem("unsupported-python-change", artifact["locator"]["value"]["file"], "Retirement requires native consumer and implementation checks.")
    if problems:
        return [], problems

    class Rewrite(cst.CSTTransformer):
        def leave_FunctionDef(self, original, updated):
            return replacements.get(original, updated)

        def leave_AnnAssign(self, original, updated):
            return replacements.get(original, updated)

        def leave_ClassDef(self, original, updated):
            return updated.with_changes(body=updated.body.with_changes(body=[*updated.body.body, *additions[original]])) if original in additions else updated

    return [{"file": file, "text": module.visit(Rewrite()).code} for file, module in modules.items()], []
