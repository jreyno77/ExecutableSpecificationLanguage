"""Recognize a captured pytest fixture without importing or running application code."""
import pathlib
import libcst as cst
from libcst.metadata import MetadataWrapper, PositionProvider


def read(request, facts):
    selected = request['fixture']
    path = pathlib.Path(request['root']) / selected['file']
    found = [item for item in facts['declarations'] if item['file'] == selected['file']
             and item['declaration'] == [{'kind': 'function', 'name': selected['name']}]]

    def problem(code, message):
        facts['problems'].append({'code': code, 'file': selected['file'],
                                  **({'start': found[0]['start']} if len(found) == 1 else {}), 'message': message})

    if len(found) != 1:
        problem('invalid-native-fixture', 'Select one actual top-level fixture function.')
        return
    wrapper = MetadataWrapper(cst.parse_module(path.read_bytes()))
    node = next((item for item in wrapper.module.body if isinstance(item, cst.FunctionDef) and item.name.value == selected['name']), None)
    if node is None:
        problem('invalid-native-fixture', 'The fixture must have an ordinary function definition.')
        return
    if node.asynchronous:
        problem('unsupported-native-async', 'This native fixture profile requires a synchronous function.')
        return
    if len(node.decorators) != 1:
        problem('unsupported-native-fixture', 'Select a standard fixture without additional decorators.')
        return
    decorator = node.decorators[0].decorator
    callee = decorator.func if isinstance(decorator, cst.Call) else decorator
    name = callee.attr if isinstance(callee, cst.Attribute) else callee
    if not isinstance(name, cst.Name):
        problem('invalid-native-fixture', 'The fixture decorator needs one native declaration.')
        return
    at = wrapper.resolve(PositionProvider)[name].start
    data = path.read_bytes()
    lines = data.decode('utf-8-sig').splitlines(keepends=True)
    offset = len((''.join(lines[:at.line - 1]) + lines[at.line - 1][:at.column]).encode('utf-16-le')) // 2 + int(data.startswith(b'\xef\xbb\xbf'))
    uses = [use for use in facts['uses'] if use['file'] == selected['file'] and use['start'] == offset]
    if len(uses) != 1 or len(uses[0]['targets']) != 1 or uses[0]['targets'][0]['name'] != 'fixture' or not any(
            pathlib.Path(uses[0]['targets'][0]['file']) == pathlib.Path(site) / '_pytest' / 'fixtures.py' for site in request['sites']):
        problem('invalid-native-fixture', 'The decorator must resolve to the captured pytest.fixture function.')
        return
    fixture_name = selected['name']
    keywords = set()
    for argument in decorator.args if isinstance(decorator, cst.Call) else []:
        key = argument.keyword.value if argument.keyword else None
        if argument.star or key in keywords or key not in ('name', 'scope') or not isinstance(argument.value, cst.SimpleString):
            problem('unsupported-native-fixture', 'Only literal name and function scope are supported fixture options.')
            return
        keywords.add(key)
        value = argument.value.evaluated_value
        if key == 'scope' and value != 'function':
            problem('unsupported-native-fixture', 'Each scenario requires a function-scoped fixture.')
            return
        if key == 'name':
            fixture_name = value
    if not isinstance(fixture_name, str):
        problem('invalid-native-fixture', 'The native fixture name must be text.')
        return
    if fixture_name == 'request':
        problem('invalid-native-fixture', 'Pytest reserves the fixture name request.')
        return

    class Yields(cst.CSTVisitor):
        found = False
        def visit_Yield(self, node): self.found = True
        def visit_FunctionDef(self, node): return False
        def visit_ClassDef(self, node): return False
        def visit_Lambda(self, node): return False

    yields = Yields()
    node.body.visit(yields)
    facts['fixture'] = {'name': fixture_name, 'generator': yields.found}
    return path, wrapper.module.deep_replace(node, node.with_changes(decorators=[]))
