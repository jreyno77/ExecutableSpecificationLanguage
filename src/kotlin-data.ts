import { TypeCompatibility } from './type-compatibility.js';
import type { Diagnostic } from './checking.js';
import type { Item } from './inspection-item.js';
import type { NodeId } from './model.js';
import type { TypeCatalog } from './type-catalog.js';
import type { TypeId } from './types.js';
import type { KotlinQuery } from './kotlin-query.js';
import type { KotlinDataCarrier } from './kotlin-output-state.js';
import { hash } from './project-files.js';
import { language } from './language-text.js';

export interface KotlinDataSite { readonly owner: NodeId; readonly path: string }

/** Native type spellings and type-directed data checks use the same supplied catalog. */
export class KotlinData {
  readonly problems: Diagnostic[] = [];
  private readonly comparisons = new Map<string, { name: string; body: string }>();
  readonly generatedTuples = new Set<number>();
  constructor(private readonly types: TypeCatalog, private readonly targets: ReadonlyMap<NodeId, KotlinQuery['declarations'][number]>,
    private readonly tuples: ReadonlyMap<number, string | undefined>, private readonly tuplePackage: string, private readonly generated: ReadonlySet<string>, private readonly spellings: ReadonlyMap<NodeId, string> = new Map(), private readonly carriers: readonly KotlinDataCarrier[] = []) {}
  site(id: TypeId, site?: KotlinDataSite): KotlinDataSite | undefined {
    const type = this.types.describe(id);
    return type.kind === 'alias' && type.target.status === 'known' ? this.site(type.target.value, { owner: type.declaration, path: '' }) : site;
  }
  child(site: KotlinDataSite | undefined, path: string): KotlinDataSite | undefined { return site && { owner: site.owner, path: site.path + path }; }
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
  type(id: TypeId, item: Item, qualified = false, site: KotlinDataSite | undefined = { owner: item.id, path: '' }): string {
    const type = this.types.describe(id);
    if (type.kind === 'parameter') return this.spellings.get(type.declaration) ?? this.problem(item, 'A generic native type needs its checked parameter spelling.');
    if (type.kind === 'builtin') {
      const name = this.types.inspection.read(type.declaration, 'builtin-type').name;
      const native = ({ Text: 'String', Number: 'Double', Boolean: 'Boolean', Nothing: 'Unit', List: 'MutableList' } as Record<string, string>)[name]!;
      const prefix = qualified || [...this.spellings.values()].includes(native) ? name === 'List' ? 'kotlin.collections.' : 'kotlin.' : '';
      return prefix + native + (name === 'List' ? '<' + this.type(type.arguments[0]!, item, qualified, this.child(site, 'Element')) + '>' : '');
    }
    if (type.kind === 'optional') return this.type(type.inner, item, qualified, site) + '?';
    if (type.kind === 'tuple') return this.tuple(type.elements.length, item) + '<' + type.elements.map((element, index) => this.type(element, item, qualified, this.child(site, 'Item' + (index + 1)))).join(', ') + '>';
    if (type.kind === 'declared' || type.kind === 'alias') {
      const target = this.targets.get(type.declaration);
      if (target) return (!qualified && this.spellings.get(type.declaration) || target.packageName + '.' + target.selector.map(item => item.name).join('.')) + (type.arguments.length ? '<' + type.arguments.map((id, index) => this.type(id, item, qualified, this.child(site, 'Argument' + (index + 1)))).join(', ') + '>' : '');
    }
    const carrier = this.restriction(id, site);
    if (carrier?.name) return carrier.name + (carrier.arguments.length ? '<' + carrier.arguments.map(id => this.type(id, item, qualified)).join(', ') + '>' : '');
    return this.problem(item, 'This checked type needs an exact executable Kotlin representation.');
  }
  private restriction(id: TypeId, site?: KotlinDataSite) {
    const type = this.types.describe(id);
    if (type.kind === 'literal' || type.kind === 'union') {
      const carrier = site && this.carriers.find(carrier => carrier.owner === site.owner && carrier.path === site.path);
      if (!carrier || this.types.describe(carrier.type).kind !== type.kind) return;
      const substitutions = new Map<NodeId, TypeId>();
      const pair = (original: TypeId, actual: TypeId): void => {
        const before = this.types.describe(original), after = this.types.describe(actual);
        if (before.kind === 'parameter') substitutions.set(before.declaration, actual);
        else if (before.kind === after.kind) {
          const children = (shape: typeof before) => 'arguments' in shape ? shape.arguments : 'elements' in shape ? shape.elements : 'alternatives' in shape ? shape.alternatives : 'inner' in shape ? [shape.inner] : [];
          children(before).forEach((part, index) => { const match = children(after)[index]; if (match) pair(part, match); });
        }
      };
      pair(carrier.type, id);
      return { shape: type, inner: id, target: carrier.target, name: carrier.target.packageName + '.' + carrier.target.selector.map(item => item.name).join('.'),
        arguments: carrier.parameters.map(parameter => substitutions.get(parameter) ?? this.types.declaredType(parameter)), member: carrier.member, trusted: carrier.trusted, enumCases: carrier.enumCases };
    }
    if (type.kind !== 'alias' || type.target.status !== 'known') return;
    const shape = this.types.describe(type.target.value);
    if (shape.kind !== 'literal' && shape.kind !== 'union') return;
    const target = this.targets.get(type.declaration);
    return { shape, inner: type.target.value, target, arguments: type.arguments, enumCases: undefined,
      member: shape.kind === 'union' && !type.arguments.length ? 'text' : 'value', trusted: !!target && this.generated.has(target.file),
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
  wrap(id: TypeId, item: Item, value: string, actual?: TypeId, site?: KotlinDataSite): string | undefined {
    const declared = this.types.describe(id), restriction = this.restriction(id, site);
    if (!restriction) return declared.kind === 'alias' && declared.target.status === 'known' ? this.wrap(declared.target.value, item, value, actual, this.site(id, site)) : undefined;
    const { shape, inner, target, name } = restriction;
    if (!target || !name || !restriction.trusted) {
      this.dataProblem('unsupported-fixture-data', item, 'Expected restriction data requires its unchanged generated native definition.', target); return '__unsupported';
    }
    const arguments_ = restriction.arguments.length ? '<' + restriction.arguments.map(id => this.type(id, item)).join(', ') + '>' : '';
    const text = restriction.enumCases ?? this.textCases(inner);
    if (text && !restriction.arguments.length) {
      if (item.kind === 'string-literal' && text.includes(item.value)) return name + '.' + item.value.slice(0, 1).toUpperCase() + item.value.slice(1);
      return 'when (' + value + ') { ' + text.map(value => JSON.stringify(value).replaceAll('$', '\\$') + ' -> ' + name + '.' + value.slice(0, 1).toUpperCase() + value.slice(1)).join('; ')
        + '; else -> error("Expected declared finite text data") }';
    }
    if (shape.kind === 'literal' || text) return name + arguments_ + '(' + value + ')';
    const compatibility = new TypeCompatibility(this.types);
    const matches = shape.alternatives.filter(type => (compatibility.literal(item, type)
      ?? (actual ? compatibility.assignable(actual, type) : undefined))?.value === true);
    return matches.length === 1 ? name + '.' + this.variant(matches[0]!, item) + arguments_ + '(' + value + ')'
      : this.problem(item, 'The checked value must select exactly one native union alternative.');
  }
  /** Converts an observed value between checked receiving representations, evaluating it once. */
  adapt(value: string, actual: TypeId, expected: TypeId, item: Item, from?: KotlinDataSite, to?: KotlinDataSite): string {
    from = this.site(actual, from); to = this.site(expected, to);
    const before = this.types.describe(actual), after = this.types.describe(expected);
    if (before.kind === 'optional') return '(' + value + ')?.let { data -> ' + this.adapt('data', before.inner, after.kind === 'optional' ? after.inner : expected, item, from, to) + ' }';
    if (after.kind === 'optional') return this.adapt(value, actual, after.inner, item, from, to);
    const source = this.restriction(actual, from), destination = this.restriction(expected, to);
    if (!source && before.kind === 'alias' && before.target.status === 'known') return this.adapt(value, before.target.value, expected, item, from, to);
    if (!destination && after.kind === 'alias' && after.target.status === 'known') return this.adapt(value, actual, after.target.value, item, from, to);
    if (source && destination && source.name === destination.name && source.arguments.length === destination.arguments.length
      && source.arguments.every((id, index) => id === destination.arguments[index])) return value;
    if (source) {
      if (!source.trusted || !source.name) { this.dataProblem('unsupported-fixture-data', item, 'Restricted data conversion requires its unchanged generated declaration.', source.target); return '__unsupported'; }
      const text = source.enumCases ?? this.textCases(source.inner);
      if (source.shape.kind === 'literal' || text) {
        const literal = source.shape.kind === 'literal' ? this.types.inspection.read(source.shape.expression, 'literal-type').value : undefined;
        const primitive = text || literal?.kind === 'string-literal' ? 'Text' : literal?.kind === 'number-literal' ? 'Number' : 'Boolean';
        const observed = '(' + value + ').' + source.member;
        if (destination) return this.wrap(expected, item, observed, actual, to) ?? observed;
        const declaration = [...this.types.inspection.query('builtin-type')].find(item => item.name === primitive)!;
        return this.adapt(observed, this.types.declaredType(declaration.id), expected, item, undefined, to);
      }
      return 'when (val data = ' + value + ') { ' + source.shape.alternatives.map(alternative => 'is ' + source.name + '.' + this.variant(alternative, item)
        + ' -> '
        + this.adapt('data.value', alternative, expected, item, from, to)).join('; ') + ' }';
    }
    if (destination) return this.wrap(expected, item, value, actual, to) ?? value;
    if (before.kind === 'builtin' && after.kind === 'builtin' && this.types.inspection.read(before.declaration, 'builtin-type').name === 'List'
      && this.types.inspection.read(after.declaration, 'builtin-type').name === 'List') {
      const converted = this.adapt('data', before.arguments[0]!, after.arguments[0]!, item, this.child(from, 'Element'), this.child(to, 'Element'));
      return converted === 'data' ? value : this.tuplePackage + '.mapData(' + value + ') { data -> ' + converted + ' }';
    }
    if (before.kind === 'tuple' && after.kind === 'tuple' && before.elements.length === after.elements.length) {
      const converted = before.elements.map((id, index) => this.adapt('data.item' + (index + 1), id, after.elements[index]!, item, this.child(from, 'Item' + (index + 1)), this.child(to, 'Item' + (index + 1))));
      if (converted.every((value, index) => value === 'data.item' + (index + 1))) return value;
      const name = this.tuple(after.elements.length, item);
      return 'kotlin.run { val data = ' + value + '; require(data.javaClass == ' + name + '::class.java); ' + name + '(' + converted.join(', ') + ') }';
    }
    return value;
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
  assertion(actual: string, expected: string, id: TypeId, item: Item, site?: KotlinDataSite): string { return this.comparison(id, item, site) + '(' + actual + ', ' + expected + ')'; }
  private comparisonKey(id: TypeId, site?: KotlinDataSite): unknown[] {
    const type = this.types.describe(id), carrier = this.restriction(id, site)?.name;
    if ('declaration' in type) {
      const declaration = this.types.inspection.read(type.declaration), path: unknown[] = [];
      for (let node: Item | undefined = declaration; node; node = this.types.inspection.parent(node.id)) if ('name' in node) path.unshift([node.kind, node.name]);
      return [type.kind, declaration.origin.kind === 'builtin' ? 'builtin' : declaration.origin.module, path,
        ...'arguments' in type ? type.arguments.map((argument, index) => this.comparisonKey(argument,
          this.child(site, type.kind === 'builtin' && declaration.kind === 'builtin-type' && declaration.name === 'List' ? 'Element' : 'Argument' + (index + 1)))) : [], carrier];
    }
    if (type.kind === 'literal') return [type.kind, language(this.types.inspection.read(type.expression)), carrier];
    if (type.kind === 'optional') return [type.kind, this.comparisonKey(type.inner, site)];
    return [type.kind, ...(type.kind === 'tuple' ? type.elements : type.alternatives).map((part, index) =>
      this.comparisonKey(part, type.kind === 'tuple' ? this.child(site, 'Item' + (index + 1)) : this.site(id, site))), carrier];
  }
  private comparison(id: TypeId, item: Item, site?: KotlinDataSite): string {
    const key = JSON.stringify(this.comparisonKey(id, site)), previous = this.comparisons.get(key); if (previous) return previous.name;
    const entry = { name: 'expectData' + hash(Buffer.from(key)), body: '' }; this.comparisons.set(key, entry);
    const type = this.types.describe(id), nested = (type: TypeId, actual: string, expected: string, path = 'path', site?: KotlinDataSite) => this.comparison(type, item, site) + '(' + actual + ', ' + expected + ', ' + path + ', seenActual, seenExpected)';
    let body: string;
    const restriction = this.restriction(id, site);
    if (restriction) {
      const { shape, inner, target, name } = restriction;
      if (!target || !name || !restriction.trusted) {
        this.dataProblem('unsupported-comparison-data', item, 'Restricted data observation requires its unchanged generated native definition.', target); body = '__unsupported';
      } else {
        const arguments_ = restriction.arguments.length ? '<' + restriction.arguments.map(() => '*').join(', ') + '>' : '';
        const text = restriction.enumCases ?? this.textCases(inner);
        if (shape.kind === 'literal' || text) {
          const property = restriction.member;
          const comparison = text ? (() => {
            const declaration = [...this.types.inspection.query('builtin-type')].find(item => item.name === 'Text')!;
            return this.types.declaredType(declaration.id);
          })() : inner;
          body = 'require(actual is ' + name + arguments_ + ' && expected is ' + name + arguments_ + ') { path + ": expected declared restriction data" }\n  '
            + nested(comparison, 'actual.' + property, 'expected.' + property);
        } else body = 'when {\n    ' + shape.alternatives.map(alternative => {
          const variant = name + '.' + this.variant(alternative, item) + arguments_;
          return 'actual is ' + variant + ' && expected is ' + variant + ' -> ' + nested(alternative, 'actual.value', 'expected.value', 'path', this.site(id, site));
        }).join('\n    ') + '\n    else -> org.junit.jupiter.api.Assertions.fail<Unit>(path + ": declared union alternative")\n  }';
      }
    } else if (type.kind === 'alias' && type.target.status === 'known') body = nested(type.target.value, 'actual', 'expected', 'path', this.site(id, site));
    else if (type.kind === 'literal') {
      const value = this.types.inspection.read(type.expression, 'literal-type').value;
      body = this.primitive(value.kind === 'string-literal' ? 'String' : value.kind === 'number-literal' ? 'Double' : 'Boolean');
    }
    else if (type.kind === 'optional') body = 'if (actual == null || expected == null) org.junit.jupiter.api.Assertions.assertTrue(actual == null && expected == null, path + ": optional presence")\n  else ' + nested(type.inner, 'actual', 'expected', 'path', site);
    else if (type.kind === 'builtin' && this.types.inspection.read(type.declaration, 'builtin-type').name !== 'List') {
      body = this.primitive(this.type(id, item));
    } else if (type.kind === 'builtin') {
      body = 'require(actual is List<*> && expected is List<*> && ordinaryList(actual) && ordinaryList(expected)) { path + ": expected ordinary List data" }\n  ' + this.guarded('org.junit.jupiter.api.Assertions.assertEquals(expected.size, actual.size, path + ".size")\n    for (index in expected.indices) ' + nested(type.arguments[0]!, 'actual[index]', 'expected[index]', 'path + "[" + index + "]"', this.child(site, 'Element')));
    } else if (type.kind === 'tuple') {
      const name = this.tuple(type.elements.length, item), cast = name + '<' + type.elements.map(() => '*').join(', ') + '>';
      body = 'require(actual is ' + cast + ' && expected is ' + cast + ' && actual.javaClass == ' + name + '::class.java && expected.javaClass == ' + name + '::class.java) { path + ": expected declared tuple data" }\n  ' + this.guarded(type.elements.map((element, index) =>
        nested(element, 'actual.item' + (index + 1), 'expected.item' + (index + 1), 'path + "[' + index + ']"', this.child(site, 'Item' + (index + 1)))).join('\n    '));
    } else if (type.kind === 'declared' && this.types.inspection.read(type.declaration).kind === 'record-type-declaration') {
      const target = this.targets.get(type.declaration), name = target && target.packageName + '.' + target.selector.map(item => item.name).join('.');
      if (!name) body = this.problem(item, 'Record comparison needs its actual native class.');
      else {
        const cast = name + (type.arguments.length ? '<' + type.arguments.map(() => '*').join(', ') + '>' : '');
        body = 'require(actual is ' + cast + ' && expected is ' + cast + ' && actual.javaClass == ' + name + '::class.java && expected.javaClass == ' + name + '::class.java) { path + ": expected declared record data" }\n  ' + this.guarded(this.fields(id, item).map(field => {
          const declaration = this.types.inspection.read(field.declaration, 'field');
          return field.type.status === 'known' ? nested(field.type.value, 'actual.' + this.field(field.declaration), 'expected.' + this.field(field.declaration), 'path + ' + JSON.stringify('.' + declaration.name).replaceAll('$', '\\$'), { owner: field.declaration, path: '' }) : this.problem(item, 'A checked field type is required.');
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
      + '\n\ninternal fun <A, B> mapData(values: MutableList<A>, convert: (A) -> B): MutableList<B> { require(ordinaryList(values)) { "Expected ordinary List data" }; return values.map(convert).toMutableList() }\n'
      + '\n\nprivate fun ordinaryList(value: List<*>): Boolean = value.javaClass.name in setOf("java.util.ArrayList", "java.util.LinkedList", "java.util.Arrays\\$ArrayList", "java.util.Collections\\$EmptyList", "java.util.Collections\\$SingletonList", "kotlin.collections.EmptyList")\n';
  }
}
