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

def inspect_files(request):
    root = pathlib.Path(request["root"])
    jedi.settings.cache_directory = request["cache"]
    projects = {main: jedi.Project(root, sys_path=request["mainPaths"] + ([] if main else request["testPaths"]) + request["paths"],
                                   smart_sys_path=False, load_unsafe_extensions=False) for main in (True, False)}
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
                "kind": name.type, "builtin": bool(name.full_name and name.full_name.startswith("builtins."))}


    for filename in request["files"]:
        path = root / filename
        data = path.read_bytes()
        try:
            text = data.decode("utf-8-sig")
            ast.parse(text, filename=filename)
            compile(text, filename, "exec", dont_inherit=True)
            wrapper = MetadataWrapper(cst.parse_module(data))
        except (UnicodeError, SyntaxError, cst.ParserSyntaxError) as error:
            problems.append({"code": "invalid-python-source", "file": filename, "message": str(error)})
            continue
        script = jedi.Interpreter(text, namespaces=[{}], path=path,
                                  project=projects[any(filename.startswith(part + "/") for part in request["main"])])
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

        def imported(node):
            while isinstance(node, cst.Attribute):
                node = node.attr
            if not isinstance(node, cst.Name):
                return
            at = positions[node]
            found = script.goto(at.start.line, at.start.column + min(1, len(node.value) - 1), follow_imports=True, follow_builtin_imports=True)
            targets = [value for name in found if (value := native(name))]
            if not targets:
                problems.append({"code": "unresolved-python-import", "file": filename, "start": offset(at.start),
                                 "message": "The imported declaration is not available in this source scope."})
            else:
                uses.append({"file": filename, "start": offset(at.start), "end": offset(at.end), "name": node.value,
                             "owner": list(scope), "member": False, "targets": targets})

        class Sites(cst.CSTVisitor):
            def visit_ClassDef(self, node):
                if any(argument.keyword and argument.keyword.value == "metaclass" for argument in node.keywords):
                    problems.append({"code": "dynamic-python-lookup", "file": filename, "start": offset(positions[node.name].start),
                                     "message": "A custom metaclass prevents complete native relationship coverage."})
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

            def visit_Import(self, node):
                for alias in node.names:
                    imported(alias.name)

            def visit_ImportFrom(self, node):
                if isinstance(node.names, cst.ImportStar):
                    problems.append({"code": "unresolved-python-import", "file": filename, "start": offset(positions[node].start),
                                     "message": "A wildcard import cannot establish explicit native bindings."})
                else:
                    for alias in node.names:
                        imported(alias.name)

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

    return {"files": request["files"], "declarations": declarations, "uses": uses, "problems": problems}


root = pathlib.Path(request["root"])
result = inspect_files(request)
traces = {}
if "tests" in request and not result["problems"]:
    import importlib.util
    specification = importlib.util.spec_from_file_location("expec_integrity", pathlib.Path(__file__).with_name("integrity.py"))
    integrity = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(integrity)
    result["problems"].extend(integrity.check(request["tests"], root))
    if "desiredTests" in request and not result["problems"]:
        result["rewritten"], failures = integrity.preserve(request["tests"], request["desiredTests"], root, result["files"], traces)
        result["problems"].extend(failures)
if "rewrite" in request and not result["problems"]:
    import importlib.util
    specification = importlib.util.spec_from_file_location("expec_preservation", pathlib.Path(__file__).with_name("preservation.py"))
    preservation = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(preservation)
    result["rewritten"], failures = preservation.preserve(request["rewrite"], root, result, traces)
    result["problems"].extend(failures)
    if not failures and (move := request["rewrite"].get("move")):
        from libcst.helpers import calculate_module_and_package
        specification = importlib.util.spec_from_file_location("expec_relocation", pathlib.Path(__file__).with_name("relocation.py"))
        relocation = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(relocation)
        for item in result["rewritten"]:
            if item["file"] == move["from"]:
                traces[item["file"]]["file"] = move["to"]
                item["file"] = move["to"]
                continue
            selected = next(path for path in request["mainPaths"] + request["testPaths"] if (root / item["file"]).is_relative_to(path))
            package = calculate_module_and_package(selected, root / item["file"]).package
            try:
                trace, names = traces[item["file"]], {}
                module = relocation.relocate(trace["after"], move["old"], move["next"], package, names)
                trace.update(after=module, names={old: names.get(new, new) for old, new in trace["names"].items()})
                item["text"] = module.bytes.decode("utf-8")
            except ValueError as error:
                result["problems"].append({"code": "incomplete-native-references", "file": item["file"], "message": str(error)})
if "rewritten" in result and not result["problems"]:
    staged = root.parent / "after"
    for item in result["rewritten"]:
        path = staged / item["file"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(item["text"].encode("utf-8"))
    after_request = {**request, "root": str(staged), "cache": str(root.parent / "after-cache"),
                     "files": [item["file"] for item in result["rewritten"]]}
    for kind in ("mainPaths", "testPaths"):
        after_request[kind] = [str(staged / pathlib.Path(path).relative_to(root)) for path in request[kind]]
    after = inspect_files(after_request)
    result["problems"].extend(after["problems"])
    if "desiredTests" in request:
        result["problems"].extend(integrity.check(request["desiredTests"], staged))
    specification = importlib.util.spec_from_file_location("expec_bindings", pathlib.Path(__file__).with_name("bindings.py"))
    bindings = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(bindings)
    result["problems"].extend(bindings.conflicts(result, after, traces))
print(json.dumps(result, ensure_ascii=True))
