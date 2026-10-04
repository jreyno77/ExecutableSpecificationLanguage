"""Compare owned native meaning while retaining comments, layout and unowned declarations."""
import ast
import copy
import dataclasses
import libcst as cst
from libcst.metadata import MetadataWrapper, PositionProvider, QualifiedNameProvider, QualifiedNameSource, ScopeProvider


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
    if same(before, desired) or same(desired, current):
        return current
    if isinstance(before, cst.CSTNode) and type(before) is type(desired) is type(current):
        return current.with_changes(**{field.name: merge(getattr(before, field.name), getattr(desired, field.name), getattr(current, field.name))
                                       for field in dataclasses.fields(before) if not field.name.startswith('_')})
    if isinstance(before, (tuple, list)) and isinstance(desired, (tuple, list)) and isinstance(current, (tuple, list)):
        if len(before) != len(current):
            raise ValueError("This native structural edit needs explicit reconciliation.")
        if len(before) != len(desired):
            first, last = 0, 0
            while first < min(len(before), len(desired)) and same(before[first], desired[first]):
                first += 1
            while last < min(len(before), len(desired)) - first and same(before[-last - 1], desired[-last - 1]):
                last += 1
            old_end, new_end = len(before) - last, len(desired) - last
            if not same(before[first:old_end], current[first:old_end]):
                raise ChangeConflict('handwritten-removal', 'This replacement would discard handwritten syntax or comments.')
            return [*current[:first], *desired[first:new_end], *current[old_end:]]
        return [merge(old, new, actual) for old, new, actual in zip(before, desired, current)]
    if type(before) is not type(desired) or type(before) is not type(current):
        raise ValueError("This native replacement needs explicit reconciliation.")
    return desired


def functions(module, owners=None):
    found, scope = {}, []

    class Index(cst.CSTVisitor):
        def visit_ClassDef(self, node):
            scope.append(node.name.value)
            if owners is not None:
                owners[tuple(scope)] = node

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


class ChangeConflict(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def locations(artifacts, file):
    return {tuple(part['name'] for part in item['locator']['value']['declaration']): item['specId']
            for item in artifacts if item['locator']['value']['file'] == file
            and item['locator']['value']['declaration'][-1]['kind'] in ('function', 'method')}


def retire(previous, artifacts, ids, root):
    """Remove only explicitly identified baseline functions; actual handwritten code is checked separately."""
    desired = []
    for file in previous:
        module = cst.parse_module(file['text'])
        selected = {key for key, identity in locations(artifacts, file['file']).items() if identity in ids}
        if not selected:
            desired.append(file); continue
        removed = {node for key, node in functions(module).items() if key in selected}

        class Retire(cst.CSTTransformer):
            def leave_FunctionDef(self, node, updated):
                return cst.RemoveFromParent() if node in removed else updated

        after = module.visit(Retire())
        if file['driver'] or any(len(key) != 1 for key in selected) or functions(after) or cst.parse_module((root / file['file']).read_bytes()).code != module.code:
            desired.append({**file, 'text': after.code})
    return desired


def preserve(previous, desired, root, files, traces, identities=None, facts=None):
    """Reconcile identified native functions while retaining actual bodies, trivia and native references."""
    before = {file['file']: file for file in previous}
    after = {file['file']: file for file in desired}
    if before.keys() != after.keys() and identities is None:
        return [], [{"code": "unsupported-python-change", "file": "", "message": "Acceptance file additions and retirement need explicit reconciliation."}]
    for file in after.keys() - before.keys():
        if (root / file).exists():
            return [], [{"code": "output-conflict", "file": file, "message": "An unowned file already occupies this acceptance destination."}]
    rewritten, edits, retiring, renames = [], {}, {}, {}
    for file in files:
        wrapper = MetadataWrapper(cst.parse_module((root / file).read_bytes()))
        module = wrapper.module
        replacements, additions, removals = {}, {}, set()
        try:
            if file in before:
                old = cst.parse_module(before[file]['text'])
                if file not in after and module.code != old.code:
                    raise ChangeConflict('handwritten-removal', 'A whole-file retirement cannot discard handwritten code or comments.')
                new = cst.parse_module(after[file]['text']) if file in after else cst.Module([])
                owners = {(): module}
                original, wanted, actual = functions(old), functions(new), functions(module, owners)
                if not original.keys() <= actual.keys() or identities is None and original.keys() != wanted.keys():
                    raise ValueError("Acceptance declaration additions, renames and retirement need explicit reconciliation.")
                prior = locations(identities['previous'], file) if identities else {}
                following = locations(identities['next'], file) if identities else {}
                paired, used = {}, set()
                for key, node in original.items():
                    match = next((candidate for candidate, identity in following.items() if identity == prior[key] and candidate[:-1] == key[:-1]), None) if key in prior else key
                    if match in wanted:
                        if identities and identities.get('restoreOnly') and not same(node, wanted[match]):
                            raise ChangeConflict('use-update', 'Use update to change an existing generated function.')
                        paired[node] = wanted[match]; used.add(match)
                        replacements[actual[key]] = (node, wanted[match].with_changes(body=node.body) if before[file]['driver'] else wanted[match])
                        if key != match:
                            renames[(file, key)] = match[-1]
                    else:
                        if key not in prior:
                            raise ValueError('An internal generated function needs explicit reconciliation.')
                        code = lambda value: cst.Module([]).code_for_node(value).replace('\r\n', '\n').strip()
                        if code(actual[key]) != code(node):
                            raise ChangeConflict('handwritten-removal', 'A handwritten implementation or comment cannot be retired.')
                        removals.add(actual[key]); retiring[(file, key)] = actual[key]
                scopes = wrapper.resolve(ScopeProvider)
                for key in wanted:
                    if key in used:
                        continue
                    if key not in following:
                        raise ValueError('A new function requires an explicit specification identity.')
                    parent = owners.get(key[:-1])
                    if parent is None:
                        raise ValueError('A new function requires an existing native owner.')
                    scope = scopes[module] if parent is module else scopes[parent.body.body[0]]
                    if any(assignment.node not in removals for assignment in scope.assignments[key[-1]]):
                        raise ChangeConflict('native-name-conflict', 'A native declaration or import already uses ' + key[-1] + '.')
                    additions.setdefault(key[:-1], []).append(wanted[key])
                for key, destination in [(key, match.name.value) for key, node in original.items() if (match := paired.get(node)) and key[-1] != match.name.value]:
                    scope = scopes[actual[key]]
                    if any(assignment.node not in removals and assignment.node is not actual[key] for assignment in scope.assignments[destination]):
                        raise ChangeConflict('native-name-conflict', 'A native declaration or import already uses ' + destination + '.')

                class Baseline(cst.CSTTransformer):
                    def __init__(self):
                        self.scope = []

                    def visit_ClassDef(self, node):
                        self.scope.append(node.name.value)

                    def leave_ClassDef(self, node, updated):
                        extra = additions.get(tuple(self.scope), []); self.scope.pop()
                        return updated.with_changes(body=updated.body.with_changes(body=[*updated.body.body, *extra]))

                    def leave_FunctionDef(self, node, updated):
                        return paired.get(node, cst.RemoveFromParent()) if node in original.values() else updated

                    def leave_Module(self, node, updated):
                        return updated.with_changes(body=[*updated.body, *additions.get((), [])])

                if file in after and declarations(old.visit(Baseline()).code, before[file]['driver']) != declarations(new.code, before[file]['driver']):
                    raise ValueError("Changed module or class setup needs explicit reconciliation.")
            edits[file] = (wrapper, replacements, additions, removals)
        except (ValueError, SyntaxError, cst.ParserSyntaxError) as error:
            return [], [{'code': getattr(error, 'code', 'unsupported-python-change'), 'file': file, 'message': str(error)}]

    names = {}
    for (file, key), name in [*[(key, None) for key in retiring], *renames.items()]:
        selected = [item for item in (facts or {}).get('declarations', []) if item['file'] == file and tuple(part['name'] for part in item['declaration']) == key]
        if len(selected) != 1:
            if facts is None:
                continue
            return [], [{'code': 'incomplete-native-references', 'file': file, 'message': 'The changed function needs one native definition.'}]
        target_key = lambda target: (target['file'], target['line'], target['column'])
        target = target_key(selected[0]['target'])
        for use in facts['uses']:
            owner = tuple(part['name'] for part in use['owner'])
            if any(use['file'] == path and owner[:len(scope)] == scope for path, scope in retiring):
                continue
            if use.get('member') and use['name'] == key[-1] and len(use['targets']) != 1:
                return [], [{'code': 'incomplete-native-references', 'file': use['file'], 'start': use['start'], 'message': 'This same-named native member has no unique declaration.'}]
            matches = [value for value in use['targets'] if target_key(value) == target]
            if not matches:
                continue
            if name is None:
                return [], [{'code': 'native-reference-conflict', 'file': use['file'], 'start': use['start'], 'message': 'A surviving native caller uses the retiring function.'}]
            if len(use['targets']) != 1:
                return [], [{'code': 'incomplete-native-references', 'file': use['file'], 'start': use['start'], 'message': 'A renamed function has an ambiguous native use.'}]
            if use['name'] == key[-1]:
                names[(use['file'], use['start'])] = name

    for file, (wrapper, replacements, additions, removals) in edits.items():
        module = wrapper.module
        try:

            class Rewrite(cst.CSTTransformer):
                METADATA_DEPENDENCIES = (PositionProvider,)

                def __init__(self):
                    self.names, self.scope = {}, []

                def visit_ClassDef(self, node):
                    self.scope.append(node.name.value)

                def leave_ClassDef(self, node, updated):
                    extra = additions.get(tuple(self.scope), []); self.scope.pop()
                    return updated.with_changes(body=updated.body.with_changes(body=[*updated.body.body, *extra])) if extra else updated

                def leave_Name(self, node, updated):
                    at = self.get_metadata(PositionProvider, node).start
                    lines = module.code.splitlines(keepends=True)
                    start = len((''.join(lines[:at.line - 1]) + lines[at.line - 1][:at.column]).encode('utf-16-le')) // 2 + (module.encoding == 'utf-8-sig')
                    name = names.get((file, start))
                    result = updated.with_changes(value=name) if name else updated
                    self.names[node] = result
                    return result

                def leave_FunctionDef(self, node, updated):
                    if node in removals:
                        return cst.RemoveFromParent()
                    result = merge(*replacements[node], updated) if node in replacements else updated
                    self.names[node.name] = result.name
                    return result

                def leave_Module(self, node, updated):
                    return updated.with_changes(body=[*updated.body, *additions.get((), [])])

            editor = Rewrite()
            updated = wrapper.visit(editor)
            if file in before and file not in after:
                updated = cst.Module([])
            traces[file] = {"before": module, "after": updated, "names": editor.names, "file": file}
            if file not in before or file in after:
                rewritten.append({"file": file, "text": updated.bytes.decode('utf-8')})
        except (ValueError, SyntaxError, cst.ParserSyntaxError) as error:
            return [], [{'code': getattr(error, 'code', 'unsupported-python-change'), 'file': file, 'message': str(error)}]
    rewritten.extend({'file': file, 'text': value['text']} for file, value in after.items() if file not in before)
    return rewritten, []
