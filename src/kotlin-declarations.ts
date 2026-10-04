import { z } from 'zod';
import { decimal } from './decimal.js';
import { TypeCompatibility } from './type-compatibility.js';
import type { Diagnostic } from './checking.js';
import type { Item } from './inspection-item.js';
import type { NodeId } from './model.js';
import type { OutputContext } from './output.js';
import type { ArtifactAssociation, IdentifiedSpecification, JsonValue } from './specification-identity.js';
import type { TypeFact, TypeId } from './type-description.js';
import { literal } from './project-files.js';
import { language } from './language-text.js';
import { identifier as specIdentifier } from './identity-baseline.js';
import { kotlinTuple } from './kotlin-tuples.js';
import { selectKotlinMapping } from './kotlin-mapping.js';

const reserved = new Set('as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while'.split(' '));
const identifier = (value: string) => /^[A-Za-z_][A-Za-z_0-9]*$/.test(value) && !reserved.has(value);
const nativeName = z.string().refine(identifier), nativeType = z.string().refine(value => value.includes('.') && value.split('.').every(identifier));
const path = { declaration: z.array(z.string().min(1)).min(1), module: z.string().min(1).optional() };
const nameRule = z.union([z.strictObject({ ...path, name: nativeName }), z.strictObject({ id: specIdentifier, name: nativeName })]);
const importRule = z.union([z.strictObject({ ...path, name: nativeType, as: nativeName.optional() }), z.strictObject({ id: specIdentifier, name: nativeType, as: nativeName.optional() })]);
export const kotlinOptions = z.strictObject({
  directory: z.string().refine(value => literal(value) && !value.includes('\\')).default('src/main/kotlin'),
  package: z.string().refine(value => value.split('.').every(identifier)),
  concepts: z.enum(['class', 'interface']).default('class'),
  adoptExisting: z.boolean().default(false),
  names: z.array(nameRule).default([]),
  imports: z.array(importRule).default([]),
});
export type KotlinOptions = z.infer<typeof kotlinOptions>;
export interface KotlinFile { readonly id: string; readonly path: string; readonly text: string; readonly artifacts: readonly ArtifactAssociation[]; readonly adopted?: boolean | undefined; readonly support?: true | undefined }
export interface KotlinCarrier { readonly owner: NodeId; readonly path: string; readonly type: TypeId; readonly parameters: readonly NodeId[]; readonly artifact: ArtifactAssociation; readonly text: string; readonly member: 'text' | 'value'; readonly enumCases?: readonly string[] }
const typeKinds = new Set(['class', 'interface', 'concept', 'component', 'record-type-declaration', 'alias-type-declaration', 'opaque-type-declaration']);
const roots = new Set([...typeKinds, 'function']);
const namedKinds = new Set([...roots, 'capability', 'field', 'parameter', 'type-parameter']);
const unwrap = (item: Item): Item => item.kind === 'local' ? item.declaration : item;
const quote = (text: string) => JSON.stringify(text).replaceAll('$', '\\$');
const doc = (lines: readonly string[]): string => lines.length ? '/**\n' + lines.map(line => ' * ' + line.replaceAll('*/', '* /')).join('\n') + '\n */\n' : '';

/** Projects the existing checked type catalog into Kotlin declarations. */
export class KotlinDeclarations {
  readonly problems: Diagnostic[] = [];
  readonly constraints = new Set<string>();
  readonly carriers: KotlinCarrier[] = [];
  readonly companions: ArtifactAssociation[] = [];
  private readonly inspection;
  private readonly types;
  private readonly selected: Item[];
  private readonly tuples = new Map<number, Item>();
  private readonly names = new Map<NodeId, string>();
  private readonly mappings = new Map<NodeId, KotlinOptions['imports'][number]>();
  private readonly generated = new Set<NodeId>();
  private imports = new Map<string, string>();
  private file = '';
  private artifacts: ArtifactAssociation[] = [];
  private restrictions = new Map<string, string>();
  private restrictionTypes = new Map<string, TypeId>();
  constructor(private readonly current: IdentifiedSpecification, private readonly options: KotlinOptions, context?: OutputContext) {
    this.inspection = current.specification.inspection; this.types = current.specification.types;
    const modules = new Set([current.specification.entry, ...context?.workspaceModules ?? []]);
    this.selected = [...this.inspection.roots()].filter(item => roots.has(item.kind) && item.origin.kind === 'source' && modules.has(item.origin.module));
    for (const record of current.baseline.elements) {
      if (record.origin.kind === 'source' && modules.has(record.origin.module)) this.generated.add(current.node(record.id));
    }
    for (const rule of options.names) {
      const item = this.select(rule, item => namedKinds.has(item.kind) && this.generated.has(item.id));
      if (item) {
        if (this.names.has(item.id)) this.problem('invalid-native-mapping', item, 'A declaration has more than one native name.');
        else this.names.set(item.id, rule.name);
      }
    }
    for (const rule of options.imports) {
      const item = this.select(rule, item => typeKinds.has(item.kind) && (!this.generated.has(item.id) || item.kind === 'opaque-type-declaration'));
      if (item) {
        if (this.mappings.has(item.id)) this.problem('invalid-native-mapping', item, 'A declaration has more than one native type mapping.');
        else this.mappings.set(item.id, rule);
      }
    }
  }
  mapping(): { id: string; kind: 'name' | 'import'; name: string; as?: string }[] {
    return [...[...this.names].map(([node, name]) => ({ id: this.current.id(node), kind: 'name' as const, name })),
      ...[...this.mappings].map(([node, rule]) => ({ id: this.current.id(node), kind: 'import' as const, name: rule.name, ...(rule.as ? { as: rule.as } : {}) }))]
      .sort((a, b) => a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind));
  }
  private select(rule: KotlinOptions['names'][number], eligible: (item: Item) => boolean): Item | undefined {
    const selected = selectKotlinMapping(this.current, rule, eligible, 'kotlin');
    this.problems.push(...selected.problems); return selected.value;
  }
  private problem(code: string, item: Item, message: string): void { this.problems.push({ code, message, at: item.origin, related: [] }); }
  private known<T>(fact: TypeFact<T>): T { if (fact.status !== 'known') throw new Error('Kotlin output requires checked type facts.'); return fact.value; }
  private name(item: Item): string {
    const name = this.names.get(item.id) ?? ('name' in item ? item.name : item.kind);
    if (!identifier(name)) this.problem('invalid-native-name', item, 'Provide a Kotlin name for ' + name + '.'); return name;
  }
  private nativeName(item: Item): string {
    const owner = this.current.baseline.elements.find(record => record.id === this.current.id(item.id))?.address.owner;
    return (owner ? this.nativeName(this.inspection.read(this.current.node(owner))) + '.' : '') + this.name(item);
  }
  private authored(item: Item): string {
    const record = this.current.baseline.elements.find(record => record.id === this.current.id(item.id))!;
    return (record.address.owner ? this.authored(this.inspection.read(this.current.node(record.address.owner))) + '.' : '') + (record.address.name ?? record.address.kind);
  }
  private associate(item: Item, declaration: JsonValue[], companion = false): ArtifactAssociation {
    const artifact = { specId: this.current.id(item.id), locator: { outputId: 'kotlin', format: 'kotlin-symbol-1', value: { file: this.file, declaration } } };
    this.artifacts.push(artifact); if (companion) this.companions.push(artifact); return artifact;
  }
  private checkScope(name: string, owner: Item): void {
    for (let item: Item | undefined = owner; item; item = this.inspection.parent(item.id)) {
      if ('typeParameters' in item && item.typeParameters.some(parameter => this.name(parameter) === name)) {
        this.problem('native-name-conflict', owner, 'A generic parameter hides the referenced native type: ' + name); return;
      }
    }
  }
  private hidesBuiltin(name: string, owner: Item): boolean {
    if (this.current.baseline.elements.some(record => typeKinds.has(record.address.kind) && this.generated.has(this.current.node(record.id)) && this.name(this.inspection.read(this.current.node(record.id))) === name)
      || [...this.mappings.values()].some(rule => (rule.as ?? rule.name.split('.').at(-1)) === name)) return true;
    for (let item: Item | undefined = owner; item; item = this.inspection.parent(item.id)) {
      if ('typeParameters' in item && item.typeParameters.some(parameter => this.name(parameter) === name)) return true;
    }
    return false;
  }
  type(id: TypeId, owner: Item, qualified = false, suffix = ''): string {
    const meaning = this.types.describe(id);
    if (meaning.kind === 'parameter') return this.name(this.inspection.read(meaning.declaration));
    if (meaning.kind === 'builtin' || meaning.kind === 'declared' || meaning.kind === 'alias') {
      const declaration = this.inspection.read(meaning.declaration), args = meaning.arguments.map((type, index) => this.type(type, owner, qualified, suffix + (meaning.kind === 'builtin' ? 'Element' : 'Argument' + (index + 1))));
      if (meaning.kind === 'builtin') {
        const name = this.inspection.read(meaning.declaration, 'builtin-type').name;
        const native = ({ Text: 'String', Number: 'Double', Boolean: 'Boolean', Nothing: 'Unit', List: 'MutableList' })[name]!;
        const prefix = qualified || this.hidesBuiltin(native, owner) ? name === 'List' ? 'kotlin.collections.' : 'kotlin.' : '';
        return prefix + native + (name === 'List' ? '<' + args.join(', ') + '>' : '');
      }
      const mapping = this.mappings.get(declaration.id);
      let name: string;
      if (mapping) {
        const local = mapping.as ?? mapping.name.split('.').at(-1)!;
        const imported = mapping.name + (mapping.as ? ' as ' + mapping.as : '');
        if (this.imports.has(local) && this.imports.get(local) !== imported || this.selected.some(item => item.kind !== 'opaque-type-declaration' && this.name(item) === local)) {
          this.problem('native-name-conflict', owner, 'Native import conflicts with another declaration: ' + local);
        }
        this.imports.set(local, imported); name = qualified ? mapping.name : local;
      } else if (!this.generated.has(declaration.id) || declaration.kind === 'opaque-type-declaration') {
        this.problem('missing-native-mapping', owner, 'Provide a native type mapping for ' + this.authored(declaration) + '.'); name = '__unmapped';
      } else name = (qualified ? this.options.package + '.' : '') + this.nativeName(declaration);
      this.checkScope(mapping?.as ?? mapping?.name.split('.').at(-1) ?? this.name(declaration), owner);
      return name + (args.length ? '<' + args.join(', ') + '>' : '');
    }
    if (meaning.kind === 'optional') return this.type(meaning.inner, owner, qualified, suffix) + '?';
    if (meaning.kind === 'tuple') { this.tuples.set(meaning.elements.length, owner); return (qualified ? this.options.package + '.' : '') + 'Tuple' + meaning.elements.length + '<' + meaning.elements.map((type, index) => this.type(type, owner, qualified, suffix + 'Item' + (index + 1))).join(', ') + '>'; }
    if ((meaning.kind === 'literal' || meaning.kind === 'union') && owner.kind === 'field') {
      const parent = this.inspection.parent(owner.id);
      if (parent?.kind === 'record-type-declaration' && parent.error && owner.name === 'code') {
        this.constraints.add(this.current.id(owner.id));
        const name = this.name(parent) + 'Code', names = new Set<string>();
        const enumCases = this.known(this.types.error(this.types.declaredType(parent.id))).codes;
        const cases = enumCases.map(value => {
          const entry = value.slice(0, 1).toUpperCase() + value.slice(1);
          if (!identifier(entry) || names.has(entry)) this.problem('unsupported-literal-name', owner, 'Error code has no distinct Kotlin case name: ' + value);
          names.add(entry); return entry + '(' + quote(value) + ')';
        });
        if (this.selected.some(item => this.name(item) === name)) this.problem('native-name-conflict', owner, 'The error code companion conflicts with another native declaration: ' + name);
        const text = 'enum class ' + name + '(val value: kotlin.String) { ' + cases.join(', ') + ' }';
        this.restrictions.set(name, text);
        const artifact = this.associate(owner, [{ kind: 'class', name }], true);
        this.carriers.push({ owner: owner.id, path: suffix, type: id, parameters: [], artifact, text, member: 'value', enumCases });
        return (qualified ? this.options.package + '.' : '') + name;
      }
    }
    if (meaning.kind === 'literal' || meaning.kind === 'union') {
      const name = this.nativeName(owner).split('.').map(part => part.slice(0, 1).toUpperCase() + part.slice(1)).join('')
        + (owner.kind === 'alias-type-declaration' ? 'Value' : owner.kind === 'function' || owner.kind === 'capability' ? 'Result' : '') + suffix;
      const parameters = this.typeParameters(id);
      if (this.selected.some(item => this.name(item) === name) || this.restrictionTypes.has(name) && this.restrictionTypes.get(name) !== id) {
        this.problem('native-name-conflict', owner, 'The anonymous restriction conflicts with another native declaration: ' + name);
      } else if (!this.restrictionTypes.has(name)) {
        const text = this.restriction(id, name, owner, parameters);
        this.restrictionTypes.set(name, id); this.restrictions.set(name, text);
        const artifact = this.associate(owner, [{ kind: this.restrictionKind(id), name }], true);
        this.carriers.push({ owner: owner.id, path: suffix, type: id, parameters: this.typeParameterNodes(id), artifact, text,
          member: meaning.kind === 'union' && !parameters && meaning.alternatives.every(type => { const shape = this.types.describe(type); return shape.kind === 'literal' && this.inspection.read(shape.expression, 'literal-type').value.kind === 'string-literal'; }) ? 'text' : 'value' });
      }
      return (qualified ? this.options.package + '.' : '') + name + parameters;
    }
    this.problem('unsupported-native-type', owner, 'This type requires a named native restriction.'); return 'Any?';
  }
  private restrictionKind(id: TypeId): 'class' | 'interface' {
    const shape = this.types.describe(id);
    return shape.kind === 'union' && !shape.alternatives.every(type => {
      const meaning = this.types.describe(type);
      return meaning.kind === 'literal' && this.inspection.read(meaning.expression, 'literal-type').value.kind === 'string-literal';
    }) ? 'interface' : 'class';
  }
  private typeParameters(id: TypeId, seen = new Set<TypeId>()): string {
    const parameters = this.typeParameterNodes(id, seen).map(id => this.name(this.inspection.read(id)));
    return parameters.length ? '<' + parameters.join(', ') + '>' : '';
  }
  private typeParameterNodes(id: TypeId, seen = new Set<TypeId>()): NodeId[] {
    const parameters = new Set<NodeId>();
    const visit = (type: TypeId): void => {
      if (seen.has(type)) return; seen.add(type);
      const meaning = this.types.describe(type);
      if (meaning.kind === 'parameter') parameters.add(meaning.declaration);
      else if ('arguments' in meaning) meaning.arguments.forEach(visit);
      else if (meaning.kind === 'tuple') meaning.elements.forEach(visit);
      else if (meaning.kind === 'union') meaning.alternatives.forEach(visit);
      else if (meaning.kind === 'optional') visit(meaning.inner);
    };
    visit(id); return [...parameters];
  }
  private literal(item: Item<'literal-type'>): { type: string; value: string } {
    if (item.value.kind === 'string-literal') return { type: 'kotlin.String', value: quote(item.value.value) };
    if (item.value.kind === 'boolean-literal') return { type: 'kotlin.Boolean', value: String(item.value.value) };
    const token = (item.negative ? '-' : '') + item.value.token, value = Number(token);
    if (!Number.isFinite(value) || decimal(token) !== decimal(String(value))) this.problem('unsupported-number', item, 'This literal would change in the finite binary64 number profile.');
    return { type: 'kotlin.Double', value: String(value) + (Number.isInteger(value) && !String(value).includes('e') ? '.0' : '') };
  }
  private restriction(id: TypeId, name: string, owner: Item, parameters = ''): string {
    this.constraints.add(this.current.id(owner.id));
    const shape = this.types.describe(id);
    if (shape.kind === 'literal') {
      const value = this.literal(this.inspection.read(shape.expression, 'literal-type'));
      return 'data class ' + name + parameters + '(val value: ' + value.type + ') {\n    init { kotlin.require(value == ' + value.value + ') { ' + quote('Expected ' + this.authored(owner)) + ' } }\n}';
    }
    if (shape.kind !== 'union') throw new Error('Expected a checked restriction.');
    const text = shape.alternatives.map(type => this.types.describe(type)).flatMap(type => type.kind === 'literal' ? [this.inspection.read(type.expression, 'literal-type')] : []);
    if (text.length === shape.alternatives.length && text.every(item => item.value.kind === 'string-literal')) {
      if (parameters) return 'data class ' + name + parameters + '(val value: kotlin.String) {\n    init { kotlin.require('
        + text.map(item => 'value == ' + this.literal(item).value).join(' || ') + ') { ' + quote('Expected ' + this.authored(owner)) + ' } }\n}';
      const names = new Set<string>();
      const cases = text.map(item => {
        if (item.value.kind !== 'string-literal') throw new Error('Expected text literal.');
        const value = item.value.value, native = value.slice(0, 1).toUpperCase() + value.slice(1);
        if (!identifier(native) || names.has(native)) this.problem('unsupported-literal-name', item, 'Literal has no distinct Kotlin case name: ' + value);
        names.add(native); return native + '(' + quote(value) + ')';
      });
      return 'enum class ' + name + '(val text: kotlin.String) { ' + cases.join(', ') + ' }';
    }
    const compatibility = new TypeCompatibility(this.types), names = new Set<string>();
    const alternatives = shape.alternatives.map((type, index) => {
      if (shape.alternatives.slice(0, index).some(other => compatibility.assignable(type, other).value !== false || compatibility.assignable(other, type).value !== false)) {
        this.problem('ambiguous-native-union', owner, 'The native alternative must be uniquely determined by its checked type.');
      }
      const meaning = this.types.describe(type);
      const literal = meaning.kind === 'literal' ? this.literal(this.inspection.read(meaning.expression, 'literal-type')) : undefined;
      const variant = 'declaration' in meaning ? this.name(this.inspection.read(meaning.declaration))
        : literal?.type === 'kotlin.String' ? 'Text' : literal?.type === 'kotlin.Double' ? 'Number' : literal?.type === 'kotlin.Boolean' ? 'Boolean'
        : meaning.kind === 'tuple' ? 'Tuple' + meaning.elements.length : '';
      if (!identifier(variant) || names.has(variant) || meaning.kind === 'parameter') this.problem('ambiguous-native-union', owner, 'Provide distinct named alternatives whose native representation is unambiguous.');
      names.add(variant);
      return '    data class ' + variant + parameters + '(val value: ' + (literal?.type ?? this.type(type, owner, true)) + ') : ' + name + parameters
        + (literal ? ' { init { kotlin.require(value == ' + literal.value + ') } }' : '');
    });
    return 'sealed interface ' + name + parameters + ' {\n' + alternatives.join('\n') + '\n}';
  }
  private codeMember(type: TypeId): string {
    const meaning = this.types.describe(type);
    if (meaning.kind !== 'alias') return 'value';
    const target = this.known(meaning.target), declaration = this.inspection.read(meaning.declaration);
    return this.types.describe(target).kind === 'union' && declaration.kind === 'alias-type-declaration' && !declaration.typeParameters.length
      ? 'text' : this.codeMember(target);
  }
  private parameters(items: readonly Item<'parameter'>[]): string {
    return items.map(item => this.name(item) + ': ' + this.type(this.known(this.types.typeOf(item.declaredType.id)), item)
      + (item.hasDefault ? ' = throw ' + (this.hidesBuiltin('NotImplementedError', item) ? 'kotlin.' : '') + 'NotImplementedError(' + quote('Unimplemented default: ' + this.authored(item)) + ')' : '')).join(', ');
  }
  private callable(item: Item<'function' | 'capability'>, owner: JsonValue[] = [], signature = false, private_ = false): string {
    const facts = this.types.callable(item.id), result = this.known(facts.result), name = this.name(item);
    const returns = result.kind === 'value' ? this.type(result.type, item) : result.kind === 'none' ? (this.hidesBuiltin('Unit', item) ? 'kotlin.Unit' : 'Unit') : (this.hidesBuiltin('Any', item) ? 'kotlin.Any?' : 'Any?');
    const parameters = item.parameters.map(parameter => this.type(this.known(this.types.typeOf(parameter.declaredType.id)), parameter, true));
    const selector = [...owner, { kind: 'function', name, parameters }];
    this.associate(item, selector);
    for (const parameter of item.parameters) this.associate(parameter, [...selector, { kind: 'parameter', name: this.name(parameter) }]);
    const lines = ['Unverified implementation obligation: ' + this.authored(item) + '.'];
    if (result.kind === 'unspecified') lines.push('unspecified-result: Any? is a scaffold placeholder.');
    if (item.body.kind === 'available') lines.push(...item.body.content.members.map(member => member.kind === 'promises' ? member.text : language(member)));
    lines.push(...item.failures.map(failure => '@throws ' + language(failure) + ': declared exceptional completion, unverified implementation obligation.'));
    return doc(lines) + (private_ ? 'private ' : '') + 'fun ' + name + '(' + this.parameters(item.parameters) + '): ' + returns
      + (signature ? '' : ' {\n    throw ' + (this.hidesBuiltin('NotImplementedError', item) ? 'kotlin.' : '') + 'NotImplementedError(' + quote('Not implemented: ' + this.authored(item)) + ')\n}');
  }
  private declare(item: Item, owners: JsonValue[] = []): string {
    const name = this.name(item), parameters = 'typeParameters' in item && item.typeParameters.length ? '<' + item.typeParameters.map(item => this.name(item)).join(', ') + '>' : '';
    if (item.kind === 'function') return this.callable(item, owners);
    if (item.kind === 'alias-type-declaration') {
      const target = this.known(this.types.typeOf(item.targetType.id)), shape = this.types.describe(target);
      const restricted = shape.kind === 'union' || shape.kind === 'literal';
      const selector = [...owners, { kind: restricted ? this.restrictionKind(target) : 'typealias', name }];
      this.associate(item, selector);
      for (const parameter of item.typeParameters) this.associate(parameter, [...selector, { kind: 'type-parameter', name: this.name(parameter) }]);
      return restricted ? this.restriction(target, name, item, parameters) : 'typealias ' + name + parameters + ' = ' + this.type(target, item);
    }
    if (item.kind === 'record-type-declaration') {
      const selector = [...owners, { kind: 'class', name }];
      this.associate(item, selector);
      for (const parameter of item.typeParameters) this.associate(parameter, [...selector, { kind: 'type-parameter', name: this.name(parameter) }]);
      const fields = item.fields.map(unwrap).filter((item): item is Item<'field'> => item.kind === 'field');
      const content = fields.map(field => {
        const type = this.type(this.known(this.types.typeOf(field.declaredType.id)), field);
        this.associate(field, [...owners, { kind: 'class', name }, { kind: 'property', name: this.name(field) }]);
        return 'var ' + this.name(field) + ': ' + type + (type.endsWith('?') ? ' = null' : '');
      });
      let text = (fields.length ? 'data ' : '') + 'class ' + name + parameters + '(' + content.join(', ') + ')';
      if (item.error) {
        const companion = name + 'Exception'; this.associate(item, [...owners, { kind: 'class', name: companion }], true);
        text += '\n\n' + doc(['Declared domain failure. Generic payload arguments remain data; JVM exception types are nongeneric.'])
          + 'class ' + companion + '(val details: ' + name + (item.typeParameters.length ? '<' + item.typeParameters.map(() => '*').join(', ') + '>' : '') + ') : ' + (this.hidesBuiltin('RuntimeException', item) ? 'kotlin.' : '') + 'RuntimeException(details.code.'
            + this.codeMember(this.known(this.types.typeOf(fields.find(field => field.name === 'code')!.declaredType.id))) + ')';
      }
      return text;
    }
    if (item.kind === 'class' || item.kind === 'interface' || item.kind === 'concept' || item.kind === 'component') {
      const kind = item.kind === 'class' || item.kind === 'interface' ? item.kind : this.options.concepts;
      this.associate(item, [...owners, { kind, name }]);
      const publicIds = new Set(item.members.flatMap(member => member.kind === 'public' ? member.references.flatMap(reference => reference.resolution.status === 'bound' ? [reference.resolution.target] : []) : []));
      const owner = [...owners, { kind, name }];
      const construction = item.members.map(unwrap).find(member => member.kind === 'construction');
      if (construction && kind === 'interface') this.problem('unsupported-native-construction', construction, 'A Kotlin interface cannot declare construction.');
      if (construction && kind === 'class') {
        const selector = [...owner, { kind: 'constructor', name: '<init>', parameters: construction.parameters.map(parameter => this.type(this.known(this.types.typeOf(parameter.declaredType.id)), parameter, true)) }];
        this.associate(construction, selector);
        for (const parameter of construction.parameters) this.associate(parameter, [...selector, { kind: 'parameter', name: this.name(parameter) }]);
      }
      const members = item.members.map(unwrap).flatMap(member => {
        if (member.kind === 'capability' || member.kind === 'function') return [this.callable(member, owner, kind === 'interface', !publicIds.has(member.id))];
        if (member.kind === 'opaque-type-declaration') {
          if (!this.mappings.has(member.id)) this.problem('missing-native-mapping', member, 'Provide a native type mapping for ' + this.authored(member) + '.');
          return [];
        }
        return roots.has(member.kind) ? ['private ' + this.declare(member, owner)] : [];
      });
      if (construction && kind === 'class') members.unshift(doc(['Unverified implementation obligation: ' + this.authored(construction) + '.'])
        + 'init { throw ' + (this.hidesBuiltin('NotImplementedError', item) ? 'kotlin.' : '') + 'NotImplementedError(' + quote('Not implemented: ' + this.authored(construction)) + ') }');
      return kind + ' ' + name + parameters + (construction && kind === 'class' ? '(' + this.parameters(construction.parameters) + ')' : '')
        + ' {\n' + members.map(text => text.split('\n').map(line => '    ' + line).join('\n')).join('\n\n') + '\n}';
    }
    this.problem('unsupported-native-declaration', item, 'No native declaration mapping for ' + item.kind); return '';
  }
  render(): KotlinFile[] {
    const files: KotlinFile[] = [];
    for (const item of this.selected) {
      if (item.kind === 'opaque-type-declaration') {
        if (!this.mappings.has(item.id)) this.problem('missing-native-mapping', item, 'Provide a native type mapping for ' + this.authored(item) + '.');
        continue;
      }
      this.imports = new Map();
      this.file = this.options.directory + '/' + this.options.package.replaceAll('.', '/') + '/' + this.name(item) + '.kt'; this.artifacts = []; this.restrictions = new Map(); this.restrictionTypes = new Map();
      const declaration = this.declare(item);
      const text = 'package ' + this.options.package + '\n\n' + [...this.imports.values()].sort().map(value => 'import ' + value + '\n').join('')
        + (this.imports.size ? '\n' : '') + doc(['Number profile: finite binary64 (Kotlin Double).']) + declaration + '\n'
        + [...this.restrictions.values()].map(value => '\n' + value + '\n').join('');
      files.push({ id: this.current.id(item.id), path: this.file, text, artifacts: this.artifacts });
    }
    for (const [arity, owner] of this.tuples) {
      const path = this.options.directory + '/' + this.options.package.replaceAll('.', '/') + '/Tuple' + arity + '.kt';
      files.push({ id: this.current.id(owner.id), path, text: kotlinTuple(this.options.package, arity),
      artifacts: [{ specId: this.current.id(owner.id), locator: { outputId: 'kotlin', format: 'kotlin-file-1', value: { file: path } } }] });
    }
    const seen = new Set<string>();
    for (const file of files) { const path = file.path.toLowerCase(); if (seen.has(path)) this.problem('native-name-conflict', this.inspection.read(this.current.node(file.id)), 'Generated native filename collides: ' + file.path); seen.add(path); }
    return files;
  }
}
