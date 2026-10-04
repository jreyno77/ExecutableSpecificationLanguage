import { TypeCompatibility } from './type-compatibility.js';
import type { Diagnostic } from './checking.js';
import type { Item } from './inspection-item.js';
import type { NodeId } from './model.js';
import type { TypeCatalog } from './type-catalog.js';
import type { TypeId } from './types.js';
import type { KotlinQuery } from './kotlin-query.js';

/** Native type spellings and type-directed data checks use the same supplied catalog. */
export class KotlinData {
  readonly problems: Diagnostic[] = [];
  private readonly comparisons = new Map<TypeId, { name: string; body: string }>();
  readonly generatedTuples = new Set<number>();
  constructor(private readonly types: TypeCatalog, private readonly targets: ReadonlyMap<NodeId, KotlinQuery['declarations'][number]>,
    private readonly tuples: ReadonlyMap<number, string | undefined>, private readonly tuplePackage: string, private readonly generated: ReadonlySet<string>) {}
  private tuple(arity: number, item: Item): string {
    if (this.tuples.has(arity)) return this.tuples.get(arity) ?? this.problem(item, 'Tuple data requires its unchanged generated carrier.');
    this.generatedTuples.add(arity); return this.tuplePackage + '.Tuple' + arity;
  }
  private problem(item: Item, message: string): string { this.problems.push({ code: 'unsupported-native-data', at: item.origin, message, related: [] }); return '__unsupported'; }
  shape(id: TypeId) {
    let shape = this.types.describe(id);
    while (shape.kind === 'alias' && shape.target.status === 'known') shape = this.types.describe(shape.target.value);
    return shape;
  }
  type(id: TypeId, item: Item): string {
    const type = this.types.describe(id);
    if (type.kind === 'builtin') {
      const name = this.types.inspection.read(type.declaration, 'builtin-type').name;
      return name === 'List' ? 'MutableList<' + this.type(type.arguments[0]!, item) + '>' : ({ Text: 'String', Number: 'Double', Boolean: 'Boolean', Nothing: 'Unit' } as Record<string, string>)[name]!;
    }
    if (type.kind === 'optional') return this.type(type.inner, item) + '?';
    if (type.kind === 'tuple') return this.tuple(type.elements.length, item) + '<' + type.elements.map(element => this.type(element, item)).join(', ') + '>';
    if (type.kind === 'declared' || type.kind === 'alias') {
      const target = this.targets.get(type.declaration);
      if (target) return target.packageName + '.' + target.selector.map(item => item.name).join('.') + (type.arguments.length ? '<' + type.arguments.map(id => this.type(id, item)).join(', ') + '>' : '');
    }
    return this.problem(item, 'This checked type needs an exact executable Kotlin representation.');
  }
  private restriction(id: TypeId) {
    const type = this.types.describe(id);
    if (type.kind !== 'alias' || type.target.status !== 'known') return;
    const shape = this.types.describe(type.target.value);
    if (shape.kind !== 'literal' && shape.kind !== 'union') return;
    const target = this.targets.get(type.declaration);
    return { type, shape, inner: type.target.value, target,
      name: target && target.packageName + '.' + target.selector.map(item => item.name).join('.') };
  }
  private textCases(id: TypeId): string[] | undefined {
    const shape = this.types.describe(id);
    if (shape.kind !== 'union') return;
    const values = shape.alternatives.map(type => this.types.describe(type)).map(type => type.kind === 'literal'
      ? this.types.inspection.read(type.expression, 'literal-type').value : undefined);
    return values.every(value => value?.kind === 'string-literal') ? values.map(value => (value as Item<'string-literal'>).value) : undefined;
  }
  private variant(id: TypeId, item: Item): string {
    const type = this.types.describe(id);
    if ('declaration' in type) {
      const declaration = this.types.inspection.read(type.declaration);
      return this.targets.get(type.declaration)?.name ?? ('name' in declaration ? declaration.name : this.problem(item, 'A union alternative needs a native name.'));
    }
    if (type.kind === 'tuple') return 'Tuple' + type.elements.length;
    if (type.kind === 'literal') {
      const literal = this.types.inspection.read(type.expression, 'literal-type').value;
      return literal.kind === 'string-literal' ? 'Text' : literal.kind === 'number-literal' ? 'Number' : 'Boolean';
    }
    return this.problem(item, 'A union alternative needs a checked native representation.');
  }
  wrap(id: TypeId, item: Item, value: string, actual?: TypeId): string | undefined {
    const declared = this.types.describe(id), restriction = this.restriction(id);
    if (!restriction) return declared.kind === 'alias' && declared.target.status === 'known' ? this.wrap(declared.target.value, item, value, actual) : undefined;
    const { type, shape, inner, target, name } = restriction;
    if (!target || !name || !this.generated.has(target.file)) {
      this.dataProblem('unsupported-fixture-data', item, 'Expected restriction data requires its unchanged generated native definition.', target); return '__unsupported';
    }
    const arguments_ = type.arguments.length ? '<' + type.arguments.map(id => this.type(id, item)).join(', ') + '>' : '';
    const text = this.textCases(inner);
    if (text && !type.arguments.length) {
      return item.kind === 'string-literal' && text.includes(item.value)
        ? name + '.' + item.value.slice(0, 1).toUpperCase() + item.value.slice(1)
        : this.problem(item, 'A finite enum needs its checked literal value.');
    }
    if (shape.kind === 'literal' || text) return name + arguments_ + '(' + value + ')';
    const compatibility = new TypeCompatibility(this.types);
    const matches = shape.alternatives.filter(type => (compatibility.literal(item, type)
      ?? (actual ? compatibility.assignable(actual, type) : undefined))?.value === true);
    return matches.length === 1 ? name + '.' + this.variant(matches[0]!, item) + arguments_ + '(' + value + ')'
      : this.problem(item, 'The checked value must select exactly one native union alternative.');
  }
  private primitive(native: string): string {
    const guard = 'require(actual is ' + native + ' && expected is ' + native + ') { path + ": expected ' + native + ' data" }\n  ';
    return guard + (native === 'Double'
      ? 'require(actual.isFinite() && expected.isFinite()) { path + ": expected finite Number data" }\n  org.junit.jupiter.api.Assertions.assertEquals(if (expected == 0.0) 0.0 else expected, if (actual == 0.0) 0.0 else actual, path)'
      : 'org.junit.jupiter.api.Assertions.assertEquals(expected, actual, path)');
  }
  field(id: NodeId): string {
    const item = this.types.inspection.read(id), target = this.targets.get(id);
    if (target?.kind === 'property' && !target.storedProperty) this.dataProblem('unsupported-comparison-data', item,
      'Data observation requires an ordinary stored property with implicit accessors.', target);
    return target?.kind === 'property' ? target.name : this.problem(item, 'The declared data field needs an actual native property association.');
  }
  construct(id: TypeId, item: Item): void {
    const shape = this.shape(id), target = shape.kind === 'declared' ? this.targets.get(shape.declaration) : undefined;
    if (!target?.dataConstruction) this.dataProblem('unsupported-fixture-data', item,
      'Authored fixture and expected records require ordinary primary construction without application initialization.', target);
  }
  private dataProblem(code: string, item: Item, message: string, target?: KotlinQuery['declarations'][number]): void {
    this.problems.push({ code, message, at: item.origin, related: target ? [{ kind: 'dependency', path: ['project', target.file, target.nameRange.start, target.nameRange.end - target.nameRange.start] }] : [] });
  }
  fields(id: TypeId, item: Item) {
    const fact = this.types.fields(id);
    if (fact.status === 'known' && fact.value.kind === 'available') return fact.value.fields;
    this.problem(item, 'Opaque runtime values need an explicit comparison contract.'); return [];
  }
  assertion(actual: string, expected: string, id: TypeId, item: Item): string { return this.comparison(id, item) + '(' + actual + ', ' + expected + ')'; }
  private comparison(id: TypeId, item: Item): string {
    const previous = this.comparisons.get(id); if (previous) return previous.name;
    const entry = { name: 'expectData' + this.comparisons.size, body: '' }; this.comparisons.set(id, entry);
    const type = this.types.describe(id), nested = (type: TypeId, actual: string, expected: string, path = 'path') => this.comparison(type, item) + '(' + actual + ', ' + expected + ', ' + path + ', seenActual, seenExpected)';
    let body: string;
    const restriction = this.restriction(id);
    if (restriction) {
      const { type, shape, inner, target, name } = restriction;
      if (!target || !name || !this.generated.has(target.file)) {
        this.dataProblem('unsupported-comparison-data', item, 'Restricted data observation requires its unchanged generated native definition.', target); body = '__unsupported';
      } else {
        const arguments_ = type.arguments.length ? '<' + type.arguments.map(() => '*').join(', ') + '>' : '';
        const text = this.textCases(inner);
        if (shape.kind === 'literal' || text) {
          const property = text && !type.arguments.length ? 'text' : 'value';
          const comparison = text ? (() => {
            const declaration = [...this.types.inspection.query('builtin-type')].find(item => item.name === 'Text')!;
            return this.types.declaredType(declaration.id);
          })() : inner;
          body = 'require(actual is ' + name + arguments_ + ' && expected is ' + name + arguments_ + ') { path + ": expected declared restriction data" }\n  '
            + nested(comparison, 'actual.' + property, 'expected.' + property);
        } else body = 'when {\n    ' + shape.alternatives.map(alternative => {
          const variant = name + '.' + this.variant(alternative, item) + arguments_;
          return 'actual is ' + variant + ' && expected is ' + variant + ' -> ' + nested(alternative, 'actual.value', 'expected.value');
        }).join('\n    ') + '\n    else -> org.junit.jupiter.api.Assertions.fail<Unit>(path + ": declared union alternative")\n  }';
      }
    } else if (type.kind === 'alias' && type.target.status === 'known') body = nested(type.target.value, 'actual', 'expected');
    else if (type.kind === 'literal') {
      const value = this.types.inspection.read(type.expression, 'literal-type').value;
      body = this.primitive(value.kind === 'string-literal' ? 'String' : value.kind === 'number-literal' ? 'Double' : 'Boolean');
    }
    else if (type.kind === 'optional') body = 'if (actual == null || expected == null) org.junit.jupiter.api.Assertions.assertTrue(actual == null && expected == null, path + ": optional presence")\n  else ' + nested(type.inner, 'actual', 'expected');
    else if (type.kind === 'builtin' && this.types.inspection.read(type.declaration, 'builtin-type').name !== 'List') {
      body = this.primitive(this.type(id, item));
    } else if (type.kind === 'builtin') {
      body = 'require(actual is List<*> && expected is List<*> && ordinaryList(actual) && ordinaryList(expected)) { path + ": expected ordinary List data" }\n  ' + this.guarded('org.junit.jupiter.api.Assertions.assertEquals(expected.size, actual.size, path + ".size")\n    for (index in expected.indices) ' + nested(type.arguments[0]!, 'actual[index]', 'expected[index]', 'path + "[" + index + "]"'));
    } else if (type.kind === 'tuple') {
      const name = this.tuple(type.elements.length, item), cast = name + '<' + type.elements.map(() => '*').join(', ') + '>';
      body = 'require(actual is ' + cast + ' && expected is ' + cast + ' && actual.javaClass == ' + name + '::class.java && expected.javaClass == ' + name + '::class.java) { path + ": expected declared tuple data" }\n  ' + this.guarded(type.elements.map((element, index) =>
        nested(element, 'actual.item' + (index + 1), 'expected.item' + (index + 1), 'path + "[' + index + ']"')).join('\n    '));
    } else if (type.kind === 'declared' && this.types.inspection.read(type.declaration).kind === 'record-type-declaration') {
      const target = this.targets.get(type.declaration), name = target && target.packageName + '.' + target.selector.map(item => item.name).join('.');
      if (!name) body = this.problem(item, 'Record comparison needs its actual native class.');
      else {
        const cast = name + (type.arguments.length ? '<' + type.arguments.map(() => '*').join(', ') + '>' : '');
        body = 'require(actual is ' + cast + ' && expected is ' + cast + ' && actual.javaClass == ' + name + '::class.java && expected.javaClass == ' + name + '::class.java) { path + ": expected declared record data" }\n  ' + this.guarded(this.fields(id, item).map(field => {
          const declaration = this.types.inspection.read(field.declaration, 'field');
          return field.type.status === 'known' ? nested(field.type.value, 'actual.' + this.field(field.declaration), 'expected.' + this.field(field.declaration), 'path + ' + JSON.stringify('.' + declaration.name).replaceAll('$', '\\$')) : this.problem(item, 'A checked field type is required.');
        }).join('\n    '));
      }
    } else body = this.problem(item, 'This checked data shape has no native comparison yet.');
    entry.body = 'internal fun ' + entry.name + '(actual: Any?, expected: Any?, path: String = "value", seenActual: java.util.IdentityHashMap<Any, Boolean> = java.util.IdentityHashMap(), seenExpected: java.util.IdentityHashMap<Any, Boolean> = java.util.IdentityHashMap()) {\n  ' + body + '\n}';
    return entry.name;
  }
  private guarded(body: string): string { return 'require(seenActual.put(actual, true) == null && seenExpected.put(expected, true) == null) { path + ": cyclic data" }\n  try {\n    ' + body + '\n  } finally { seenActual.remove(actual); seenExpected.remove(expected) }'; }
  source(): string {
    return '/** Compare declared components, never application equals/toString. */\n' + [...this.comparisons.values()].map(item => item.body).join('\n\n')
      + '\n\ninternal fun finiteNumber(value: Double): Double { require(value.isFinite()) { "Expected finite Number data" }; return value }\n'
      + '\n\ninternal fun dataEqual(actual: Any?, expected: Any?, compare: (Any?, Any?) -> Unit): Boolean {\n  return try { compare(actual, expected); true } catch (_: org.opentest4j.AssertionFailedError) { false }\n}\n'
      + '\n\nprivate fun ordinaryList(value: List<*>): Boolean = value.javaClass.name in setOf("java.util.ArrayList", "java.util.LinkedList", "java.util.Arrays\\$ArrayList", "java.util.Collections\\$EmptyList", "java.util.Collections\\$SingletonList", "kotlin.collections.EmptyList")\n';
  }
}
