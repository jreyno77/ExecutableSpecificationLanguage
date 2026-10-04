"""Compare owned native meaning while retaining comments, layout and unowned declarations."""
import ast
import copy
import dataclasses
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


def same(left, right):
    if isinstance(left, cst.CSTNode) and isinstance(right, cst.CSTNode):
        return left.deep_equals(right)
    if isinstance(left, (tuple, list)) and isinstance(right, (tuple, list)):
        return len(left) == len(right) and all(same(a, b) for a, b in zip(left, right))
    return left == right


def merge(before, desired, current):
    """Change native syntax fields without replacing unchanged spelling or trivia."""
    if same(before, desired):
        return current
    if isinstance(before, cst.CSTNode) and type(before) is type(desired) is type(current):
        return current.with_changes(**{field.name: merge(getattr(before, field.name), getattr(desired, field.name), getattr(current, field.name))
                                       for field in dataclasses.fields(before) if not field.name.startswith('_')})
    if isinstance(before, (tuple, list)) and isinstance(desired, (tuple, list)) and isinstance(current, (tuple, list)):
        if len(before) != len(desired) or len(before) != len(current):
            raise ValueError("This native structural edit needs explicit reconciliation.")
        return [merge(old, new, actual) for old, new, actual in zip(before, desired, current)]
    if type(before) is not type(desired) or type(before) is not type(current):
        raise ValueError("This native replacement needs explicit reconciliation.")
    return desired


def functions(module):
    found, scope = {}, []

    class Index(cst.CSTVisitor):
        def visit_ClassDef(self, node):
            scope.append(node.name.value)

        def leave_ClassDef(self, node):
            scope.pop()

        def visit_FunctionDef(self, node):
            key = (*scope, node.name.value)
            if key in found:
                raise ValueError("An owned function must have exactly one native definition.")
            found[key] = node
            return False

    module.visit(Index())
    return found


def preserve(previous, desired, root, files, traces):
    """Reconcile retained function syntax; unsupported structural edits produce no source plan."""
    before = {file['file']: file for file in previous}
    after = {file['file']: file for file in desired}
    if before.keys() != after.keys():
        return [], [{"code": "unsupported-python-change", "file": "", "message": "Acceptance file additions and retirement need explicit reconciliation."}]
    rewritten = []
    for file in files:
        module = cst.parse_module((root / file).read_bytes())
        replacements = {}
        try:
            if file in before and before[file]['text'] != after[file]['text']:
                old = cst.parse_module(before[file]['text'])
                new = cst.parse_module(after[file]['text'])
                original, wanted, actual = functions(old), functions(new), functions(module)
                if original.keys() != wanted.keys() or not original.keys() <= actual.keys():
                    raise ValueError("Acceptance declaration additions, renames and retirement need explicit reconciliation.")

                class Baseline(cst.CSTTransformer):
                    def leave_FunctionDef(self, node, updated):
                        return next((wanted[key] for key, value in original.items() if value is node), updated)

                if not old.visit(Baseline()).deep_equals(new):
                    raise ValueError("Changed module or class setup needs explicit reconciliation.")
                replacements = {actual[key]: (original[key], wanted[key].with_changes(body=original[key].body) if before[file]['driver'] else wanted[key])
                                for key in original}

            class Rewrite(cst.CSTTransformer):
                def __init__(self):
                    self.names = {}

                def leave_Name(self, node, updated):
                    self.names[node] = updated
                    return updated

                def leave_FunctionDef(self, node, updated):
                    return merge(*replacements[node], updated) if node in replacements else updated

            editor = Rewrite()
            updated = module.visit(editor)
            traces[file] = {"before": module, "after": updated, "names": editor.names, "file": file}
            rewritten.append({"file": file, "text": updated.bytes.decode('utf-8')})
        except (ValueError, SyntaxError, cst.ParserSyntaxError) as error:
            return [], [{"code": "unsupported-python-change", "file": file, "message": str(error)}]
    return rewritten, []
