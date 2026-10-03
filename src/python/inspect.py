"""Private native lookup: LibCST preserves syntax; Jedi supplies declaration identity."""
import ast
import json
import pathlib
import sys

request = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
sys.path[:0] = request["sites"]
import jedi
import libcst as cst
from libcst.metadata import MetadataWrapper, PositionProvider, ParentNodeProvider

root = pathlib.Path(request["root"])
jedi.settings.cache_directory = request["cache"]
project = jedi.Project(root, sys_path=request["paths"], smart_sys_path=False, load_unsafe_extensions=False)
declarations, uses, problems = [], [], []


def native(name):
    path = name.module_path
    if path is None or name.line is None or name.column is None:
        return None
    try:
        file = str(path.relative_to(root)).replace("\\", "/")
    except ValueError:
        file = str(path)
    return {"file": file, "line": name.line, "column": name.column, "name": name.name,
            "builtin": bool(name.full_name and name.full_name.startswith("builtins."))}


for filename in request["files"]:
    path = root / filename
    data = path.read_bytes()
    try:
        text = data.decode("utf-8-sig")
        ast.parse(text, filename=filename)
        wrapper = MetadataWrapper(cst.parse_module(data))
    except (UnicodeError, SyntaxError, cst.ParserSyntaxError) as error:
        problems.append({"code": "invalid-python-source", "file": filename, "message": str(error)})
        continue
    script = jedi.Interpreter(text, namespaces=[{}], path=path, project=project)
    errors = script.get_syntax_errors()
    if errors:
        problems.append({"code": "unsupported-analyzer-syntax", "file": filename,
                         "message": "Python accepts this syntax but the selected native analyzer does not: " + str(errors[0])})
        continue
    positions = wrapper.resolve(PositionProvider)
    parents = wrapper.resolve(ParentNodeProvider)
    lines = text.splitlines(keepends=True)
    names = {(name.line, name.column): native(name) for name in script.get_names(all_scopes=True, definitions=True, references=False)}
    scope = []

    def offset(position):
        prefix = "".join(lines[:position.line - 1]) + lines[position.line - 1][:position.column]
        return len(prefix.encode("utf-16-le")) // 2 + (1 if data.startswith(b"\xef\xbb\xbf") else 0)

    def record(node, name, kind):
        at = positions[name]
        target = names.get((at.start.line, at.start.column))
        if target:
            declarations.append({"file": filename, "declaration": scope + [{"kind": kind, "name": name.value}],
                                 "start": offset(at.start), "end": offset(at.end), "target": target,
                                 "begin": offset(positions[node].start), "finish": offset(positions[node].end)})

    class Sites(cst.CSTVisitor):
        def visit_ClassDef(self, node):
            record(node, node.name, "class")
            scope.append({"kind": "class", "name": node.name.value})

        def leave_ClassDef(self, node):
            scope.pop()

        def visit_FunctionDef(self, node):
            kind = "method" if scope and scope[-1]["kind"] == "class" else "function"
            record(node, node.name, kind)
            scope.append({"kind": kind, "name": node.name.value})

        def leave_FunctionDef(self, node):
            scope.pop()

        def visit_Param(self, node):
            record(node, node.name, "parameter")

        def visit_AnnAssign(self, node):
            if isinstance(node.target, cst.Name):
                annotation = node.annotation.annotation
                at = positions[annotation]
                targets = script.goto(at.start.line, at.start.column + 1, follow_imports=True, follow_builtin_imports=True)
                kind = "type" if any(name.full_name == "typing.TypeAlias" for name in targets) else "field"
                record(node, node.target, kind)

        def visit_Name(self, node):
            at = positions[node]
            if (at.start.line, at.start.column) in names:
                return
            parent = parents.get(node)
            if isinstance(parent, (cst.ClassDef, cst.FunctionDef, cst.Param)) and parent.name is node:
                return
            found = script.goto(at.start.line, at.start.column + min(1, len(node.value) - 1), follow_imports=True, follow_builtin_imports=True)
            targets = [value for name in found if (value := native(name))]
            unique = {json.dumps(value, sort_keys=True): value for value in targets}
            # An actual dynamic member operation cannot establish static completeness.
            if any(name.full_name in ("builtins.getattr", "builtins.setattr", "builtins.delattr", "builtins.eval", "builtins.exec", "builtins.__import__") for name in found):
                problems.append({"code": "dynamic-python-lookup", "file": filename, "start": offset(at.start),
                                 "message": "A dynamic operation prevents complete native relationship coverage."})
            uses.append({"file": filename, "start": offset(at.start), "end": offset(at.end), "name": node.value,
                         "owner": list(scope), "member": isinstance(parent, cst.Attribute) and parent.attr is node,
                         "targets": list(unique.values())})

    wrapper.visit(Sites())

print(json.dumps({"files": request["files"], "declarations": declarations, "uses": uses, "problems": problems}, ensure_ascii=True))
