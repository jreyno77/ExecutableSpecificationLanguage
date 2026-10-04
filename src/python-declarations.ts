import { z } from 'zod';
import type { Diagnostic } from './checking.js';
import type { Item } from './inspection-item.js';
import type { NodeId } from './model.js';
import type { OutputContext } from './output.js';
import type { ArtifactAssociation, IdentifiedSpecification } from './specification-identity.js';
import type { TypeFact, TypeId } from './type-description.js';
import { identifier as specId } from './identity-baseline.js';
import { literal } from './project-files.js';
import { PythonTypes } from './python-types.js';

const keywords = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
export const pythonName = (name: string): boolean => /^[A-Za-z_]\w*$/.test(name) && !keywords.has(name);
const name = z.string().refine(pythonName), path = z.string().refine(value => literal(value) && !value.includes('\\'));
export const pythonOptions = z.strictObject({ module: z.string().refine(value => value.split('.').every(pythonName)),
  directory: path.default('src'), configFile: path.optional(), adoptExisting: z.boolean().default(false),
  names: z.array(z.strictObject({ id: specId, name })).default([]),
  imports: z.array(z.strictObject({ module: z.string().min(1), declaration: z.array(z.string().min(1)).min(1),
    moduleName: z.string().refine(value => value.split('.').every(pythonName)), name })).default([]),
});
export type PythonOptions = z.infer<typeof pythonOptions>;
const roots = new Set(['concept', 'component', 'class', 'interface', 'record-type-declaration', 'alias-type-declaration', 'opaque-type-declaration', 'function']);
const unwrap = (item: Item): Item => item.kind === 'local' ? item.declaration : item;
const indent = (text: string): string => text.split('\n').map(line => '    ' + line).join('\n');

/** Checked type facts become ordinary Python declarations; native mechanics stay below this layer. */
export class PythonDeclarations {
  readonly problems: Diagnostic[] = [];
  readonly artifacts: ArtifactAssociation[] = [];
  readonly path: string;
  private readonly inspection;
  private readonly catalog;
  private readonly types;
  private readonly declarations: Item[];
  private readonly names = new Map<NodeId, string>();
  private readonly imports = new Set<string>();
  private readonly used = new Map<string, NodeId>();
  private readonly variables = new Map<NodeId, string>();
  private readonly library = new Map<NodeId, PythonOptions['imports'][number]>();
  private readonly hidden = new Set<NodeId>();
  constructor(private readonly current: IdentifiedSpecification, private readonly options: PythonOptions, context?: OutputContext) {
    this.inspection = current.specification.inspection; this.catalog = current.specification.types;
    this.types = new PythonTypes(this.catalog, item => item.kind === 'type-parameter' ? this.name(item) : this.reference(item.id),
      (code, item, message) => this.problem(code, item, message));
    this.path = options.directory + '/' + options.module.replaceAll('.', '/') + '.py';
    const modules = new Set([current.specification.entry, ...context?.workspaceModules ?? []]);
    this.declarations = [...this.inspection.roots()].filter(item => roots.has(item.kind) && item.origin.kind === 'source' && modules.has(item.origin.module));
    for (const item of this.declarations) if ('members' in item) {
      const visible = new Set(item.members.flatMap(member => member.kind === 'public' ? member.references.flatMap(reference => reference.resolution.status === 'bound' ? [reference.resolution.target] : []) : []));
      for (const member of item.members) if (member.kind === 'capability' && !visible.has(member.id)) this.hidden.add(member.id);
    }
    for (const mapping of options.names) {
      const record = current.baseline.elements.find(record => record.id === mapping.id);
      if (!record) { this.problem('invalid-native-mapping', undefined, 'Unknown declaration: ' + mapping.id); continue; }
      const node = current.node(record.id);
      if (this.names.has(node)) this.problem('invalid-native-mapping', this.inspection.read(node), 'Duplicate name mapping.');
      this.names.set(node, mapping.name);
    }
    for (const mapping of options.imports) {
      const found = current.baseline.elements.filter(record => record.address.module === mapping.module && this.address(record.id).join('.') === mapping.declaration.join('.'));
      if (found.length !== 1) { this.problem('invalid-native-mapping', undefined, 'An import must select one declaration.'); continue; }
      const node = current.node(found[0]!.id);
      if (this.library.has(node)) this.problem('invalid-native-mapping', this.inspection.read(node), 'Duplicate import mapping.');
      this.library.set(node, mapping); this.names.set(node, mapping.name);
    }
  }
  private address(id: string): string[] { const record = this.current.baseline.elements.find(record => record.id === id)!;
    return [...record.address.owner ? this.address(record.address.owner) : [], record.address.name ?? record.address.kind]; }
  private problem(code: string, item: Item | undefined, message: string): void { this.problems.push({ code, message, at: item?.origin ?? { kind: 'dependency', path: ['outputs', 'python', 'options'] }, related: [] }); }
  private known<T>(fact: TypeFact<T>): T { if (fact.status !== 'known') throw new TypeError('Python generation requires checked type facts.'); return fact.value; }
  private name(item: Item): string {
    const declared = 'name' in item ? item.name : item.kind;
    const value = this.variables.get(item.id) ?? this.names.get(item.id) ?? (this.hidden.has(item.id) && !declared.startsWith('_') ? '_' + declared : declared);
    if (!pythonName(value)) this.problem('invalid-native-name', item, 'Provide an explicit Python name for ' + value + '.'); return value;
  }
  private required(name: string): string { this.imports.add(name); return name; }
  private reference(id: NodeId): string {
    const item = this.inspection.read(id), mapping = this.library.get(id);
    if (mapping) return mapping.name;
    if (!this.declarations.some(node => node.id === id) && item.kind !== 'type-parameter') this.problem('missing-native-mapping', item, 'Provide a native import for ' + this.name(item) + '.');
    return this.name(item);
  }
  private type(id: TypeId): string {
    const text = this.types.text(id); for (const name of this.types.imports) this.imports.add(name); return text;
  }
  private associate(item: Item, declaration: { kind: string; name: string }[]): void {
    this.artifacts.push({ specId: this.current.id(item.id), locator: { outputId: 'python', format: 'python-symbol-1', value: { file: this.path, declaration } } });
  }
  private parameters(items: readonly Item<'parameter'>[], owner: { kind: string; name: string }[]): string[] {
    return items.map(item => { this.associate(item, [...owner, { kind: 'parameter', name: this.name(item) }]);
      return this.name(item) + ': ' + this.type(this.known(this.catalog.typeOf(item.declaredType.id))) + (item.hasDefault ? ' | Absent = Absent.value' : ''); });
  }
  private callable(item: Item<'capability' | 'function'>, owner?: Item, signature = false): string {
    const name = this.name(item), path = [...owner ? [{ kind: 'class', name: this.name(owner) }] : [], { kind: owner ? 'method' : 'function', name }];
    this.associate(item, path);
    const facts = this.catalog.callable(item.id), result = this.known(facts.result);
    const parameters = [...owner ? ['self'] : [], ...this.parameters(item.parameters, path)], type = result.kind === 'value' ? this.type(result.type) : result.kind === 'none' ? 'None' : 'object';
    return 'def ' + name + '(' + parameters.join(', ') + ') -> ' + type + ':\n' + indent(signature ? '...' : 'raise NotImplementedError(' + JSON.stringify('Not implemented: ' + (owner ? this.name(owner) + '.' : '') + name) + ')');
  }
  private declare(item: Item): string {
    const name = this.name(item);
    if (item.kind === 'function') return this.callable(item);
    if (item.kind === 'opaque-type-declaration') {
      if (!this.library.has(item.id)) this.problem('missing-native-mapping', item, 'Provide a native import for ' + name + '.'); return '';
    }
    if (item.kind === 'alias-type-declaration') {
      this.associate(item, [{ kind: 'type', name }]);
      return name + ': ' + this.required('TypeAlias') + ' = ' + this.type(this.known(this.catalog.typeOf(item.targetType.id)));
    }
    const body: string[] = [], bases: string[] = [], path = [{ kind: 'class', name }];
    this.associate(item, path);
    if (item.kind === 'record-type-declaration') {
      bases.push(this.required('TypedDict'));
      if (item.typeParameters.length) bases.push(this.required('Generic') + '[' + item.typeParameters.map(value => this.name(value)).join(', ') + ']');
      for (const wrapped of item.fields) {
        const field = unwrap(wrapped); if (field.kind !== 'field') continue;
        const declared = this.known(this.catalog.typeOf(field.declaredType.id));
        let type = this.catalog.describe(declared);
        while (type.kind === 'alias' && type.target.status === 'known') type = this.catalog.describe(type.target.value);
        this.associate(field, [...path, { kind: 'field', name: this.name(field) }]);
        body.push(this.name(field) + ': ' + (type.kind === 'optional' ? this.required('NotRequired') + '[' + this.type(type.inner) + ']' : this.type(declared)));
      }
    } else if (item.kind === 'concept' || item.kind === 'component' || item.kind === 'class' || item.kind === 'interface') {
      if (item.kind === 'interface') bases.push(this.required('Protocol'));
      for (const wrapped of item.members) {
        const member = unwrap(wrapped);
        if (member.kind === 'capability' || member.kind === 'function') body.push(this.callable(member, item, item.kind === 'interface'));
        else if (member.kind === 'field') { this.associate(member, [...path, { kind: 'field', name: this.name(member) }]); body.push(this.name(member) + ': ' + this.type(this.known(this.catalog.typeOf(member.declaredType.id)))); }
        else if (member.kind === 'construction') { this.associate(member, [...path, { kind: 'method', name: '__init__' }]); body.push('def __init__(' + ['self', ...this.parameters(member.parameters, path)].join(', ') + ') -> None:\n    raise NotImplementedError(' + JSON.stringify('Not implemented: ' + name + ' construction') + ')'); }
      }
    }
    const declaration = 'class ' + name + (bases.length ? '(' + bases.join(', ') + ')' : '') + ':\n' + indent(body.join('\n\n') || 'pass');
    if (item.kind !== 'record-type-declaration' || !item.error) return declaration;
    const companion = name + 'Exception'; this.associate(item, [{ kind: 'class', name: companion }]);
    return declaration + '\n\nclass ' + companion + '(Exception):\n' + indent('def __init__(self, details: object) -> None:\n' + indent('self.details = details\nsuper().__init__(' + JSON.stringify(name) + ')'));
  }
  render(): { path: string; text: string; artifacts: readonly ArtifactAssociation[] } {
    const variables: string[] = [];
    for (const item of this.declarations) {
      const name = this.name(item), earlier = this.used.get(name);
      if (earlier && earlier !== item.id || name === 'Absent') this.problem('native-name-conflict', item, 'Duplicate or reserved Python name: ' + name);
      this.used.set(name, item.id);
      if ('typeParameters' in item) for (const parameter of item.typeParameters) {
        const variable = '_' + name + '_' + this.name(parameter); this.variables.set(parameter.id, variable);
        variables.push(variable + ' = ' + this.required('TypeVar') + '(' + JSON.stringify(variable) + ')');
      }
    }
    for (const item of this.declarations) if (item.kind === 'record-type-declaration' && item.error) {
      const companion = this.name(item) + 'Exception';
      if (this.used.has(companion)) this.problem('native-name-conflict', item, 'The generated exception name is already declared: ' + companion);
      this.used.set(companion, item.id);
    }
    const declarations = this.declarations.filter(item => item.kind !== 'alias-type-declaration').map(item => this.declare(item));
    const done = new Set<NodeId>();
    const alias = (item: Item<'alias-type-declaration'>): void => {
      if (done.has(item.id)) return; done.add(item.id);
      const dependencies = (node: Item): void => { if (node.kind === 'reference' && node.resolution.status === 'bound') {
        const target = this.inspection.read(node.resolution.target); if (target.kind === 'alias-type-declaration' && this.declarations.includes(target)) alias(target);
      } else for (const child of this.inspection.children(node.id)) dependencies(child); };
      dependencies(item.targetType); declarations.push(this.declare(item));
    };
    this.declarations.filter(item => item.kind === 'alias-type-declaration').forEach(alias);
    const imports = [...this.library.values()].map(value => 'from ' + value.moduleName + ' import ' + value.name);
    const text = ['from __future__ import annotations', this.imports.size ? 'from typing import ' + [...this.imports].sort().join(', ') : '', ...imports,
      'from enum import Enum\n\nclass Absent(Enum):\n    value = "absent"', ...variables, ...declarations,
      '__all__ = ' + JSON.stringify(['Absent', ...this.declarations.filter(item => item.kind !== 'opaque-type-declaration').flatMap(item => [this.name(item), ...item.kind === 'record-type-declaration' && item.error ? [this.name(item) + 'Exception'] : []])]), ''].filter(value => value !== '').join('\n\n') + '\n';
    return { path: this.path, text, artifacts: this.artifacts };
  }
}
