"""Audit known Expec package phases using resolved native import file ownership."""
import ast
import importlib.metadata
import json
import os
import pathlib
import re
import sys

request = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
sys.path[:] = request["stdlib"] + [str(pathlib.Path(path) / "lib-dynload") for path in request["stdlib"]
                                  if (pathlib.Path(path) / "lib-dynload").is_dir()] + request["sites"]
import jedi
import libcst as cst
from libcst.metadata import MetadataWrapper, PositionProvider

root = pathlib.Path(request["root"])
normalize = lambda value: re.sub(r"[-_.]+", "-", value).lower()
phases = {}
for package in request["packages"]:
    phases.setdefault(normalize(package["name"].removeprefix("pypi:")), set()).update(package["phases"])
owners = {}
for distribution in importlib.metadata.distributions(path=request["sites"]):
    name = distribution.metadata.get("Name")
    if name:
        for file in distribution.files or ():
            path = os.path.normcase(str(distribution.locate_file(file).resolve()))
            owners.setdefault(path, set()).add(normalize(name))

jedi.settings.cache_directory = request["cache"]
project = jedi.Project(root, sys_path=request["mainPaths"] + request["sourcePath"] + request["sites"] + request["stdlib"],
                       smart_sys_path=False, load_unsafe_extensions=False)
problems = []
for filename in request["files"]:
    path = root / filename
    if not any(path.is_relative_to(part) for part in map(pathlib.Path, request["mainPaths"])):
        continue
    data = path.read_bytes()
    try:
        text = data.decode("utf-8-sig")
        ast.parse(text, filename=filename)
        wrapper = MetadataWrapper(cst.parse_module(data))
    except (UnicodeError, SyntaxError, cst.ParserSyntaxError):
        continue  # Whole native syntax/coverage belongs to ordinary project inspection.
    positions = wrapper.resolve(PositionProvider)
    script = jedi.Script(text, path=path, project=project)
    lines = text.splitlines(keepends=True)

    def imported(node):
        while isinstance(node, cst.Attribute):
            node = node.attr
        if not isinstance(node, cst.Name):
            return
        position = positions[node].start
        found = script.goto(position.line, position.column + min(1, len(node.value) - 1), follow_imports=True, follow_builtin_imports=True)
        prefix = "".join(lines[:position.line - 1]) + lines[position.line - 1][:position.column]
        start = len(prefix.encode("utf-16-le")) // 2 + (1 if data.startswith(b"\xef\xbb\xbf") else 0)
        for target in found:
            if target.module_path is None:
                continue
            location = target.module_path.resolve()
            if location.is_relative_to(root) or any(location.is_relative_to(pathlib.Path(part)) for part in request["sourcePath"]):
                continue
            in_sites = any(location.is_relative_to(pathlib.Path(site)) for site in request["sites"])
            if not in_sites and any(location.is_relative_to(pathlib.Path(part)) for part in request["stdlib"]):
                continue
            known = owners.get(os.path.normcase(str(location)), set())
            if len(known) != 1:
                problems.append({"code": "unknown-native-dependency", "file": filename, "start": start,
                                 "message": "The resolved native import has no unique captured distribution file owner."})
            elif (name := next(iter(known))) in phases and "runtime" not in phases[name]:
                problems.append({"code": "inaccessible-native-dependency", "file": filename, "start": start,
                                 "message": "The main source imports " + name + ", which is declared only for build/test."})

    class Imports(cst.CSTVisitor):
        def visit_Import(self, node):
            for alias in node.names:
                imported(alias.name)
        def visit_ImportFrom(self, node):
            imported(node.module)
            if isinstance(node.names, cst.ImportStar):
                imported(node.module)
            else:
                for alias in node.names:
                    imported(alias.name)

    wrapper.visit(Imports())
print(json.dumps(problems, ensure_ascii=True))
