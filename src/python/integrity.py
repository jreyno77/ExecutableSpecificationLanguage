"""Compare owned native meaning while retaining comments, layout and unowned declarations."""
import ast
import copy
import libcst as cst
from libcst.metadata import MetadataWrapper, PositionProvider, QualifiedNameProvider, QualifiedNameSource


def declarations(text, driver=False):
    wrapper = MetadataWrapper(cst.parse_module(text))
    lines, names = text.splitlines(), {}

    class References(cst.CSTVisitor):
        METADATA_DEPENDENCIES = (PositionProvider, QualifiedNameProvider)

        def on_visit(self, node):
            if isinstance(node, (cst.Name, cst.Attribute)):
                qualified = self.get_metadata(QualifiedNameProvider, node, set())
                if any(name.source in (QualifiedNameSource.IMPORT, QualifiedNameSource.BUILTIN) for name in qualified):
                    if len(qualified) != 1:
                        raise ValueError("An owned reference has ambiguous native bindings.")
                    at = self.get_metadata(PositionProvider, node)
                    names[(at.start.line, len(lines[at.start.line - 1][:at.start.column].encode("utf-8")),
                           at.end.line, len(lines[at.end.line - 1][:at.end.column].encode("utf-8")))] = next(iter(qualified)).name
            return True

    wrapper.visit(References())

    class Meaning(ast.NodeTransformer):
        def visit_Name(self, node):
            name = names.get((node.lineno, node.col_offset, node.end_lineno, node.end_col_offset))
            return ast.Name(id="@native:" + name, ctx=node.ctx) if name else node

        def visit_Attribute(self, node):
            name = names.get((node.lineno, node.col_offset, node.end_lineno, node.end_col_offset))
            return ast.Name(id="@native:" + name, ctx=node.ctx) if name else self.generic_visit(node)

        def visit_alias(self, node):
            return ast.alias(name=node.name, asname=None)

    tree, found = Meaning().visit(ast.parse(text)), {}

    def record(path, node):
        if path in found:
            raise ValueError("An owned native declaration has more than one definition.")
        found[path] = ast.dump(node, include_attributes=False)

    def scope(node, path=()):
        body = []
        for member in node.body:
            if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                key = (*path, member.name)
                if isinstance(member, ast.ClassDef):
                    scope(member, key)
                else:
                    value = copy.deepcopy(member)
                    if driver:
                        value.body = [ast.Pass()]
                    record(key, value)
            else:
                body.append(member)
        value = copy.deepcopy(node)
        value.body = [] if driver else body
        record(path, value)

    scope(tree)
    return found


def check(files, root):
    problems = []
    for file in files:
        try:
            driver = file["driver"]
            expected = declarations(file["text"], driver)
            actual = declarations((root / file["file"]).read_text(encoding="utf-8-sig"), driver)
            if any(actual.get(key) != value for key, value in expected.items()):
                raise ValueError("The generated declaration, setup or assertion changed.")
            if not driver and any(key and key[-1].startswith("__") and key[:-1] in expected for key in actual.keys() - expected.keys()):
                raise ValueError("An added native protocol method changes the owned class.")
        except (OSError, ValueError, SyntaxError, cst.ParserSyntaxError) as error:
            problems.append({"code": "generated-tests-changed", "file": file["file"], "message": str(error)})
    return problems
