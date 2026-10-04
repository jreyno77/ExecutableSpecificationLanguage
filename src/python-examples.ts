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

type Operation = Item<'setup' | 'action' | 'observation' | 'check'>;
type Options = Pick<PythonOptions, 'names' | 'imports'> & { domain: string; testRoot: string };
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
  private readonly imports = new Map<string, string>();
  constructor(private readonly current: IdentifiedSpecification, private readonly options: Options, context?: OutputContext,
    private readonly native?: { facts: PythonFacts; roots: readonly string[] }) {
    this.inspection = current.specification.inspection;
    this.modules = new Set([current.specification.entry, ...context?.workspaceModules ?? []]);
    this.operations = [...this.inspection.query('setup'), ...this.inspection.query('action'), ...this.inspection.query('observation'), ...this.inspection.query('check')].filter(item => this.owned(item));
    this.types = new PythonTypes(current.specification.types, item => this.imported(item), (code, item, message) => this.problem(code, item, message));
    this.data = new PythonData(current.specification.types);
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
  private checked(value: string, type: Item): string {
    const fact = this.current.specification.types.typeOf(type.id);
    if (fact.status !== 'known') throw Error('Python acceptance requires a checked value type.');
    return '_expec.checked(' + value + ', _expec_types, ' + this.data.shape(fact.value) + ')';
  }
  private expression(item: Item, receiver: string): string {
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
        return binding.status === 'bound' && this.inspection.read(binding.target).kind === 'parameter'
          ? this.name(this.inspection.read(binding.target)) : item.reference.segments.join('.');
      }
      case 'grouped-expression': return '(' + this.expression(item.inner, receiver) + ')';
      case 'list-expression': return '[' + item.elements.map(value => this.expression(value, receiver)).join(', ') + ']';
      case 'record-expression': return '{' + item.entries.map(value => JSON.stringify(value.name) + ': ' + this.expression(value.value, receiver)).join(', ') + '}';
      case 'member-expression': return this.expression(item.receiver, receiver) + '[' + JSON.stringify(item.member.segments[0]) + ']';
      case 'unary-expression': return item.operator === 'not' ? '(not ' + this.expression(item.operand, receiver) + ')' : '_expec.number(' + item.operator + '_expec.number(' + this.expression(item.operand, receiver) + '))';
      case 'binary-expression': {
        const left = this.expression(item.left, receiver), right = this.expression(item.right, receiver);
        if (item.operator === '==' || item.operator === '!=') return (item.operator === '!=' ? 'not ' : '') + '_expec.equal(' + left + ', ' + right + ')';
        if (item.operator === 'and' || item.operator === 'or') return '(' + left + ' ' + item.operator + ' ' + right + ')';
        const value = '(_expec.number(' + left + ') ' + item.operator + ' _expec.number(' + right + '))';
        return ['<', '<=', '>', '>='].includes(item.operator) ? value : '_expec.number(' + value + ')';
      }
      case 'call-expression': {
        const selected = this.current.specification.call(item.id).value;
        const operation = this.operations.find(operation => operation.id === selected);
        if (!operation) return this.problem('missing-native-mapping', item, 'The application call requires its actual native association.');
        return receiver + '.' + this.name(operation) + '(' + item.arguments.map(value => this.expression(value, receiver)).join(', ') + ')';
      }
      default: return this.problem('unsupported-native-expression', item, 'Python generation does not yet support ' + item.kind + '.');
    }
  }
  private assertion(item: Item, receiver: string): string {
    return item.kind === 'binary-expression' && item.operator === '=='
      ? '_expec.expect_data(' + this.expression(item.left, receiver) + ', ' + this.expression(item.right, receiver) + ')'
      : 'assert (' + this.expression(item, receiver) + ') is True';
  }
  private associate(item: Item, file: string, declaration: { kind: string; name: string }[]): void {
    this.artifacts.push({ specId: this.current.id(item.id), locator: { outputId: 'python-acceptance', format: 'python-symbol-1', value: { file, declaration } } });
  }
  private method(operation: Operation, driver: boolean, path: string, owner: string): string {
    const name = this.name(operation), parameters = operation.parameters.map(parameter => this.name(parameter) + ': ' + this.type(parameter.declaredType));
    const result = operation.kind === 'check' || !operation.returnType ? 'None' : this.type(operation.returnType);
    this.associate(operation, path, [{ kind: 'class', name: owner }, { kind: 'method', name }]);
    let body: string;
    if (driver || operation.body.kind !== 'available' && operation.kind === 'check') {
      body = 'raise NotImplementedError(' + JSON.stringify('Not implemented: ' + this.options.domain + '.' + name) + ')';
      this.obligations.push({ code: 'implementation-required', message: 'Implement ' + this.options.domain + '.' + name + '.', at: operation.origin, related: [] });
    } else if (operation.body.kind === 'available') body = operation.body.content.members.map(statement => {
      if (statement.kind === 'let') {
        if (!pythonName(statement.name) || ['self', '_expec', '_expec_types'].includes(statement.name)) this.problem('native-name-conflict', statement, 'Local conflicts with a generated native name: ' + statement.name);
        return statement.name + ' = ' + this.expression(statement.value, 'self');
      }
      if (statement.kind === 'assert') return this.assertion(statement.expression, 'self');
      if (statement.kind === 'do') return this.expression(statement.expression, 'self');
      if (statement.kind === 'return') return 'return ' + (operation.returnType ? this.checked(this.expression(statement.expression, 'self'), operation.returnType) : this.expression(statement.expression, 'self'));
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
    const { domain, testRoot } = this.options, owner = domain[0]!.toUpperCase() + domain.slice(1), driverName = owner + 'Driver';
    if (domain.toLowerCase() === 'comparison' || domain === '_expec' || !pythonName(owner)) this.problems.push({ code: 'native-name-conflict',
      message: 'The domain conflicts with a native keyword or generated comparison name: ' + domain, at: { kind: 'dependency', path: ['outputs', 'python-acceptance', 'domain'] }, related: [] });
    const driverPath = testRoot + '/driver/' + domain + '_driver.py', dslPath = testRoot + '/dsl/' + domain + '.py', testPath = testRoot + '/acceptance/test_' + domain + '.py';
    const used = new Set(['driver', '__init__']);
    for (const operation of this.operations) {
      const name = this.name(operation);
      if (used.has(name)) this.problem('native-name-conflict', operation, 'Distinct operations need distinct native names: ' + name); used.add(name);
      const parameters = new Set(['self', '_expec', '_expec_types']);
      for (const parameter of operation.parameters) {
        const name = this.name(parameter);
        if (parameters.has(name)) this.problem('native-name-conflict', parameter, 'Parameter conflicts with another native name: ' + name); parameters.add(name);
      }
    }
    const driverMethods = this.operations.filter(operation => operation.kind !== 'check' && operation.body.kind !== 'available').map(operation => this.method(operation, true, driverPath, driverName));
    const methods = this.operations.map(operation => this.method(operation, false, dslPath, owner));
    const tests: string[] = [], names = new Set<string>();
    for (const group of this.inspection.query('examples')) if (this.owned(group)) for (const scenario of group.members) {
      if (scenario.kind !== 'scenario' && scenario.kind !== 'example') continue;
      const name = 'test_' + scenario.title.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
      if (!pythonName(name) || names.has(name)) this.problem('native-name-conflict', scenario, 'Scenario titles need distinct Python test names.'); names.add(name);
      this.associate(scenario, testPath, [{ kind: 'function', name }]);
      let steps: string[];
      if (scenario.kind === 'example') steps = [scenario.expected.kind === 'prose-expectation'
        ? 'raise NotImplementedError("Verification required")'
        : '_expec.expect_data(' + this.expression(scenario.actual, domain) + ', ' + this.expression(scenario.expected, domain) + ')'];
      else steps = scenario.steps.map(step => {
        const facts = this.current.specification.step(step.id).value;
        if (!facts) throw Error('Python acceptance requires checked steps.');
        if (facts.capture) return this.inspection.read(facts.capture.name, 'name').decoded + ' = ' + this.expression(step.content, domain);
        const check = step.content.kind === 'call-expression' && this.inspection.read(this.current.specification.call(step.content.id).value!).kind === 'check';
        return step.kind === 'then' && !check ? this.assertion(step.content, domain) : this.expression(step.content, domain);
      });
      tests.push('# @expec-test ' + JSON.stringify(this.current.id(scenario.id)) + '\ndef ' + name + '(' + domain + ': ' + owner + ') -> None:\n' + indent(steps.join('\n') || 'raise NotImplementedError("Empty scenario")'));
    }
    const typings = (this.types.imports.size ? 'from typing import ' + [...this.types.imports].sort().join(', ') + '\n' : '')
      + [...this.imports].map(([name, module]) => 'from ' + module + ' import ' + name + '\n').join('');
    return [
      { path: driverPath, text: 'from __future__ import annotations\n' + typings + '\nclass ' + driverName + ':\n' + indent(driverMethods.join('\n\n') || 'pass') + '\n' },
      { path: dslPath, text: 'from __future__ import annotations\n' + typings + 'from driver.' + domain + '_driver import ' + driverName + '\nfrom dsl import comparison as _expec\n\n_expec_types = ' + pythonValue(this.data.shapes) + '\n\nclass ' + owner + ':\n' + indent('def __init__(self, driver: ' + driverName + ') -> None:\n    self.driver = driver\n\n' + methods.join('\n\n')) + '\n' },
      { path: testRoot + '/dsl/' + domain + '_fixture.py', text: 'import pytest\nfrom driver.' + domain + '_driver import ' + driverName + '\nfrom dsl.' + domain + ' import ' + owner + '\n\n@pytest.fixture\ndef ' + domain + '() -> ' + owner + ':\n    return ' + owner + '(' + driverName + '())\n' },
      { path: testPath, text: 'from dsl.' + domain + ' import ' + owner + '\nfrom dsl.' + domain + '_fixture import ' + domain + '\nfrom dsl import comparison as _expec\n\n' + tests.join('\n\n') + '\n' },
    ];
  }
}
