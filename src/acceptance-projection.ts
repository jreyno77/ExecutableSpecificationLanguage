import type { Diagnostic } from './checking.js';
import type { Item } from './inspection-item.js';
import type { IdentifiedSpecification, ArtifactAssociation } from './specification-identity.js';
import type { NodeId } from './model.js';
import { decimal } from './decimal.js';
import { posix } from 'node:path';
import type { TypeId } from './types.js';
import { acceptanceRuntime } from './acceptance-runtime.js';
import type { AcceptanceBindings } from './acceptance-bindings.js';

type Operation = Item<'setup' | 'action' | 'observation' | 'check'>;
export interface AcceptanceFile { path: string; text: string }
export interface AcceptanceTarget { file: string; name: string }
const quote = JSON.stringify;

/** Emits readable domain calls from the compiler's already checked operations. */
export class AcceptanceProjection {
  readonly problems: Diagnostic[] = [];
  readonly artifacts: ArtifactAssociation[] = [];
  readonly obligations: Diagnostic[] = [];
  private imports = new Map<string, AcceptanceTarget>();
  private readonly inspection;
  private readonly operations: Operation[];
  constructor(private readonly current: IdentifiedSpecification, private readonly domain: string, private readonly root: string,
    private readonly driver?: { file: string; name: string }, private readonly targets = new Map<string, AcceptanceTarget>(), private readonly bindings?: AcceptanceBindings) {
    this.inspection = current.specification.inspection;
    this.operations = [...this.inspection.query('setup'), ...this.inspection.query('action'), ...this.inspection.query('observation'), ...this.inspection.query('check')];
  }
  private name(item: Item): string { return this.bindings?.name(item) ?? ('name' in item ? item.name : item.kind); }
  private problem(code: string, at: Item, message: string): string {
    this.problems.push({ code, message, at: at.origin, related: [] }); return 'undefined';
  }
  private imported(target: AcceptanceTarget): string {
    const name = [this.domain, 'expect', 'test', 'expectData', 'comparisonData', 'comparisonEqual', 'finiteNumber'].includes(target.name) ? target.name + 'Implementation' : target.name;
    this.imports.set(name, target); return name;
  }
  private expression(node: Item, receiver: string): string {
    switch (node.kind) {
      case 'string-literal': return quote(node.value);
      case 'number-literal': return Number.isFinite(Number(node.token)) && decimal(node.token) === decimal(String(Number(node.token)))
        ? node.token : this.problem('unsupported-number-literal', node, 'Number literal cannot round-trip through binary64.');
      case 'boolean-literal': return String(node.value);
      case 'name-expression': {
        const binding = node.reference.resolution;
        if (binding.status === 'bound') {
          const target = this.inspection.read(binding.target);
          if (target.kind === 'fixture') return receiver + '.' + target.name;
        }
        return node.reference.segments.join('.');
      }
      case 'grouped-expression': return '(' + this.expression(node.inner, receiver) + ')';
      case 'list-expression': return '[' + node.elements.map(item => this.expression(item, receiver)).join(', ') + ']';
      case 'record-expression': return '{ ' + node.entries.map(item => '[' + quote(item.name) + ']: ' + this.expression(item.value, receiver)).join(', ') + ' }';
      case 'binary-expression': {
        const left = this.expression(node.left, receiver), right = this.expression(node.right, receiver);
        if (node.operator === '==' || node.operator === '!=') return (node.operator === '!=' ? '!' : '') + 'comparisonEqual(' + left + ', ' + right + ')';
        if (node.operator === 'and' || node.operator === 'or') return '(' + left + (node.operator === 'and' ? ' && ' : ' || ') + right + ')';
        const at = node.origin.kind === 'source' ? node.origin.range.sourceId + ':' + node.origin.range.start.line + ':' + node.origin.range.start.column : node.kind;
        const expression = '(finiteNumber(' + left + ', ' + quote('left at ' + at) + ') ' + node.operator + ' finiteNumber(' + right + ', ' + quote('right at ' + at) + '))';
        return ['<', '<=', '>', '>='].includes(node.operator) ? expression : 'finiteNumber(' + expression + ', ' + quote('result at ' + at) + ')';
      }
      case 'call-expression': {
        const selected = this.current.specification.call(node.id).value!;
        const operation = this.inspection.read(selected);
        const target = this.targets.get(this.current.id(selected));
        if (target) return 'await ' + this.imported(target) + '(' + node.arguments.map(item => this.expression(item, receiver)).join(', ') + ')';
        if (!this.operations.some(item => item.id === selected)) return this.problem('missing-native-mapping', node, 'The selected application call requires its actual executable association.');
        if (!('name' in operation)) return this.problem('missing-native-mapping', node, 'This checked call needs an executable native association.');
        const prefix = receiver === 'this' && 'body' in operation && operation.body.kind === 'absent' && operation.kind !== 'check' ? 'this.driver' : receiver;
        return 'await ' + prefix + '.' + this.name(operation) + '(' + node.arguments.map(item => this.expression(item, receiver)).join(', ') + ')';
      }
      default: return this.problem('unsupported-output', node, 'Expression generation is not available for ' + node.kind + '.');
    }
  }
  private assertion(node: Item, receiver: string): string {
    if (node.kind === 'binary-expression' && node.operator === '==') return 'expectData(' + this.expression(node.left, receiver) + ', ' + this.expression(node.right, receiver) + ');';
    return 'expect(' + this.expression(node, receiver) + ').toBe(true);';
  }
  private type(id: NodeId): string {
    const fact = this.current.specification.types.typeOf(id);
    if (fact.status !== 'known') throw Error('A checked signature must have a known type.');
    return this.typeValue(fact.value);
  }
  private typeValue(id: TypeId): string {
    const type = this.current.specification.types.describe(id);
    if (type.kind === 'builtin') {
      const item = this.inspection.read(type.declaration, 'builtin-type');
      if (item.name === 'List') return 'Array<' + this.typeValue(type.arguments[0]!) + '>';
      return ({ Text: 'string', Number: 'number', Boolean: 'boolean', Nothing: 'void' } as Record<string, string>)[item.name] ?? 'unknown';
    }
    if (type.kind === 'declared' || type.kind === 'alias' || type.kind === 'parameter') {
      const target = this.targets.get(this.current.id(type.declaration));
      if (target) return this.imported(target);
      return this.problem('missing-native-mapping', this.inspection.read(type.declaration), 'The declared runtime type requires its exact native association.');
    }
    if (type.kind === 'optional') return this.typeValue(type.inner) + ' | undefined';
    if (type.kind === 'tuple') return '[' + type.elements.map(item => this.typeValue(item)).join(', ') + ']';
    if (type.kind === 'union') return type.alternatives.map(item => this.typeValue(item)).join(' | ');
    if (type.kind === 'literal') { const literal = this.inspection.read(type.expression, 'literal-type'); return this.expression(literal.value, ''); }
    throw Error('Unsupported checked type.');
  }
  private method(operation: Operation, driver: boolean): string {
    const parameters = operation.parameters.map(parameter => this.name(parameter) + ': ' + this.type(parameter.declaredType.id)).join(', ');
    const result = operation.kind === 'check' || !operation.returnType ? 'void' : this.type(operation.returnType.id);
    const missing = 'throw new Error(' + quote('Not implemented: ' + this.domain + '.' + this.name(operation)) + ');';
    let body = missing;
    if (driver || operation.kind === 'check' && operation.body.kind === 'absent') this.obligations.push({ code: 'implementation-required', message: 'Implement ' + this.domain + '.' + operation.name + '.', at: operation.origin, related: [] });
    if (!driver && operation.body.kind === 'available') body = operation.body.content.members.map(statement => {
      switch (statement.kind) {
        case 'let': return 'const ' + statement.name + ' = ' + this.expression(statement.value, 'this') + ';';
        case 'assert': return this.assertion(statement.expression, 'this');
        case 'do': return this.expression(statement.expression, 'this') + ';';
        case 'return': return 'return ' + this.expression(statement.expression, 'this') + ';';
      }
    }).join('\n    ');
    else if (!driver && operation.kind !== 'check') body = 'return await this.driver.' + this.name(operation) + '(' + operation.parameters.map(parameter => this.name(parameter)).join(', ') + ');';
    return '  async ' + this.name(operation) + '(' + parameters + '): Promise<' + result + '> {\n    ' + body + '\n  }';
  }
  files(): AcceptanceFile[] {
    const className = this.domain[0]!.toUpperCase() + this.domain.slice(1), groups = [...this.inspection.query('examples')], tests: AcceptanceFile[] = [];
    const paths = new Set<string>(), names = new Set<string>();
    for (const operation of this.operations) {
      const name = this.name(operation);
      if (names.has(name)) this.problem('native-name-conflict', operation, 'Distinct operations require distinct native names: ' + name); names.add(name);
    }
    for (const group of groups) {
      const path = this.root + '/acceptance/' + (this.bindings?.group(group) ?? this.domain) + '.test.ts';
      if (paths.has(path.toLowerCase())) this.problem('ambiguous-group-name', group, 'Give groups distinct readable names through their durable identities.'); paths.add(path.toLowerCase());
      this.imports.clear();
      this.artifacts.push({ specId: this.current.id(group.id), locator: { outputId: 'acceptance', format: 'typescript-file-1', value: { file: path } } });
      const bodies = group.members.filter(member => member.kind === 'scenario' || member.kind === 'example').map(scenario => {
        const id = this.current.id(scenario.id);
        this.artifacts.push({ specId: id, locator: { outputId: 'acceptance', format: 'vitest-test-1', value: { file: path, id } } });
        const expected = (actual: Item, expectation: Item): string => {
          if (expectation.kind === 'prose-expectation') {
            this.obligations.push({ code: 'verification-required', message: expectation.text.value, at: expectation.origin, related: [] });
            return this.expression(actual, this.domain) + ';\n  throw new Error(' + quote('Verification required: ' + expectation.text.value) + ');';
          }
          return 'expectData(' + this.expression(actual, this.domain) + ', ' + this.expression(expectation, this.domain) + ');';
        };
        const steps = scenario.kind === 'example' ? ['  ' + expected(scenario.actual, scenario.expected)] : scenario.steps.map(step => {
          const facts = this.current.specification.step(step.id).value!;
          if (facts.capture) return '  const ' + this.inspection.read(facts.capture.name, 'name').decoded + ' = ' + this.expression(step.content, this.domain) + ';';
          if (step.kind === 'then' && !(step.content.kind === 'call-expression' && this.inspection.read(this.current.specification.call(step.content.id).value!).kind === 'check')) return '  ' + this.assertion(step.content, this.domain);
          return '  ' + this.expression(step.content, this.domain) + ';';
        });
        return '/* @expec-test ' + quote(id).replaceAll('/', '\\/') + ' */\ntest(' + quote(scenario.title.value) + ', async ({ ' + this.domain + ' }) => {\n' + steps.join('\n') + '\n});';
      });
      tests.push({ path, text: 'import { test } from "../dsl/' + this.domain + '-test.js";\nimport { expect } from "vitest";\nimport { expectData, comparisonEqual, finiteNumber } from "../dsl/comparison.js";\n' + this.importText(path) + '\n' + bodies.join('\n\n') + '\n' });
    }
    for (const operation of this.operations) for (const layer of operation.body.kind === 'absent' && operation.kind !== 'check' ? ['dsl', 'driver'] : ['dsl']) {
      if (layer === 'driver' && this.driver) {
        const mapped = this.current.baseline.artifacts.filter(item => item.specId === this.current.id(operation.id) && item.locator.outputId === 'acceptance'
          && item.locator.format === 'typescript-symbol-1' && (item.locator.value as { file: string }).file === this.driver!.file);
        this.artifacts.push(...mapped.length ? mapped.map(item => ({ ...item, locator: { ...item.locator, value: {
          file: this.driver!.file, declaration: [{ kind: 'class', name: this.driver!.name }, { kind: 'method', name: this.name(operation), static: false }],
        } } })) : [{ specId: this.current.id(operation.id), locator: { outputId: 'acceptance', format: 'typescript-symbol-1', value: {
          file: this.driver.file, declaration: [{ kind: 'class', name: this.driver.name }, { kind: 'method', name: this.name(operation), static: false }],
        } } }]);
        continue;
      }
      this.artifacts.push({ specId: this.current.id(operation.id), locator: { outputId: 'acceptance', format: 'typescript-symbol-1', value: {
        file: this.root + '/' + layer + '/' + this.domain + '.ts', declaration: [
          { kind: 'class', name: className + (layer === 'driver' ? 'Driver' : '') }, { kind: 'method', name: this.name(operation), static: false },
        ],
      } } });
    }
    const driverName = this.driver?.name ?? className + 'Driver';
    const driverImport = posix.relative(this.root + '/dsl', this.driver?.file ?? this.root + '/driver/' + this.domain + '.ts').replace(/\.ts$/, '.js');
    this.imports.clear();
    const driverMethods = this.operations.filter(operation => operation.body.kind === 'absent' && operation.kind !== 'check').map(operation => this.method(operation, true)).join('\n');
    const driverImports = this.importText(this.root + '/driver/' + this.domain + '.ts');
    this.imports.clear();
    const fixtures: string[] = [], visited = new Set<NodeId>();
    const fixture = (item: Item<'fixture'>): void => {
      if (visited.has(item.id)) return; visited.add(item.id);
      const dependencies = (node: Item): void => {
        if (node.kind === 'reference' && node.resolution.status === 'bound') {
          const target = this.inspection.read(node.resolution.target); if (target.kind === 'fixture') fixture(target);
        }
        for (const child of this.inspection.children(node.id)) dependencies(child);
      };
      dependencies(item.value);
      fixtures.push('  readonly ' + item.name + ': ' + this.type(item.declaredType.id) + ' = ' + this.expression(item.value, 'this') + ';');
      this.artifacts.push({ specId: this.current.id(item.id), locator: { outputId: 'acceptance', format: 'typescript-symbol-1', value: {
        file: this.root + '/dsl/' + this.domain + '.ts', declaration: [{ kind: 'class', name: className }, { kind: 'property', name: item.name, static: false }],
      } } });
    };
    for (const item of this.inspection.query('fixture')) fixture(item);
    const methods = this.operations.map(operation => this.method(operation, false)).join('\n');
    return [
      { path: this.root + '/dsl/comparison.ts', text: 'import { expect } from "vitest";\n' + acceptanceRuntime + '\nexport function expectData(actual: unknown, expected: unknown): void {\n  expect(comparisonData(actual, "actual")).toStrictEqual(comparisonData(expected, "expected"));\n}\n' },
      { path: this.driver?.file ?? this.root + '/driver/' + this.domain + '.ts', text: driverImports + 'export class ' + driverName + ' {\n' + driverMethods + '\n}\n' },
      { path: this.root + '/dsl/' + this.domain + '.ts', text: 'import { expect } from "vitest";\nimport { expectData, comparisonEqual, finiteNumber } from "./comparison.js";\nimport { ' + driverName + ' } from ' + quote(driverImport.startsWith('.') ? driverImport : './' + driverImport) + ';\n'
        + this.importText(this.root + '/dsl/' + this.domain + '.ts')
        + 'export class ' + className + ' {\n  constructor(private readonly driver: ' + driverName + ') {}\n' + fixtures.join('\n') + '\n' + methods + '\n}\n' },
      { path: this.root + '/dsl/' + this.domain + '-test.ts', text: 'import { test as baseTest } from "vitest";\nimport { ' + className + ' } from "./' + this.domain + '.js";\nimport { ' + driverName + ' } from ' + quote(driverImport.startsWith('.') ? driverImport : './' + driverImport) + ';\nexport const test = baseTest.extend(' + quote(this.domain) + ', () => new ' + className + '(new ' + driverName + '()));\n' },
      ...tests,
    ];
  }
  private importText(file: string): string {
    return [...this.imports].map(([name, target]) => {
      const path = posix.relative(posix.dirname(file), target.file).replace(/\.ts$/, '.js');
      return 'import { ' + target.name + (name === target.name ? '' : ' as ' + name) + ' } from ' + quote(path.startsWith('.') ? path : './' + path) + ';\n';
    }).join('');
  }
}
