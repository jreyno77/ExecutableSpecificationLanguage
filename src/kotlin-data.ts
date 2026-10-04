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
  constructor(private readonly types: TypeCatalog, private readonly targets: ReadonlyMap<NodeId, KotlinQuery['declarations'][number]>) {}
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
    if (type.kind === 'declared' || type.kind === 'alias') {
      const target = this.targets.get(type.declaration);
      if (target) return target.packageName + '.' + target.selector.map(item => item.name).join('.') + (type.arguments.length ? '<' + type.arguments.map(id => this.type(id, item)).join(', ') + '>' : '');
    }
    return this.problem(item, 'This checked type needs an exact executable Kotlin representation.');
  }
  field(id: NodeId): string {
    const item = this.types.inspection.read(id), target = this.targets.get(id);
    return target?.kind === 'property' ? target.name : this.problem(item, 'The declared data field needs an actual native property association.');
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
    if (type.kind === 'alias' && type.target.status === 'known') body = nested(type.target.value, 'actual', 'expected');
    else if (type.kind === 'optional') body = 'if (actual == null || expected == null) org.junit.jupiter.api.Assertions.assertTrue(actual == null && expected == null, path + ": optional presence")\n  else ' + nested(type.inner, 'actual', 'expected');
    else if (type.kind === 'builtin' && this.types.inspection.read(type.declaration, 'builtin-type').name !== 'List') {
      const native = this.type(id, item);
      body = 'require(actual is ' + native + ' && expected is ' + native + ') { path + ": expected ' + native + ' data" }\n  ';
      body += native === 'Double' ? 'require(actual.isFinite() && expected.isFinite()) { path + ": expected finite Number data" }\n  org.junit.jupiter.api.Assertions.assertEquals(if (expected == 0.0) 0.0 else expected, if (actual == 0.0) 0.0 else actual, path)'
        : 'org.junit.jupiter.api.Assertions.assertEquals(expected, actual, path)';
    } else if (type.kind === 'builtin') {
      body = 'require(actual is List<*> && expected is List<*> && ordinaryList(actual) && ordinaryList(expected)) { path + ": expected ordinary List data" }\n  ' + this.guarded('org.junit.jupiter.api.Assertions.assertEquals(expected.size, actual.size, path + ".size")\n    for (index in expected.indices) ' + nested(type.arguments[0]!, 'actual[index]', 'expected[index]', 'path + "[" + index + "]"'));
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
      + '\n\nprivate fun ordinaryList(value: List<*>): Boolean = value.javaClass.name in setOf("java.util.ArrayList", "java.util.LinkedList", "java.util.Arrays\\$ArrayList", "java.util.Collections\\$EmptyList", "java.util.Collections\\$SingletonList", "kotlin.collections.EmptyList")\n';
  }
}
