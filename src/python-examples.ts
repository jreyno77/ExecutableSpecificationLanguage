import type { Diagnostic } from './checking.js';
import type { Item } from './inspection-item.js';
import type { OutputContext } from './output.js';
import type { ArtifactAssociation, IdentifiedSpecification } from './specification-identity.js';
import type { PythonOptions } from './python-declarations.js';
import { pythonName } from './python-declarations.js';
import { PythonTypes } from './python-types.js';
import { decimal } from './decimal.js';
import { PythonData, pythonValue } from './python-data.js';
import type { PythonFacts } from './python-inspection.js';
import { canonical } from './identity-baseline.js';
import type { NodeId } from './model.js';
import type { TypeId } from './types.js';
import { ExpressionChecker } from './expression-checker.js';

type Operation = Item<'setup' | 'action' | 'observation' | 'check'>;
type Options = Pick<PythonOptions, 'names' | 'imports'> & { domain: string; testRoot: string };
type Driver = { file: string; module: string; name: string };
type Fixture = Driver & { parameter: string; generator: boolean };
const indent = (text: string): string => text.split('\n').map(line => '    ' + line).join('\n');

/** Checked examples become domain calls; the driver alone performs application effects. */
export class PythonExamples {
  readonly problems: Diagnostic[] = [];
  readonly obligations: Diagnostic[] = [];
  readonly artifacts: ArtifactAssociation[] = [];
  private readonly inspection;
  private readonly operations: Operation[];
  private readonly modules: Set<string>;
  private readonly types;
  private readonly data;
  private readonly expressions;
  private readonly values = new Map<string, TypeId>();
  private readonly imports = new Map<string, string>();
  constructor(private readonly current: IdentifiedSpecification, private readonly options: Options, context?: OutputContext,
    private readonly native?: { facts: PythonFacts; roots: readonly string[] }, private readonly driver?: Driver, private readonly fixture?: Fixture) {
    this.inspection = current.specification.inspection;
    this.modules = new Set([current.specification.entry, ...context?.workspaceModules ?? []]);
    this.operations = [...this.inspection.query('setup'), ...this.inspection.query('action'), ...this.inspection.query('observation'), ...this.inspection.query('check')].filter(item => this.owned(item));
    this.types = new PythonTypes(current.specification.types, item => this.imported(item), (code, item, message) => this.problem(code, item, message));
    this.data = new PythonData(current.specification.types);
    this.expressions = new ExpressionChecker(current.specification.types);
  }
  private imported(item: Item): string {
    const candidates = this.current.baseline.artifacts.filter(artifact => artifact.specId === this.current.id(item.id)
      && artifact.locator.outputId === 'python' && artifact.locator.format === 'python-symbol-1');
    if (candidates.length !== 1 || !this.native) return this.problem('missing-native-mapping', item, 'This acceptance type needs one checked native association.');
    const location = candidates[0]!.locator.value as { file: string; declaration: { kind: string; name: string }[] };
    const declaration = this.native.facts.declarations.filter(value => value.file === location.file && canonical(value.declaration) === canonical(location.declaration));
    const root = this.native.roots.find(root => location.file.startsWith(root + '/'));
    if (declaration.length !== 1 || !root || location.declaration.length !== 1) return this.problem('missing-native-mapping', item, 'The associated native type must have one importable definition.');
    const module = location.file.slice(root.length + 1).replace(/\.pyi?$/, '').replace(/\/__init__$/, '').replaceAll('/', '.');
    const name = location.declaration[0]!.name;
    if (!module.split('.').every(pythonName) || !pythonName(name)) return this.problem('invalid-native-mapping', item, 'The native type must have an importable Python name.');
    if (this.imports.has(name) && this.imports.get(name) !== module) return this.problem('native-name-conflict', item, 'Native type imports collide: ' + name);
    this.imports.set(name, module); return name;
  }
  private owned(item: Item): boolean { return item.origin.kind === 'source' && this.modules.has(item.origin.module); }
  private name(item: Item): string {
    const name = this.options.names.find(mapping => mapping.id === this.current.id(item.id))?.name ?? ('name' in item ? item.name : item.kind);
    if (!pythonName(name)) this.problem('invalid-native-name', item, 'Provide an explicit Python name for ' + name + '.'); return name;
  }
  private problem(code: string, item: Item, message: string): string { this.problems.push({ code, message, at: item.origin, related: [] }); return 'None'; }
  private type(item: Item): string {
    const fact = this.current.specification.types.typeOf(item.id);
    if (fact.status !== 'known') throw Error('Python acceptance requires checked type facts.'); return this.types.text(fact.value);
  }
  private known(item: Item): TypeId {
    const fact = this.current.specification.types.typeOf(item.id);
    if (fact.status !== 'known') throw Error('Python acceptance requires a checked value type.'); return fact.value;
  }
  private checked(value: string, type: Item): string {
    const fact = this.current.specification.types.typeOf(type.id);
    if (fact.status !== 'known') throw Error('Python acceptance requires a checked value type.');
    this.types.imports.add('cast as _expec_cast');
    return '_expec_cast(' + JSON.stringify(this.type(type)) + ', _expec.checked(' + value + ', _expec_types, ' + this.data.shape(fact.value) + '))';
  }
  private inferred(item: Item): TypeId | undefined {
    return this.expressions.typeOf(item.id, reference => {
      const binding = reference.resolution, target = binding.status === 'bound' ? this.inspection.read(binding.target) : undefined;
      const value = target?.kind === 'fixture' || target?.kind === 'parameter' ? this.known(target.declaredType)
        : reference.segments.length === 1 ? this.values.get(reference.segments[0]!) : undefined;
      return value ? { value, problems: [], deferred: [] } : undefined;
    }).value;
  }
  private comparison(left: Item, right: Item, receiver: string): string {
    const expected = this.inferred(left) ?? this.inferred(right);
    return this.expression(left, receiver, expected) + ', ' + this.expression(right, receiver, expected);
  }
  private expression(item: Item, receiver: string, expected?: TypeId): string {
    const catalog = this.current.specification.types, shape = expected && catalog.describe(expected);
    if (shape?.kind === 'alias' && shape.target.status === 'known') return this.expression(item, receiver, shape.target.value);
    if (shape?.kind === 'optional') return this.expression(item, receiver, shape.inner);
    switch (item.kind) {
      case 'string-literal': return JSON.stringify(item.value);
      case 'boolean-literal': return item.value ? 'True' : 'False';
      case 'number-literal': {
        const value = Number(item.token);
        if (!Number.isFinite(value) || decimal(item.token) !== decimal(String(value))) return this.problem('unsupported-native-number', item, 'Number must retain its binary64 value.');
        return Number.isInteger(value) && !/[eE]/.test(String(value)) ? value + '.0' : String(value);
      }
      case 'name-expression': {
        const binding = item.reference.resolution;
        if (binding.status === 'bound') {
          const target = this.inspection.read(binding.target);
          if (target.kind === 'fixture') return receiver + '.' + this.name(target);
          if (target.kind === 'parameter') return this.name(target);
        }
        return item.reference.segments.join('.');
      }
      case 'grouped-expression': return '(' + this.expression(item.inner, receiver, expected) + ')';
      case 'list-expression': {
        const values = item.elements.map((value, index) => this.expression(value, receiver, shape?.kind === 'tuple' ? shape.elements[index] : shape?.kind === 'builtin' ? shape.arguments[0] : undefined));
        return shape?.kind === 'tuple' ? '(' + values.join(', ') + (values.length === 1 ? ',' : '') + ')' : '[' + values.join(', ') + ']';
      }
      case 'record-expression': {
        const fields = item.declaredType || expected ? catalog.fields(item.declaredType ? this.known(item.declaredType) : expected!) : undefined;
        return '{' + item.entries.map(value => {
          const field = fields?.status === 'known' && fields.value.kind === 'available' ? fields.value.fields.find(field => this.inspection.read(field.declaration, 'field').name === value.name) : undefined;
          return JSON.stringify(value.name) + ': ' + this.expression(value.value, receiver, field?.type.status === 'known' ? field.type.value : undefined);
        }).join(', ') + '}';
      }
      case 'member-expression': return this.expression(item.receiver, receiver) + '[' + JSON.stringify(item.member.segments[0]) + ']';
      case 'unary-expression': return item.operator === 'not' ? '(not ' + this.expression(item.operand, receiver) + ')' : '_expec.number(' + item.operator + '_expec.number(' + this.expression(item.operand, receiver) + '))';
      case 'binary-expression': {
        if (item.operator === '==' || item.operator === '!=') return (item.operator === '!=' ? 'not ' : '') + '_expec.equal(' + this.comparison(item.left, item.right, receiver) + ')';
        const left = this.expression(item.left, receiver), right = this.expression(item.right, receiver);
        if (item.operator === 'and' || item.operator === 'or') return '(' + left + ' ' + item.operator + ' ' + right + ')';
        if (item.operator === '%') return '_expec.remainder(' + left + ', ' + right + ')';
        const value = '(_expec.number(' + left + ') ' + item.operator + ' _expec.number(' + right + '))';
        return ['<', '<=', '>', '>='].includes(item.operator) ? value : '_expec.number(' + value + ')';
      }
      case 'call-expression': {
        const selected = this.current.specification.call(item.id).value;
        const operation = this.operations.find(operation => operation.id === selected);
        if (!operation) return this.problem('missing-native-mapping', item, 'The application call requires its actual native association.');
        const values = [...item.arguments, ...operation.parameters.slice(item.arguments.length).flatMap(parameter => parameter.defaultValue ? [parameter.defaultValue] : [])];
        return receiver + '.' + this.name(operation) + '(' + values.map((value, index) => this.expression(value, receiver, this.known(operation.parameters[index]!.declaredType))).join(', ') + ')';
      }
      default: return this.problem('unsupported-native-expression', item, 'Python generation does not yet support ' + item.kind + '.');
    }
  }
  private assertion(item: Item, receiver: string): string {
    return item.kind === 'binary-expression' && item.operator === '=='
      ? '_expec.expect_data(' + this.comparison(item.left, item.right, receiver) + ')'
      : 'assert (' + this.expression(item, receiver) + ') is True';
  }
  private verification(item: Item<'prose-expectation'>): string {
    const message = 'Verification required: ' + item.text.value;
    this.obligations.push({ code: 'unimplemented-verification', message, at: item.origin, related: [] });
    return 'raise NotImplementedError(' + JSON.stringify(message) + ')';
  }
  private associate(item: Item, file: string, declaration: { kind: string; name: string }[]): void {
    this.artifacts.push({ specId: this.current.id(item.id), locator: { outputId: 'python-acceptance', format: 'python-symbol-1', value: { file, declaration } } });
  }
  driverCheck(): string | undefined {
    if (!this.driver) return;
    const checks = this.operations.filter(operation => operation.kind !== 'check' && operation.body.kind !== 'available').map((operation, index) => {
      const parameters = operation.parameters.map(parameter => this.name(parameter) + ': ' + this.type(parameter.declaredType));
      const result = operation.returnType ? this.type(operation.returnType) : 'None';
      let receiver = '_driver';
      while (operation.parameters.some(parameter => this.name(parameter) === receiver)) receiver = '_' + receiver;
      return 'def _expec_operation_' + index + '(' + [receiver + ': _ExpecDriver', ...parameters].join(', ') + ') -> ' + result + ':\n'
        + '    return ' + receiver + '.' + this.name(operation) + '(' + operation.parameters.map(parameter => this.name(parameter)).join(', ') + ')';
    });
    return 'from __future__ import annotations\n' + this.typings() + this.driverImport()
      + '\ndef _expec_construct() -> ' + (this.fixture ? 'type[_ExpecDriver]:\n    return _ExpecDriver' : '_ExpecDriver:\n    return _ExpecDriver()') + '\n\n' + checks.join('\n\n') + '\n';
  }
  fixtureCheck(): string | undefined {
    if (!this.fixture) return;
    const owner = this.options.domain[0]!.toUpperCase() + this.options.domain.slice(1);
    return 'from typing import Callable, Iterator, ParamSpec\nfrom dsl.' + this.options.domain + ' import ' + owner
      + '\nfrom ' + this.fixture.module + ' import ' + this.fixture.name + ' as _selected_fixture\n_P = ParamSpec("_P")\n'
      + 'def _expec_accept(factory: Callable[_P, ' + (this.fixture.generator ? 'Iterator[' + owner + ']' : owner) + ']) -> None: pass\n_expec_accept(_selected_fixture)\n';
  }
  bindDriver(methods: PythonFacts['declarations']): void {
    this.operations.filter(operation => operation.kind !== 'check' && operation.body.kind !== 'available').forEach((operation, index) => {
      const method = methods[index];
      if (!method) this.problem('invalid-native-driver', operation, 'The native checker did not identify this operation.');
      else this.associate(operation, method.file, method.declaration);
    });
  }
  private typings(): string {
    return (this.types.imports.size ? 'from typing import ' + [...this.types.imports].sort().join(', ') + '\n' : '')
      + [...this.imports].map(([name, module]) => 'from ' + module + ' import ' + name + '\n').join('');
  }
  private driverImport(): string {
    return this.driver ? 'from ' + this.driver.module + ' import ' + this.driver.name + ' as _ExpecDriver\n'
      : 'from driver.' + this.options.domain + '_driver import ' + this.options.domain[0]!.toUpperCase() + this.options.domain.slice(1) + 'Driver\n';
  }
  private fixtureAdmission(owner: string): string {
    if (!this.fixture) return '';
    const methods = this.operations.map(operation => this.name(operation)).map(name => '        (' + JSON.stringify(name) + ', ' + owner + '.' + name + ', ' + owner + '.' + name + '.__code__),');
    return '\ndef _expec_fixture(value: ' + owner + ', _owner: type[' + owner + '] = ' + owner
      + ',\n    _dictionary: object = ' + owner + '.__dict__["__dict__"],\n    _operations: tuple[tuple[str, object, object], ...] = (\n' + methods.join('\n') + '\n    )) -> None:\n'
      + '    if type(value) is not _owner:\n        raise AssertionError("Expected the actual generated ' + owner + ' fixture.")\n'
      + '    members = type.__getattribute__(_owner, "__dict__")\n'
      + '    if "__getattr__" in members or members.get("__getattribute__", object.__getattribute__) is not object.__getattribute__ or members.get("__dict__") is not _dictionary:\n'
      + '        raise AssertionError("The generated fixture access protocol changed.")\n'
      + '    values = object.__getattribute__(value, "__dict__")\n'
      + '    for name, function, code in _operations:\n'
      + '        if name in values or members.get(name) is not function or object.__getattribute__(function, "__code__") is not code:\n'
      + '            raise AssertionError("The generated fixture operation changed: " + name)\n';
  }
  private method(operation: Operation, driver: boolean, path: string, owner: string): string {
    this.values.clear();
    const name = this.name(operation), parameters = operation.parameters.map(parameter => this.name(parameter) + ': ' + this.type(parameter.declaredType));
    const result = operation.kind === 'check' || !operation.returnType ? 'None' : this.type(operation.returnType);
    this.associate(operation, path, [{ kind: 'class', name: owner }, { kind: 'method', name }]);
    let body: string;
    if (driver || operation.body.kind !== 'available' && operation.kind === 'check') {
      body = 'raise NotImplementedError(' + JSON.stringify('Not implemented: ' + this.options.domain + '.' + name) + ')';
      this.obligations.push({ code: 'implementation-required', message: 'Implement ' + this.options.domain + '.' + name + '.', at: operation.origin, related: [] });
    } else if (operation.body.kind === 'available') body = operation.body.content.members.map(statement => {
      if (statement.kind === 'let') {
        if (!pythonName(statement.name) || ['self', '_expec', '_expec_types', '_expec_cast'].includes(statement.name)) this.problem('native-name-conflict', statement, 'Local conflicts with a generated native name: ' + statement.name);
        const value = this.inferred(statement.value), emitted = this.expression(statement.value, 'self', value);
        if (value) this.values.set(statement.name, value);
        return statement.name + ' = ' + emitted;
      }
      if (statement.kind === 'assert') return this.assertion(statement.expression, 'self');
      if (statement.kind === 'do') return this.expression(statement.expression, 'self');
      if (statement.kind === 'return') return 'return ' + (operation.returnType ? this.checked(this.expression(statement.expression, 'self', this.known(operation.returnType)), operation.returnType) : this.expression(statement.expression, 'self'));
      return this.problem('unsupported-native-statement', statement, 'Python operation bodies do not yet support ' + statement.kind + '.');
    }).join('\n') || 'pass';
    else {
      const call = 'self.driver.' + name + '(' + operation.parameters.map(parameter => this.name(parameter)).join(', ') + ')';
      body = 'return ' + (operation.returnType ? this.checked(call, operation.returnType) : call);
    }
    if (!driver) body = [...operation.parameters.map(parameter => this.name(parameter) + ' = ' + this.checked(this.name(parameter), parameter.declaredType)), body].join('\n');
    return 'def ' + name + '(' + ['self', ...parameters].join(', ') + ') -> ' + result + ':\n' + indent(body);
  }
  files(): { path: string; text: string }[] {
    const { domain, testRoot } = this.options, owner = domain[0]!.toUpperCase() + domain.slice(1), driverName = this.driver ? '_ExpecDriver' : owner + 'Driver';
    const receiver = this.fixture?.parameter ?? domain;
    if (!pythonName(receiver) || ['_expec', '_expec_fixture'].includes(receiver) || this.fixture && ['_expec', '_expec_fixture', owner].includes(this.fixture.name)) this.problems.push({ code: 'invalid-native-fixture', message: 'The fixture needs usable native import and test parameter names.', at: { kind: 'dependency', path: ['outputs', 'python-acceptance', 'fixture'] }, related: [] });
    if (domain.toLowerCase() === 'comparison' || ['_expec', '_expec_fixture'].includes(domain) || !pythonName(owner)) this.problems.push({ code: 'native-name-conflict',
      message: 'The domain conflicts with a native keyword or generated comparison name: ' + domain, at: { kind: 'dependency', path: ['outputs', 'python-acceptance', 'domain'] }, related: [] });
    const driverPath = testRoot + '/driver/' + domain + '_driver.py', dslPath = testRoot + '/dsl/' + domain + '.py', testPath = testRoot + '/acceptance/test_' + domain + '.py';
    const used = new Set(['driver', '__init__']);
    for (const operation of this.operations) {
      const name = this.name(operation);
      if (used.has(name)) this.problem('native-name-conflict', operation, 'Distinct operations need distinct native names: ' + name); used.add(name);
      const parameters = new Set(['self', '_expec', '_expec_types', '_expec_cast']);
      for (const parameter of operation.parameters) {
        const name = this.name(parameter);
        if (parameters.has(name)) this.problem('native-name-conflict', parameter, 'Parameter conflicts with another native name: ' + name); parameters.add(name);
      }
    }
    const fixtures: { name: string; type: string; value: string }[] = [], visited = new Set<NodeId>();
    const fixture = (item: Item<'fixture'>): void => {
      if (visited.has(item.id)) return; visited.add(item.id);
      const name = this.name(item);
      if (used.has(name)) this.problem('native-name-conflict', item, 'Distinct data and operations need distinct native names: ' + name); used.add(name);
      const dependencies = (node: Item): void => {
        if (node.kind === 'reference' && node.resolution.status === 'bound') {
          const target = this.inspection.read(node.resolution.target); if (target.kind === 'fixture') fixture(target);
        }
        for (const child of this.inspection.children(node.id)) dependencies(child);
      };
      dependencies(item.value);
      fixtures.push({ name, type: this.type(item.declaredType), value: this.checked(this.expression(item.value, 'self', this.known(item.declaredType)), item.declaredType) });
      this.associate(item, dslPath, [{ kind: 'class', name: owner }, { kind: 'field', name }]);
    };
    for (const item of this.inspection.query('fixture')) if (this.owned(item)) fixture(item);
    const driverMethods = this.driver ? [] : this.operations.filter(operation => operation.kind !== 'check' && operation.body.kind !== 'available').map(operation => this.method(operation, true, driverPath, driverName));
    const methods = this.operations.map(operation => this.method(operation, false, dslPath, owner));
    const tests: string[] = [], names = new Set<string>();
    for (const group of this.inspection.query('examples')) if (this.owned(group)) for (const scenario of group.members) {
      if (scenario.kind !== 'scenario' && scenario.kind !== 'example') continue;
      this.values.clear();
      const name = 'test_' + scenario.title.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
      if (!pythonName(name) || names.has(name)) this.problem('native-name-conflict', scenario, 'Scenario titles need distinct Python test names.'); names.add(name);
      this.associate(scenario, testPath, [{ kind: 'function', name }]);
      let steps: string[];
      if (scenario.kind === 'example') steps = [scenario.expected.kind === 'prose-expectation'
        ? this.expression(scenario.actual, receiver) + '\n' + this.verification(scenario.expected)
        : '_expec.expect_data(' + this.comparison(scenario.actual, scenario.expected, receiver) + ')'];
      else steps = scenario.steps.map(step => {
        const facts = this.current.specification.step(step.id).value;
        if (!facts) throw Error('Python acceptance requires checked steps.');
        this.values.clear();
        for (const capture of facts.available) this.values.set(this.inspection.read(capture.name, 'name').decoded, capture.type);
        if (step.content.kind === 'prose-expectation') return this.verification(step.content);
        if (facts.capture) {
          const name = this.inspection.read(facts.capture.name, 'name').decoded;
          if (!pythonName(name) || [receiver, '_expec', '_expec_fixture'].includes(name)) this.problem('native-name-conflict', step, 'Capture conflicts with a generated native name: ' + name);
          return name + ' = ' + this.expression(step.content, receiver);
        }
        const check = step.content.kind === 'call-expression' && this.inspection.read(this.current.specification.call(step.content.id).value!).kind === 'check';
        return step.kind === 'then' && !check ? this.assertion(step.content, receiver) : this.expression(step.content, receiver);
      });
      if (this.fixture) steps.unshift('_expec_fixture(' + receiver + ')');
      tests.push('# @expec-test ' + JSON.stringify(this.current.id(scenario.id)) + '\ndef ' + name + '(' + receiver + ': ' + owner + ') -> None:\n' + indent(steps.join('\n') || 'raise NotImplementedError("Empty scenario")'));
    }
    const typings = this.typings(), driverImport = this.driverImport();
    return [
      ...this.driver ? [] : [{ path: driverPath, text: 'from __future__ import annotations\n' + typings + '\nclass ' + driverName + ':\n' + indent(driverMethods.join('\n\n') || 'pass') + '\n' }],
      { path: dslPath, text: 'from __future__ import annotations\n' + typings + driverImport + 'from dsl import comparison as _expec\n\n_expec_types: _expec.Shapes = ' + pythonValue(this.data.shapes) + '\n\nclass ' + owner + ':\n' + indent(fixtures.map(fixture => fixture.name + ': ' + fixture.type + '\n').join('') + 'def __init__(self, driver: ' + driverName + ') -> None:\n' + indent(['self.driver = driver', ...fixtures.map(fixture => 'self.' + fixture.name + ' = ' + fixture.value)].join('\n')) + '\n\n' + methods.join('\n\n')) + '\n' + this.fixtureAdmission(owner) },
      ...this.fixture ? [] : [{ path: testRoot + '/dsl/' + domain + '_fixture.py', text: 'import pytest\n' + driverImport + 'from dsl.' + domain + ' import ' + owner + '\n\n@pytest.fixture\ndef ' + domain + '() -> ' + owner + ':\n    return ' + owner + '(' + driverName + '())\n' }],
      { path: testPath, text: 'from dsl.' + domain + ' import ' + owner + (this.fixture ? ', _expec_fixture' : '') + '\nfrom ' + (this.fixture ? this.fixture.module + ' import ' + this.fixture.name : 'dsl.' + domain + '_fixture import ' + domain) + '\nfrom dsl import comparison as _expec\n\n' + tests.join('\n\n') + '\n' },
    ];
  }
}
