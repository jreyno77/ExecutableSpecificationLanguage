import { z } from 'zod';
import type { Diagnostic } from './checking.js';
import type { Item } from './inspection-item.js';
import type { NodeId } from './model.js';
import type { OutputContext } from './output.js';
import type { ArtifactAssociation, IdentifiedSpecification, JsonValue } from './specification-identity.js';
import type { TypeFact, TypeId } from './type-description.js';
import { literal } from './project-files.js';
import { language } from './language-text.js';
import { identifier as specIdentifier } from './identity-baseline.js';

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
export interface KotlinFile { readonly id: string; readonly path: string; readonly text: string; readonly artifacts: readonly ArtifactAssociation[] }
const typeKinds = new Set(['class', 'interface', 'concept', 'component', 'record-type-declaration', 'alias-type-declaration', 'opaque-type-declaration']);
const roots = new Set([...typeKinds, 'function']);
const namedKinds = new Set([...roots, 'capability', 'field', 'parameter', 'type-parameter']);
const unwrap = (item: Item): Item => item.kind === 'local' ? item.declaration : item;
const quote = (text: string) => JSON.stringify(text).replaceAll('$', '\\$');
const doc = (lines: readonly string[]): string => lines.length ? '/**\n' + lines.map(line => ' * ' + line.replaceAll('*/', '* /')).join('\n') + '\n */\n' : '';

/** Projects the existing checked type catalog into Kotlin declarations. */
export class KotlinDeclarations {
  readonly problems: Diagnostic[] = [];
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
    const records = new Map(this.current.baseline.elements.map(record => [record.id, record]));
    const path = (id: string): readonly (string | null)[] => {
      const record = records.get(id)!; return [...(record.address.owner ? path(record.address.owner) : []), record.address.name];
    };
    const matches = this.current.baseline.elements.filter(record => 'id' in rule ? record.id === rule.id
      : (!rule.module || rule.module === record.address.module) && JSON.stringify(path(record.id)) === JSON.stringify(rule.declaration))
      .map(record => this.inspection.read(this.current.node(record.id))).filter(eligible);
    if (matches.length === 1) return matches[0];
    this.problems.push({ code: 'invalid-native-mapping', message: 'A mapping must select exactly one eligible declaration.',
      at: { kind: 'dependency', path: ['outputs', 'kotlin', 'id' in rule ? rule.id : rule.declaration.join('.')] }, related: matches.map(item => item.origin) });
    return undefined;
  }
  private problem(code: string, item: Item, message: string): void { this.problems.push({ code, message, at: item.origin, related: [] }); }
  private known<T>(fact: TypeFact<T>): T { if (fact.status !== 'known') throw new Error('Kotlin output requires checked type facts.'); return fact.value; }
  private name(item: Item): string {
    const name = this.names.get(item.id) ?? ('name' in item ? item.name : item.kind);
    if (!identifier(name)) this.problem('invalid-native-name', item, 'Provide a Kotlin name for ' + name + '.'); return name;
  }
  private authored(item: Item): string {
    const record = this.current.baseline.elements.find(record => record.id === this.current.id(item.id))!;
    return (record.address.owner ? this.authored(this.inspection.read(this.current.node(record.address.owner))) + '.' : '') + record.address.name;
  }
  private associate(item: Item, declaration: JsonValue[]): void {
    this.artifacts.push({ specId: this.current.id(item.id), locator: { outputId: 'kotlin', format: 'kotlin-symbol-1', value: { file: this.file, declaration } } });
  }
  private checkScope(name: string, owner: Item): void {
    for (let item: Item | undefined = owner; item; item = this.inspection.parent(item.id)) {
      if ('typeParameters' in item && item.typeParameters.some(parameter => this.name(parameter) === name)) {
        this.problem('native-name-conflict', owner, 'A generic parameter hides the referenced native type: ' + name); return;
      }
    }
  }
  type(id: TypeId, owner: Item, qualified = false): string {
    const meaning = this.types.describe(id);
    if (meaning.kind === 'parameter') return this.name(this.inspection.read(meaning.declaration));
    if (meaning.kind === 'builtin' || meaning.kind === 'declared' || meaning.kind === 'alias') {
      const declaration = this.inspection.read(meaning.declaration), args = meaning.arguments.map(type => this.type(type, owner, qualified));
      if (meaning.kind === 'builtin') {
        const name = this.inspection.read(meaning.declaration, 'builtin-type').name;
        return name === 'List' ? (qualified ? 'kotlin.collections.' : '') + 'MutableList<' + args.join(', ') + '>'
          : (qualified ? 'kotlin.' : '') + ({ Text: 'String', Number: 'Double', Boolean: 'Boolean', Nothing: 'Unit' })[name as 'Text'];
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
      } else name = (qualified ? this.options.package + '.' : '') + this.name(declaration);
      this.checkScope(mapping?.as ?? mapping?.name.split('.').at(-1) ?? this.name(declaration), owner);
      return name + (args.length ? '<' + args.join(', ') + '>' : '');
    }
    if (meaning.kind === 'optional') return this.type(meaning.inner, owner, qualified) + '?';
    if (meaning.kind === 'tuple') { this.tuples.set(meaning.elements.length, owner); return (qualified ? this.options.package + '.' : '') + 'Tuple' + meaning.elements.length + '<' + meaning.elements.map(type => this.type(type, owner, qualified)).join(', ') + '>'; }
    if (meaning.kind === 'literal' && owner.kind === 'field') {
      const parent = this.inspection.parent(owner.id), value = this.inspection.read(meaning.expression, 'literal-type').value;
      if (parent?.kind === 'record-type-declaration' && parent.error && owner.name === 'code' && value.kind === 'string-literal') {
        const name = this.name(parent) + 'Code', entry = value.value.slice(0, 1).toUpperCase() + value.value.slice(1);
        if (!identifier(entry)) this.problem('unsupported-literal-name', owner, 'Error code has no Kotlin case name: ' + value.value);
        this.restrictions.set(name, 'enum class ' + name + '(val value: String) { ' + entry + '(' + quote(value.value) + ') }');
        this.associate(owner, [{ kind: 'class', name }]); return (qualified ? this.options.package + '.' : '') + name;
      }
    }
    this.problem('unsupported-native-type', owner, 'This type requires a named native restriction.'); return 'Any?';
  }
  private parameters(items: readonly Item<'parameter'>[]): string {
    return items.map(item => this.name(item) + ': ' + this.type(this.known(this.types.typeOf(item.declaredType.id)), item)
      + (item.hasDefault ? ' = throw NotImplementedError(' + quote('Unimplemented default: ' + this.authored(item)) + ')' : '')).join(', ');
  }
  private callable(item: Item<'function' | 'capability'>, owner: JsonValue[] = [], signature = false, private_ = false): string {
    const facts = this.types.callable(item.id), result = this.known(facts.result), name = this.name(item);
    const returns = result.kind === 'value' ? this.type(result.type, item) : result.kind === 'none' ? 'Unit' : 'Any?';
    const parameters = item.parameters.map(parameter => this.type(this.known(this.types.typeOf(parameter.declaredType.id)), parameter, true));
    this.associate(item, [...owner, { kind: 'function', name, parameters }]);
    const lines = ['Unverified implementation obligation: ' + this.authored(item) + '.'];
    if (result.kind === 'unspecified') lines.push('unspecified-result: Any? is a scaffold placeholder.');
    if (item.body.kind === 'available') lines.push(...item.body.content.members.map(member => member.kind === 'promises' ? member.text : language(member)));
    lines.push(...item.failures.map(failure => '@throws ' + language(failure) + ': declared exceptional completion, unverified implementation obligation.'));
    return doc(lines) + (private_ ? 'private ' : '') + 'fun ' + name + '(' + this.parameters(item.parameters) + '): ' + returns
      + (signature ? '' : ' {\n    throw NotImplementedError(' + quote('Not implemented: ' + this.authored(item)) + ')\n}');
  }
  private declare(item: Item): string {
    const name = this.name(item), parameters = 'typeParameters' in item && item.typeParameters.length ? '<' + item.typeParameters.map(item => this.name(item)).join(', ') + '>' : '';
    if (item.kind === 'function') return this.callable(item);
    if (item.kind === 'alias-type-declaration') {
      const target = this.known(this.types.typeOf(item.targetType.id)), shape = this.types.describe(target);
      if (shape.kind === 'union' && shape.alternatives.every(type => this.types.describe(type).kind === 'literal')) {
        const names = new Set<string>();
        const cases = shape.alternatives.map(type => {
          const meaning = this.types.describe(type);
          if (meaning.kind !== 'literal') throw new Error('Expected checked literal.');
          const literal = this.inspection.read(meaning.expression, 'literal-type');
          if (literal.value.kind !== 'string-literal') { this.problem('unsupported-native-type', literal, 'This union requires a sealed native alternative.'); return ''; }
          const text = literal.value.value, native = text.slice(0, 1).toUpperCase() + text.slice(1);
          if (!identifier(native) || names.has(native)) this.problem('unsupported-literal-name', literal, 'Literal has no distinct Kotlin case name: ' + text);
          names.add(native); return native + '(' + quote(text) + ')';
        });
        this.associate(item, [{ kind: 'class', name }]); return 'enum class ' + name + '(val text: String) { ' + cases.join(', ') + ' }';
      }
      this.associate(item, [{ kind: 'typealias', name }]); return 'typealias ' + name + parameters + ' = ' + this.type(target, item);
    }
    if (item.kind === 'record-type-declaration') {
      this.associate(item, [{ kind: 'class', name }]);
      const fields = item.fields.map(unwrap).filter((item): item is Item<'field'> => item.kind === 'field');
      const content = fields.map(field => {
        const type = this.type(this.known(this.types.typeOf(field.declaredType.id)), field);
        this.associate(field, [{ kind: 'class', name }, { kind: 'property', name: this.name(field) }]);
        return 'var ' + this.name(field) + ': ' + type + (type.endsWith('?') ? ' = null' : '');
      });
      let text = (fields.length ? 'data ' : '') + 'class ' + name + parameters + '(' + content.join(', ') + ')';
      if (item.error) {
        const companion = name + 'Exception'; this.associate(item, [{ kind: 'class', name: companion }]);
        text += '\n\n' + doc(['Declared domain failure. Generic payload arguments remain data; JVM exception types are nongeneric.'])
          + 'class ' + companion + '(val details: ' + name + (item.typeParameters.length ? '<' + item.typeParameters.map(() => '*').join(', ') + '>' : '') + ') : RuntimeException(details.code.value)';
      }
      return text;
    }
    if (item.kind === 'class' || item.kind === 'interface' || item.kind === 'concept' || item.kind === 'component') {
      const kind = item.kind === 'class' || item.kind === 'interface' ? item.kind : this.options.concepts;
      this.associate(item, [{ kind, name }]);
      const publicIds = new Set(item.members.flatMap(member => member.kind === 'public' ? member.references.flatMap(reference => reference.resolution.status === 'bound' ? [reference.resolution.target] : []) : []));
      const members = item.members.map(unwrap).flatMap(member => member.kind === 'capability' || member.kind === 'function'
        ? [this.callable(member, [{ kind, name }], kind === 'interface', !publicIds.has(member.id))] : []);
      return kind + ' ' + name + parameters + ' {\n' + members.map(text => text.split('\n').map(line => '    ' + line).join('\n')).join('\n\n') + '\n}';
    }
    this.problem('unsupported-native-declaration', item, 'No native declaration mapping for ' + item.kind); return '';
  }
  render(): KotlinFile[] {
    const files: KotlinFile[] = [], prefix = 'package ' + this.options.package + '\n\n' + doc(['Number profile: finite binary64 (Kotlin Double).']);
    for (const item of this.selected) {
      if (item.kind === 'opaque-type-declaration') {
        if (!this.mappings.has(item.id)) this.problem('missing-native-mapping', item, 'Provide a native type mapping for ' + this.authored(item) + '.');
        continue;
      }
      this.imports = new Map();
      this.file = this.options.directory + '/' + this.options.package.replaceAll('.', '/') + '/' + this.name(item) + '.kt'; this.artifacts = []; this.restrictions = new Map();
      const declaration = this.declare(item);
      const text = 'package ' + this.options.package + '\n\n' + [...this.imports.values()].sort().map(value => 'import ' + value + '\n').join('')
        + (this.imports.size ? '\n' : '') + doc(['Number profile: finite binary64 (Kotlin Double).']) + declaration + '\n'
        + [...this.restrictions.values()].map(value => '\n' + value + '\n').join('');
      files.push({ id: this.current.id(item.id), path: this.file, text, artifacts: this.artifacts });
    }
    for (const [arity, owner] of this.tuples) {
      const path = this.options.directory + '/' + this.options.package.replaceAll('.', '/') + '/Tuple' + arity + '.kt';
      const indices = Array.from({ length: arity }, (_, index) => index + 1);
      files.push({ id: this.current.id(owner.id), path, text: prefix + 'data class Tuple' + arity + '<' + indices.map(index => 'T' + index).join(', ') + '>('
        + indices.map(index => 'var item' + index + ': T' + index).join(', ') + ')\n',
      artifacts: [{ specId: this.current.id(owner.id), locator: { outputId: 'kotlin', format: 'kotlin-file-1', value: { file: path } } }] });
    }
    const seen = new Set<string>();
    for (const file of files) { const path = file.path.toLowerCase(); if (seen.has(path)) this.problem('native-name-conflict', this.inspection.read(this.current.node(file.id)), 'Generated native filename collides: ' + file.path); seen.add(path); }
    return files;
  }
}
