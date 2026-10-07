"""Native decorator identities and coherent overloads over the supplied LibCST tree."""
import pathlib

import jedi
import libcst as cst


class Callables:
    def __init__(self, module, parents, positions, script, standard_library, sites, problem):
        self.parents, self.positions, self.script = parents, positions, script
        self.problem = problem
        self.wrappers = set()
        self.standard = {pathlib.Path(root) / "typing.py" for root in standard_library}
        typeshed = pathlib.Path(jedi.__file__).parent / "third_party" / "typeshed" / "stdlib"
        self.standard.update(typeshed / name for name in ("builtins.pyi", "typing.pyi"))
        self.fixtures = {pathlib.Path(root) / "_pytest" / "fixtures.py" for root in sites}
        groups = {}
        current = self

        class Functions(cst.CSTVisitor):
            def visit_ClassDef(self, node):
                for item in node.decorators:
                    current.problem(current.token(item.decorator), "An unfamiliar class decorator prevents complete native lookup.")

            def visit_FunctionDef(self, node):
                decorators = [current.decorator(item.decorator) for item in node.decorators]
                owner = current.parent(node, (cst.ClassDef, cst.FunctionDef, cst.Module))
                allowed = ("typing.overload", "builtins.staticmethod", "builtins.classmethod", "builtins.property") \
                    if isinstance(owner, cst.ClassDef) else ("typing.overload", "_pytest.fixtures.fixture")
                for item, identity in zip(node.decorators, decorators):
                    if identity not in allowed:
                        current.problem(current.token(item.decorator), "An unfamiliar callable decorator prevents complete native lookup.")
                block = current.parent(node, (cst.IndentedBlock, cst.Module))
                groups.setdefault((block, node.name.value), []).append((node, "typing.overload" in decorators))

        module.visit(Functions())
        for group in groups.values():
            wrappers = [node for node, overloaded in group if overloaded]
            if not wrappers:
                continue
            implementations = [node for node, overloaded in group if not overloaded]
            if len(implementations) != 1 or group[-1][0] is not implementations[0]:
                cause = implementations[0] if implementations else wrappers[0]
                problem(cause.name, "An overload family requires its stubs followed by exactly one concrete implementation.")
            else:
                self.wrappers.update(wrappers)

    def parent(self, node, kinds):
        while (node := self.parents.get(node)) is not None:
            if isinstance(node, kinds):
                return node
        return None

    def token(self, node):
        if isinstance(node, cst.Call):
            return self.token(node.func)
        return node.attr if isinstance(node, cst.Attribute) else node

    def resolve(self, node):
        at = self.positions[node].start
        return self.script.goto(at.line, at.column + min(1, len(node.value) - 1),
                                follow_imports=True, follow_builtin_imports=True)

    def decorator(self, node):
        if isinstance(node, cst.Call):
            identity = self.decorator(node.func)
            return identity if identity == "_pytest.fixtures.fixture" else None
        if not isinstance(node, (cst.Name, cst.Attribute)):
            return None
        found = self.resolve(self.token(node))
        if len(found) != 1:
            return None
        name = found[0]
        if name.full_name == "_pytest.fixtures.fixture" and name.module_path in self.fixtures:
            return name.full_name
        if name.full_name in ("builtins.staticmethod", "builtins.classmethod", "builtins.property", "typing.overload") \
                and name.module_path in self.standard:
            return name.full_name
        return None

    def visible(self, node):
        function = node if isinstance(node, cst.FunctionDef) else self.parent(node, (cst.FunctionDef,))
        return function not in self.wrappers

    def assignment(self, node):
        if isinstance(node, (cst.Tuple, cst.List)):
            for element in node.elements:
                self.assignment(element.value)
            return
        if isinstance(node, cst.Attribute) and any(name.type == "function" and name.name == node.attr.value
                                                  for name in self.resolve(node.attr)):
            self.problem(node.attr, "Runtime replacement of a known native method prevents complete native lookup.")
