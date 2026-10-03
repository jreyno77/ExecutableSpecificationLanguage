import type { Item } from './inspection-item.js';
import type { NodeId } from './model.js';
import type { TypeCatalog } from './type-catalog.js';
import type { TypeDescription, TypeId } from './type-description.js';
import { fromFact, mergeChecks, type Check } from './checking.js';
import { decimal } from './decimal.js';

type Catalog = Pick<TypeCatalog, 'describe' | 'inspection' | 'fields'>;
type Meaning = Exclude<TypeDescription, { kind: 'alias' }>;
type Pair = readonly [TypeId, TypeId];
type RecordState = { declaration: NodeId; arguments: string };
type Literal = { kind: 'Number' | 'Text' | 'Boolean'; value: string | boolean };

/** Answers type relations without changing declarations or turning unknown facts into guesses. */
export class TypeCompatibility {
  constructor(private readonly catalog: Catalog) {}

  assignable(source: TypeId, target: TypeId): Check<boolean> { return this.assign(source, target, []); }
  comparable(type: TypeId): Check<boolean> { return this.compare(type, [], []); }
  literal(expression: Item, target: TypeId): Check<boolean> | undefined {
    const meaning = this.meaning(target);
    if (!meaning.value) return mergeChecks(meaning);
    if (meaning.value.kind !== 'literal') return undefined;
    const actual = literalValue(expression), expected = this.typeLiteral(meaning.value);
    return known(actual !== undefined && actual.kind === expected.kind && actual.value === expected.value);
  }

  private meaning(type: TypeId): Check<Meaning> {
    const description = this.catalog.describe(type);
    if (description.kind !== 'alias') return known(description);
    const target = fromFact(description.target);
    return target.value === undefined ? mergeChecks(target) : this.meaning(target.value);
  }

  private assign(source: TypeId, target: TypeId, seen: readonly Pair[]): Check<boolean> {
    const from = this.meaning(source), to = this.meaning(target);
    if (!from.value || !to.value) return mergeChecks(from, to);
    const left = from.value, right = to.value;
    if (seen.some(([a, b]) => a === source && b === target)) return known(true);
    const path: readonly Pair[] = [...seen, [source, target]];
    if (left.kind === 'union') return combine(left.alternatives.map(part => this.assign(part, target, path)), 'all');
    if (right.kind === 'union') return combine(right.alternatives.map(part => this.assign(source, part, path)), 'any');
    if (right.kind === 'optional') return this.assign(left.kind === 'optional' ? left.inner : source, right.inner, path);
    if (left.kind === 'optional') return known(false);
    if (left.kind === 'literal') {
      const literal = this.typeLiteral(left);
      if (right.kind === 'literal') {
        const other = this.typeLiteral(right);
        return known(literal.kind === other.kind && literal.value === other.value);
      }
      return known(right.kind === 'builtin' && this.builtin(right) === literal.kind);
    }
    if (right.kind === 'literal') return known(false);
    if (left.kind === 'tuple' && right.kind === 'tuple') return left.elements.length !== right.elements.length ? known(false)
      : combine(left.elements.map((element, index) => this.assign(element, right.elements[index]!, path)), 'all');
    if (left.kind === 'parameter' && right.kind === 'parameter') return known(left.declaration === right.declaration);
    if ((left.kind === 'builtin' || left.kind === 'declared') && (right.kind === 'builtin' || right.kind === 'declared')) {
      if (left.declaration !== right.declaration || left.arguments.length !== right.arguments.length) return known(false);
      return combine(left.arguments.flatMap((argument, index) => [
        this.assign(argument, right.arguments[index]!, path), this.assign(right.arguments[index]!, argument, path),
      ]), 'all');
    }
    return known(false);
  }

  private compare(type: TypeId, seen: readonly TypeId[], records: readonly RecordState[]): Check<boolean> {
    const meaning = this.meaning(type);
    if (!meaning.value) return mergeChecks(meaning);
    const description = meaning.value;
    if (seen.includes(type)) return known(true);
    const path = [...seen, type];
    switch (description.kind) {
      case 'literal': return known(true);
      case 'parameter': return known(false);
      case 'optional': return this.compare(description.inner, path, records);
      case 'tuple': return combine(description.elements.map(element => this.compare(element, path, records)), 'all');
      case 'union': return combine(description.alternatives.map(part => this.compare(part, path, records)), 'all');
      case 'builtin':
        if (this.builtin(description) !== 'List') return known(['Number', 'Text', 'Boolean'].includes(this.builtin(description)));
        return description.arguments.length === 1 ? this.compare(description.arguments[0]!, path, records) : known(false);
      case 'declared': {
        if (this.catalog.inspection.read(description.declaration).kind !== 'record-type-declaration') return known(false);
        // Argument comparability has finitely many states, even for Wrap<Wrap<T>> recursion.
        // It selects the recursion state; unused generic arguments do not become record contents.
        const arguments_ = description.arguments.map(argument => String(this.compare(argument, path, records).value)).join(',');
        if (records.some(record => record.declaration === description.declaration && record.arguments === arguments_)) return known(true);
        const fields = fromFact(this.catalog.fields(type));
        if (!fields.value) return mergeChecks(fields);
        if (fields.value.kind !== 'available') return known(false);
        const next = [...records, { declaration: description.declaration, arguments: arguments_ }];
        return combine(fields.value.fields.map(field => {
          const fact = fromFact(field.type);
          return fact.value === undefined ? mergeChecks(fact) : this.compare(fact.value, path, next);
        }), 'all');
      }
    }
  }

  private builtin(type: Extract<Meaning, { kind: 'builtin' | 'declared' }>): string {
    return this.catalog.inspection.read(type.declaration, 'builtin-type').name;
  }
  private typeLiteral(type: Extract<Meaning, { kind: 'literal' }>): Literal {
    const expression = this.catalog.inspection.read(type.expression, 'literal-type');
    const value = literalValue(expression.value)!;
    return expression.negative && expression.value.kind === 'number-literal'
      ? { kind: 'Number', value: decimal('-' + expression.value.token) }
      : value;
  }
}

function known<T>(value: T): Check<T> { return { value, problems: [], deferred: [] }; }
function combine(checks: readonly Check<boolean>[], rule: 'all' | 'any'): Check<boolean> {
  const decisive = rule === 'any';
  const value = checks.some(check => check.value === decisive) ? decisive
    : checks.every(check => check.value !== undefined) ? !decisive : undefined;
  return { ...mergeChecks(...checks), ...(value === undefined ? {} : { value }) };
}

function literalValue(item: Item): Literal | undefined {
  if (item.kind === 'grouped-expression') return literalValue(item.inner);
  if (item.kind === 'string-literal') return { kind: 'Text', value: item.value };
  if (item.kind === 'boolean-literal') return { kind: 'Boolean', value: item.value };
  if (item.kind === 'number-literal') return { kind: 'Number', value: decimal(item.token) };
  if (item.kind === 'unary-expression' && (item.operator === '-' || item.operator === '+')) {
    let operand: Item = item.operand;
    while (operand.kind === 'grouped-expression') operand = operand.inner;
    if (operand.kind === 'number-literal') return { kind: 'Number', value: decimal(item.operator + operand.token) };
  }
  return undefined;
}
