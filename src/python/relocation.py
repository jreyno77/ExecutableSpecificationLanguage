"""Module import edits over already checked native source; no file or process effects."""
import libcst as cst
from libcst.helpers import get_full_name_for_node, get_absolute_module_from_package_for_import
from libcst.metadata import MetadataWrapper, QualifiedNameProvider, QualifiedNameSource


def relocate(module, old, new, package):
    class Imports(cst.CSTTransformer):
        METADATA_DEPENDENCIES = (QualifiedNameProvider,)

        def leave_Import(self, original, updated):
            return updated.with_changes(names=[alias.with_changes(name=cst.parse_expression(new))
                                               if get_full_name_for_node(alias.name) == old else alias for alias in updated.names])

        def location(self, node, destination):
            if node.relative:
                base = package.rsplit(".", len(node.relative) - 1)[0]
                if destination.startswith(base + "."):
                    return node.with_changes(module=cst.parse_expression(destination[len(base) + 1:]))
            return node.with_changes(module=cst.parse_expression(destination), relative=[])

        def leave_ImportFrom(self, original, updated):
            absolute = get_absolute_module_from_package_for_import(package, original)
            if absolute == old:
                return self.location(updated, new)
            if isinstance(original.names, cst.ImportStar):
                return updated
            selected = [index for index, alias in enumerate(original.names)
                        if absolute and absolute + "." + get_full_name_for_node(alias.name) == old]
            if not selected:
                return updated
            parent, _, name = new.rpartition(".")
            if parent != absolute:
                raise ValueError("A module imported alongside its parent needs an explicit import migration across packages.")
            return updated.with_changes(names=[alias.with_changes(name=cst.Name(name), asname=alias.asname or cst.AsName(cst.Name(old.rsplit(".", 1)[-1])))
                                               if index in selected else alias for index, alias in enumerate(updated.names)])

        def leave_Attribute(self, original, updated):
            if get_full_name_for_node(original) != old:
                return updated
            root = original
            while isinstance(root, cst.Attribute):
                root = root.value
            roots = self.get_metadata(QualifiedNameProvider, root, set())
            if not any(name.source == QualifiedNameSource.IMPORT for name in roots):
                return updated
            names = self.get_metadata(QualifiedNameProvider, original, set())
            selected = [name for name in names if name.name == old and name.source == QualifiedNameSource.IMPORT]
            if not selected:
                return updated
            if len(names) != 1 or any(name.source != QualifiedNameSource.IMPORT for name in roots):
                raise ValueError("An ambiguous native module reference cannot authorize relocation.")
            return cst.parse_expression(new)

    return MetadataWrapper(module).visit(Imports())
