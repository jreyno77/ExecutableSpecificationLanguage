import type { Diagnostic } from './checking.js';
import type { Item } from './inspection-item.js';
import type { NodeId } from './model.js';
import type { OutputContext } from './output.js';
import type { IdentifiedSpecification, ArtifactAssociation } from './specification-identity.js';
import type { TypeId } from './types.js';
import type { KotlinFile } from './kotlin-declarations.js';
import type { KotlinQuery } from './kotlin-query.js';
import { kotlinName } from './kotlin-fixture.js';
import { decimal } from './decimal.js';
import { ExpressionChecker } from './expression-checker.js';
import { KotlinData } from './kotlin-data.js';
import { fromFact } from './checking.js';

export interface KotlinTestOptions { testRoot: string; package: string; domain: string }
type Operation = Item<'setup' | 'action' | 'observation' | 'check'>;
const quote = (text: string) => JSON.stringify(text).replaceAll('$', '\\$');
const identifier = (name: string) => /^[A-Za-z_][A-Za-z_0-9]*$/.test(name) && !new Set('as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while'.split(' ')).has(name);

/** Lowers checked examples into readable Kotlin calls; native targets come from K2. */
export class KotlinExamples {
  readonly problems: Diagnostic[] = [];
  readonly obligations: Diagnostic[] = [];
  private readonly inspection;
  private readonly types;
  private readonly expressions;
  private readonly data;
  private readonly operations: Operation[];
  private readonly modules: Set<string>;
  private readonly className: string;
  private readonly locals = new Map<string, TypeId>();
  constructor(private readonly current: IdentifiedSpecification, private readonly options: KotlinTestOptions,
    private readonly targets: ReadonlyMap<NodeId, KotlinQuery['declarations'][number]>, context?: OutputContext, private readonly fixture?: KotlinQuery['declarations'][number], private readonly nativeDriver?: KotlinQuery['declarations'][number]) {
    this.inspection = current.specification.inspection; this.types = current.specification.types;
    this.expressions = new ExpressionChecker(this.types); this.data = new KotlinData(this.types, targets);
    this.modules = new Set([current.specification.entry, ...context?.workspaceModules ?? []]);
    this.operations = [...this.inspection.query('setup'), ...this.inspection.query('action'), ...this.inspection.query('observation'), ...this.inspection.query('check')].filter(item => this.owned(item));
    this.className = options.domain[0]!.toUpperCase() + options.domain.slice(1);
  }
  private owned(item: Item): boolean { return item.origin.kind === 'source' && this.modules.has(item.origin.module); }
  private problem(code: string, item: Item, message: string): string { this.problems.push({ code, at: item.origin, message, related: [] }); return 'error(' + quote(message) + ')'; }
  private name(item: Item): string {
    const name = 'name' in item ? item.name : item.kind;
    return identifier(name) ? name : this.problem('invalid-native-name', item, 'An explicit valid Kotlin name is required: ' + name);
  }
  private type(id: TypeId, item: Item): string { return this.data.type(id, item); }
  private valueType(item: Item): TypeId | undefined {
    const result = this.expressions.typeOf(item.id, reference => {
      const binding = reference.resolution;
      if (binding.status === 'bound') {
        const target = this.inspection.read(binding.target);
        if (target.kind === 'parameter' || target.kind === 'fixture') return fromFact(this.types.typeOf(target.declaredType.id));
      }
      if (binding.status === 'deferred' && binding.requirement.reason === 'ordered-scope' && reference.segments.length === 1) {
        const value = this.locals.get(reference.segments[0]!); return value ? { value, problems: [], deferred: [] } : undefined;
      }
      return undefined;
    });
    if (!result.value) this.problem('native-value-unavailable', item, 'The existing expression contract must supply this value type.');
    return result.value;
  }
  private parameter(item: Item<'parameter'>): string {
    const fact = this.types.typeOf(item.declaredType.id);
    return this.name(item) + ': ' + (fact.status === 'known' ? this.type(fact.value, item) : this.problem('invalid-native-type', item, 'A checked parameter type is required.'));
  }
  private result(operation: Operation): string {
    if (operation.kind === 'check' || !operation.returnType && (operation.kind === 'setup' || operation.kind === 'action')) return 'Unit';
    const fact = this.types.callable(operation.id).result;
    if (fact.status !== 'known') return this.problem('invalid-native-type', operation, 'A checked callable result is required.');
    return fact.value.kind === 'none' ? 'Unit' : fact.value.kind === 'value' ? this.type(fact.value.type, operation) : this.problem('unspecified-native-result', operation, 'Specify the executable operation result.');
  }
  private expression(item: Item, receiver: string, expected?: TypeId): string {
    switch (item.kind) {
      case 'number-literal': {
        const number = Number(item.token);
        return Number.isFinite(number) && decimal(item.token) === decimal(String(number)) ? String(number) + (Number.isInteger(number) && !String(number).includes('e') ? '.0' : '')
          : this.problem('unsupported-number-literal', item, 'This literal cannot round-trip through finite binary64.');
      }
      case 'string-literal': return quote(item.value);
      case 'boolean-literal': return String(item.value);
      case 'grouped-expression': return '(' + this.expression(item.inner, receiver, expected) + ')';
      case 'list-expression': {
        const id = expected ?? this.valueType(item), shape = id && this.data.shape(id);
        if (shape?.kind !== 'builtin' || this.inspection.read(shape.declaration, 'builtin-type').name !== 'List') return this.problem('unsupported-native-data', item, 'A list needs its checked element type.');
        return 'mutableListOf<' + this.type(shape.arguments[0]!, item) + '>(' + item.elements.map(element => this.expression(element, receiver, shape.arguments[0]!)).join(', ') + ')';
      }
      case 'record-expression': {
        const id = expected ?? this.valueType(item);
        if (!id) return this.problem('unsupported-native-data', item, 'A record needs its checked expected type.');
        const fields = this.data.fields(id, item);
        return this.type(id, item) + '(' + item.entries.map(entry => {
          const field = fields.find(field => this.inspection.read(field.declaration, 'field').name === entry.name);
          return field?.type.status === 'known' ? this.data.field(field.declaration) + ' = ' + this.expression(entry.value, receiver, field.type.value)
            : this.problem('unsupported-native-data', entry, 'A checked record field is required.');
        }).join(', ') + ')';
      }
      case 'name-expression': {
        const binding = item.reference.resolution;
        if (binding.status === 'bound') {
          const declaration = this.inspection.read(binding.target);
          if (declaration.kind === 'parameter') return this.name(declaration);
          if (declaration.kind === 'fixture') return receiver + '.' + this.name(declaration);
        }
        if (binding.status === 'deferred' && binding.requirement.reason === 'ordered-scope' && item.reference.segments.length === 1 && this.locals.has(item.reference.segments[0]!)) return item.reference.segments[0]!;
        return this.problem('unsupported-native-value', item, 'This value requires an explicit executable binding.');
      }
      case 'unary-expression': return item.operator === 'not' ? '(!' + this.expression(item.operand, receiver) + ')'
        : '(' + item.operator + this.options.package + '.dsl.finiteNumber(' + this.expression(item.operand, receiver) + '))';
      case 'binary-expression': {
        const prefix = this.options.package + '.dsl.', left = this.expression(item.left, receiver), right = this.expression(item.right, receiver);
        if (item.operator === 'and' || item.operator === 'or') return '(' + left + (item.operator === 'and' ? ' && ' : ' || ') + right + ')';
        if (item.operator === '==' || item.operator === '!=') {
          const type = this.valueType(item.left);
          if (!type) return this.problem('unsupported-native-data', item, 'Equality needs its checked operand type.');
          return (item.operator === '!=' ? '!' : '') + prefix + 'dataEqual(' + left + ', ' + right + ') { actual, expected -> '
            + prefix + this.data.assertion('actual', 'expected', type, item) + ' }';
        }
        const expression = '(' + prefix + 'finiteNumber(' + left + ') ' + item.operator + ' ' + prefix + 'finiteNumber(' + right + '))';
        return ['<', '<=', '>', '>='].includes(item.operator) ? expression : prefix + 'finiteNumber(' + expression + ')';
      }
      case 'member-expression': {
        const type = this.valueType(item.receiver);
        const field = type && this.data.fields(type, item).find(field => this.inspection.read(field.declaration, 'field').name === item.member.segments[0]);
        return field ? '(' + this.expression(item.receiver, receiver, type) + ').' + this.data.field(field.declaration)
          : this.problem('missing-native-mapping', item, 'The checked data member needs its actual native property association.');
      }
      case 'call-expression': {
        const selected = this.current.specification.call(item.id).value!;
        const operation = this.inspection.read(selected), target = this.targets.get(selected);
        const parameters = this.types.callable(selected).parameters;
        const arguments_ = item.arguments.map((argument, index) => this.expression(argument, receiver, parameters[index]?.type.status === 'known' ? parameters[index].type.value : undefined)).join(', ');
        if (this.operations.some(operation => operation.id === selected)) return receiver + '.' + this.name(operation) + '(' + arguments_ + ')';
        if (target?.kind === 'function' && target.selector.length === 1) return target.packageName + '.' + target.name + '(' + arguments_ + ')';
        return this.problem('missing-native-mapping', item, 'This checked call requires a uniquely associated executable native target.');
      }
      default: return this.problem('unsupported-native-expression', item, 'Kotlin acceptance lowering is unavailable for ' + item.kind + '.');
    }
  }
  private assertion(item: Item, receiver: string): string {
    if (item.kind === 'binary-expression' && item.operator === '==') return this.compare(item.left, item.right, receiver);
    return 'org.junit.jupiter.api.Assertions.assertTrue(' + this.expression(item, receiver) + ')';
  }
  private compare(actual: Item, expected: Item, receiver: string): string {
    const type = this.valueType(actual);
    return type ? this.options.package + '.dsl.' + this.data.assertion(this.expression(actual, receiver, type), this.expression(expected, receiver, type), type, actual)
      : this.problem('unsupported-native-data', actual, 'Comparison needs its checked data type.');
  }
  private statements(operation: Operation): string {
    if (operation.body.kind !== 'available') return '';
    this.locals.clear();
    return operation.body.content.members.map(statement => {
      switch (statement.kind) {
        case 'let': { const type = this.valueType(statement.value), value = this.expression(statement.value, 'this', type); if (type) this.locals.set(statement.name, type); return 'val ' + statement.name + ' = ' + value; }
        case 'do': return this.expression(statement.expression, 'this');
        case 'return': return 'return ' + this.expression(statement.expression, 'this');
        case 'assert': return this.assertion(statement.expression, 'this');
      }
    }).join('\n    ');
  }
  private steps(scenario: Item<'scenario'>): string {
    return scenario.steps.map(step => {
      const facts = this.current.specification.step(step.id).value!;
      this.locals.clear(); for (const value of facts.available) this.locals.set(this.inspection.read(value.name, 'name').decoded, value.type);
      if (facts.capture) return 'val ' + this.inspection.read(facts.capture.name, 'name').decoded + ' = ' + this.expression(step.content, this.options.domain);
      if (step.kind === 'then' && step.content.kind === 'prose-expectation') {
        this.obligations.push({ code: 'verification-required', at: step.content.origin, message: step.content.text.value, related: [] });
        return 'error(' + quote('Verification required: ' + step.content.text.value) + ')';
      }
      if (step.kind === 'then' && !(step.content.kind === 'call-expression' && this.inspection.read(this.current.specification.call(step.content.id).value!).kind === 'check')) return this.assertion(step.content, this.options.domain);
      return this.expression(step.content, this.options.domain);
    }).join('\n    ');
  }
  files(): KotlinFile[] {
    const files: KotlinFile[] = [], prefix = this.options.testRoot + '/' + this.options.package.replaceAll('.', '/');
    const groups = [...this.inspection.query('examples')].filter(item => this.owned(item));
    const methodNames = new Set<string>();
    const add = (id: string, layer: string, name: string, body: string, artifacts: ArtifactAssociation[]) => files.push({ id, path: prefix + '/' + layer + '/' + name + '.kt', text: 'package ' + this.options.package + '.' + layer + '\n\n' + body + '\n', artifacts });
    const artifact = (id: NodeId, layer: string, className: string, method?: string, parameters?: string[]): ArtifactAssociation => ({ specId: this.current.id(id), locator: {
      outputId: 'kotlin-acceptance', format: 'kotlin-symbol-1', value: { file: prefix + '/' + layer + '/' + className + '.kt', declaration: [
        { kind: 'class', name: className }, ...method ? [{ kind: 'function', name: method, parameters: parameters ?? [] }] : [],
      ] },
    } });
    for (const group of groups) {
      if (groups.length > 1) { this.problem('ambiguous-group-name', group, 'Distinct example groups require distinct native names.'); continue; }
      const name = this.className + 'Acceptance', artifacts = [artifact(group.id, 'acceptance', name)];
      const bodies = group.members.filter(member => member.kind === 'example' || member.kind === 'scenario').map(example => {
        const method = example.title.value.replace(/[^A-Za-z0-9]+(.)/g, (_, next: string) => next.toUpperCase()).replace(/^[A-Z]/, letter => letter.toLowerCase());
        if (!identifier(method) || methodNames.has(method)) this.problem('native-name-conflict', example, 'Give examples distinct native method names.'); methodNames.add(method);
        artifacts.push(artifact(example.id, 'acceptance', name, method));
        let body: string;
        if (example.kind === 'scenario') body = this.steps(example);
        else if (example.expected.kind === 'prose-expectation') {
          this.obligations.push({ code: 'verification-required', at: example.expected.origin, message: example.expected.text.value, related: [] });
          body = this.expression(example.actual, this.options.domain) + '\n    error(' + quote('Verification required: ' + example.expected.text.value) + ')';
        } else body = this.compare(example.actual, example.expected, this.options.domain);
        return '  @org.junit.jupiter.api.Test\n  @org.junit.jupiter.api.DisplayName(' + quote(example.title.value) + ')\n  fun ' + method + '() {\n    ' + body + '\n  }';
      });
      add(this.current.id(group.id), 'acceptance', name, '@org.junit.jupiter.api.TestInstance(org.junit.jupiter.api.TestInstance.Lifecycle.PER_METHOD)\nclass ' + name + ' : ' + (this.fixture ? this.fixture.packageName + '.' + this.fixture.selector.map(item => item.name).join('.') : this.options.package + '.dsl.' + this.className + 'Fixture') + '() {\n' + bodies.join('\n\n') + '\n}', artifacts);
    }
    if (!groups.length) return files;
    const group = groups[0]!, driver: string[] = [], methods: string[] = [], driverArtifacts: ArtifactAssociation[] = [], dslArtifacts: ArtifactAssociation[] = [];
    for (const operation of this.operations) {
      const name = this.name(operation), parameters = operation.parameters.map(item => this.parameter(item)).join(', '), result = this.result(operation);
      const canonical = operation.parameters.map(item => { const fact = this.types.typeOf(item.declaredType.id); return fact.status === 'known' ? this.type(fact.value, item).replace(/^(String|Double|Boolean|Unit)$/, 'kotlin.$1') : ''; });
      dslArtifacts.push(artifact(operation.id, 'dsl', this.className, name, canonical));
      if (operation.body.kind === 'available') {
        methods.push('  fun ' + name + '(' + parameters + '): ' + result + ' {\n    ' + this.statements(operation) + '\n  }');
        continue;
      }
      const target = this.nativeDriver && this.targets.get(operation.id);
      if (target) driver.push('  open fun ' + name + '(' + parameters + '): ' + result + ' = delegate.' + target.name + '(' + operation.parameters.map(item => this.name(item)).join(', ') + ')');
      else {
        this.obligations.push({ code: 'implementation-required', at: operation.origin, message: 'Implement ' + this.options.domain + '.' + name + '.', related: [] });
        driver.push('  open fun ' + name + '(' + parameters + '): ' + result + ' = throw NotImplementedError(' + quote('Not implemented: ' + name) + ')');
      }
      methods.push('  fun ' + name + '(' + parameters + '): ' + result + ' = driver.' + name + '(' + operation.parameters.map(item => this.name(item)).join(', ') + ')');
      driverArtifacts.push(artifact(operation.id, 'driver', this.className + 'Driver', name, canonical));
    }
    const fixtures: string[] = [], visited = new Set<NodeId>(), names = new Set(this.operations.map(item => this.name(item)));
    const fixture = (item: Item<'fixture'>): void => {
      if (visited.has(item.id)) return; visited.add(item.id);
      const name = this.name(item);
      if (names.has(name)) this.problem('native-name-conflict', item, 'Distinct data and operations require distinct native names: ' + name); names.add(name);
      const dependencies = (node: Item): void => {
        if (node.kind === 'reference' && node.resolution.status === 'bound') {
          const target = this.inspection.read(node.resolution.target); if (target.kind === 'fixture') fixture(target);
        }
        for (const child of this.inspection.children(node.id)) dependencies(child);
      };
      dependencies(item.value);
      const type = this.types.typeOf(item.declaredType.id);
      if (type.status !== 'known') { this.problem('invalid-native-type', item, 'A fixture needs its checked declared type.'); return; }
      fixtures.push('  val ' + name + ': ' + this.type(type.value, item) + ' = ' + this.expression(item.value, 'this', type.value));
      dslArtifacts.push({ specId: this.current.id(item.id), locator: { outputId: 'kotlin-acceptance', format: 'kotlin-symbol-1', value: {
        file: prefix + '/dsl/' + this.className + '.kt', declaration: [{ kind: 'class', name: this.className }, { kind: 'property', name }],
      } } });
    };
    this.locals.clear();
    for (const item of this.inspection.query('fixture')) if (this.owned(item)) fixture(item);
    add(this.current.id(group.id) + ':driver', 'driver', this.className + 'Driver', 'open class ' + this.className + 'Driver' + (this.nativeDriver ? '(private val delegate: ' + kotlinName(this.nativeDriver) + (this.nativeDriver.zeroArgumentConstruction ? ' = ' + kotlinName(this.nativeDriver) + '()' : '') + ')' : '') + ' {\n' + driver.join('\n') + '\n}', driverArtifacts);
    add(this.current.id(group.id) + ':dsl', 'dsl', this.className, 'class ' + this.className + '(private val driver: ' + this.options.package + '.driver.' + this.className + 'Driver) {\n' + [...fixtures, ...methods].join('\n') + '\n}', dslArtifacts);
    add(this.current.id(group.id) + ':fixture', 'dsl', this.className + 'Fixture', '/** JUnit creates a fresh domain and driver per test. No resource lifecycle is implied. */\nopen class ' + this.className + 'Fixture' + (this.nativeDriver && !this.nativeDriver.zeroArgumentConstruction ? '(driver: ' + this.options.package + '.driver.' + this.className + 'Driver)' : '') + ' {\n  protected val ' + this.options.domain + ' = ' + this.className + '(' + (this.nativeDriver && !this.nativeDriver.zeroArgumentConstruction ? 'driver' : this.options.package + '.driver.' + this.className + 'Driver()') + ')\n}', []);
    add(this.current.id(group.id) + ':comparison', 'dsl', 'ExpecChecks', this.data.source(), []);
    this.problems.push(...this.data.problems);
    return files.map(file => ({ ...file, artifacts: [...file.artifacts, { specId: this.current.id(group.id), locator: { outputId: 'kotlin-acceptance', format: 'kotlin-file-1', value: { file: file.path } } }] }));
  }
}
