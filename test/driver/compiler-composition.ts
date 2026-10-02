import {
  Compiler, ExternalModel, LangiumModel, LangiumReader, isNodeId,
  type Compilation, type ExternalDefinition, type Item, type ModuleModel, type NodeId, type NodeKind,
  type PackagePhase, type ProblemLocation, type SourceDocument, type SourceRange, type Specification, type TypeFact, type TypeId,
} from '../../src/index.js';

export interface SourceOptions { readonly locator?: string; readonly sourceId?: string }
export interface LocationSelection { readonly sourceId?: string; readonly line?: number; readonly within?: string }
const namedKinds = ['concept', 'component', 'class', 'interface', 'record-type-declaration', 'alias-type-declaration',
  'opaque-type-declaration', 'builtin-type', 'function', 'capability', 'setup', 'action', 'observation', 'check', 'field', 'parameter'] as const;
const rootKinds = ['concept', 'component', 'class', 'interface', 'record-type-declaration', 'alias-type-declaration',
  'opaque-type-declaration', 'function', 'examples', 'interaction', 'use', 'include', 'extend', 'examples-attachment'] as const;

export class CompilationDriver {
  private readonly compiler = new Compiler();
  private entry = { locator: 'entry.expec', source: { sourceId: 'entry.expec', text: '' } };
  private readonly sources = new Map<string, SourceDocument>();
  private readonly modules = new Map<string, ModuleModel>();
  private readonly packages = new Map<string, readonly PackagePhase[]>();
  private readonly identities = new Map<object, number>();
  private readonly remembered = new Map<string, { result: Compilation; snapshot: string }>();
  private result!: Compilation;

  source(text: string, options: SourceOptions = {}): void {
    const source = { sourceId: options.sourceId ?? 'entry.expec', text };
    this.sources.set(source.sourceId, source);
    this.entry = { locator: options.locator ?? source.sourceId, source };
  }
  module(locator: string, text: string, options: SourceOptions = {}): void {
    const source = { sourceId: options.sourceId ?? `${locator}.expec`, text };
    const read = new LangiumReader().read(source);
    if (read.status !== 'accepted') throw new Error('Dependency source must be grammatical: ' + JSON.stringify(read.diagnostics));
    this.sources.set(source.sourceId, source);
    this.modules.set(locator, new LangiumModel(locator, read.document));
  }
  externalModule(locator: string, definitions: readonly ExternalDefinition[]): void { this.modules.set(locator, new ExternalModel(locator, definitions)); }
  removeModule(locator: string): void { this.modules.delete(locator); }
  package(alias: string, phases: readonly PackagePhase[]): void { this.packages.set(alias, phases); }
  compile(): void {
    this.result = this.compiler.compile({ ...this.entry, dependencies: {
      modules: [...this.modules.values()], packages: [...this.packages].map(([alias, phases]) => ({ alias, phases })),
    } });
  }
  findings(): Compilation { return this.result; }
  specification(result = this.result): Specification {
    if (!result.value) throw new Error('Expected a checked specification');
    return result.value;
  }
  query<K extends NodeKind>(kind: K, specification = this.specification()): Item<K>[] { return [...specification.inspection.query(kind)]; }
  named(name: string, specification = this.specification()): Item {
    return one(namedKinds.flatMap(kind => this.query(kind, specification)).filter(item => this.name(item, specification) === name), name);
  }
  name(item: Item, specification = this.specification()): string {
    const parts: string[] = [];
    for (let node: Item | undefined = item; node; node = specification.inspection.parent(node.id)) {
      if ('name' in node && typeof node.name === 'string') parts.unshift(node.name);
      else if (node.kind === 'construction') parts.unshift('construction');
    }
    return parts.join('.');
  }
  callable(name: string, specification = this.specification()) { return specification.types.callable(this.named(name, specification).id); }
  typeName(type: TypeId, specification = this.specification()): string {
    const shape = specification.types.describe(type);
    if ('declaration' in shape) {
      const name = this.name(specification.inspection.read(shape.declaration), specification);
      return 'arguments' in shape && shape.arguments.length ? `${name}<${shape.arguments.map(id => this.typeName(id, specification)).join(', ')}>` : name;
    }
    if (shape.kind === 'optional') return this.typeName(shape.inner, specification) + '?';
    if (shape.kind === 'tuple') return '[' + shape.elements.map(id => this.typeName(id, specification)).join(', ') + ']';
    if (shape.kind === 'union') return shape.alternatives.map(id => this.typeName(id, specification)).join(' | ');
    return this.textAt(specification.inspection.read(shape.expression).origin);
  }
  signature(name: string, specification = this.specification()) {
    const signature = this.callable(name, specification), result = known(signature.result);
    return { parameters: signature.parameters.map(parameter => {
      const declaration = specification.inspection.read(parameter.declaration, 'parameter');
      return `${declaration.name}: ${this.typeName(known(parameter.type), specification)}`;
    }), result: result.kind === 'value' ? this.typeName(result.type, specification) : result.kind === 'none' ? 'Nothing' : 'unspecified' };
  }
  slotType(name: string, specification = this.specification()): TypeId {
    const declaration = this.named(name, specification);
    if (declaration.kind !== 'parameter' && declaration.kind !== 'field') throw new Error('Expected a typed slot');
    return known(specification.types.typeOf(declaration.declaredType.id));
  }
  namedType(name: string, specification = this.specification()): TypeId { return specification.types.declaredType(this.named(name, specification).id); }
  field(owner: string, name: string, specification = this.specification()) {
    const shape = known(specification.types.fields(this.namedType(owner, specification)));
    if (shape.kind !== 'available') throw new Error('Expected available fields');
    const field = one(shape.fields.filter(slot => specification.inspection.read(slot.declaration, 'field').name === name), name);
    return { id: field.declaration, type: known(field.type), name: this.typeName(known(field.type), specification) };
  }
  publicCapabilities(owner: string): NodeId[] {
    const declaration = this.named(owner);
    if (!('members' in declaration)) throw new Error('Expected a concept-like owner');
    return declaration.members.filter(member => member.kind === 'public').flatMap(member => member.references.map(reference => bound(reference)));
  }
  body(name: string) {
    const declaration = this.named(name);
    if (!('body' in declaration)) throw new Error('Expected a callable');
    return declaration.body;
  }
  contract(name: string) {
    const body = this.body(name);
    if (body.kind !== 'available' || body.content.kind !== 'contract-body') throw new Error('Expected a contract body');
    return body.content.members;
  }
  owned(kind: 'types' | 'functions'): string[] {
    const specification = this.specification();
    const ids = kind === 'types' ? specification.types.typeDeclarations() : specification.types.callableDeclarations();
    return [...ids].map(id => specification.inspection.read(id)).filter(item => item.origin.kind === 'source'
      && item.origin.module === specification.entry && (kind !== 'functions' || item.kind === 'function')).map(item => this.name(item));
  }
  relationships() {
    const result: { owner: string; target: NodeId; role: string; origin: ProblemLocation; typePath: number[] }[] = [];
    const types = (owner: string, node: Item, role: string, path: number[] = []): void => {
      if (node.kind === 'named-type') {
        result.push({ owner, target: bound(node.reference), role, origin: node.reference.origin, typePath: path });
        node.arguments.forEach((argument, index) => types(owner, argument, role, [...path, index]));
      } else if (node.kind === 'optional-type' || node.kind === 'grouped-type') types(owner, node.inner, role, path);
      else if (node.kind === 'tuple-type') node.elements.forEach((element, index) => types(owner, element, role, [...path, index]));
      else if (node.kind === 'union-type') node.alternatives.forEach((element, index) => types(owner, element, role, [...path, index]));
    };
    for (const dependency of this.query('depends-on')) {
      const owner = this.specification().inspection.parent(dependency.id);
      if (!owner) throw new Error('Expected a dependency owner');
      for (const reference of dependency.references) result.push({ owner: this.name(owner), target: bound(reference), role: 'dependency', origin: reference.origin, typePath: [] });
    }
    for (const field of this.query('field')) types(this.name(field), field.declaredType, 'field-type');
    for (const parameter of this.query('parameter')) {
      const owner = this.specification().inspection.parent(parameter.id);
      if (!owner) throw new Error('Expected a parameter owner');
      types(this.name(owner), parameter.declaredType, 'input');
    }
    for (const id of this.specification().types.callableDeclarations()) {
      const callable = this.specification().inspection.read(id);
      if ('returnType' in callable && callable.returnType) types(this.name(callable), callable.returnType, 'output');
    }
    return result;
  }
  titled<K extends 'scenario' | 'example' | 'interaction'>(kind: K, title: string): Item<K> {
    return one(this.query(kind).filter(item => item.title.value === title), title);
  }
  message(title: string, number: number) {
    const interaction = this.titled('interaction', title);
    const node = interaction.members.filter(item => item.kind === 'message')[number - 1];
    if (!node) throw new Error(`Expected message ${number} in ${title}`);
    return this.specification().message(node.id);
  }
  participant(title: string, name: string): NodeId {
    return one(this.titled('interaction', title).members.filter(item => item.kind === 'participant' && item.name === name), name).id;
  }
  resultOrigin(name: string) {
    const result = known(this.callable(name).result);
    if (result.kind !== 'value') throw new Error('Expected a value result');
    const type = this.specification().types.describe(result.type);
    if (!('declaration' in type)) throw new Error('Expected a declaration-backed result');
    return this.specification().inspection.read(type.declaration).origin;
  }
  textAt(location: ProblemLocation): string {
    if (location.kind !== 'source') throw new Error('Expected authored source');
    const source = this.sources.get(location.range.sourceId);
    if (!source) throw new Error('Unknown source ' + location.range.sourceId);
    return Array.from(source.text).slice(location.range.start.offset, location.range.end.offset).join('');
  }
  span(location: ProblemLocation | SourceRange) {
    const range = 'kind' in location ? location.kind === 'source' ? location.range : undefined : location;
    return range && { sourceId: range.sourceId, start: range.start.offset, end: range.end.offset };
  }
  expectedSpan(text: string, { sourceId = this.entry.source.sourceId, line, within }: LocationSelection = {}) {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error('Unknown source ' + sourceId);
    const context = within ?? source.text, outer = within ? source.text.indexOf(within) : 0;
    if (outer < 0 || within && outer !== source.text.lastIndexOf(within)) throw new Error('Expected one source context');
    const offsets: number[] = [];
    for (let offset = context.indexOf(text); offset >= 0; offset = context.indexOf(text, offset + 1)) {
      if (line === undefined || source.text.slice(0, outer + offset).split('\n').length === line) offsets.push(outer + offset);
    }
    const offset = one(offsets, `source span ${JSON.stringify(text)} at ${sourceId}:${line ?? '*'}`);
    const start = Array.from(source.text.slice(0, offset)).length;
    return { sourceId, start, end: start + Array.from(text).length };
  }
  rememberResult(label: string): void { this.remembered.set(label, { result: this.result, snapshot: this.snapshot(this.result) }); }
  rememberedResult(label: string) {
    const result = this.remembered.get(label);
    if (!result) throw new Error('No remembered compilation ' + label);
    return result;
  }
  consumerObservations(reverse = false) {
    const consumers = {
      contracts: () => [...this.specification().types.callableDeclarations()].map(id => this.specification().types.callable(id)),
      relationships: () => this.relationships(),
    };
    const names = Object.keys(consumers) as (keyof typeof consumers)[];
    return Object.fromEntries((reverse ? names.reverse() : names).map(name => [name, this.capture(consumers[name]())]));
  }
  snapshot(result = this.result): string {
    const specification = this.specification(result);
    return JSON.stringify(this.capture({ entry: specification.entry, syntax: result.syntax, problems: result.problems, deferred: result.deferred,
      items: rootKinds.flatMap(kind => this.query(kind, specification)),
      signatures: [...specification.types.callableDeclarations()].map(id => specification.types.callable(id)),
      types: [...specification.types.typeDeclarations()].map(id => {
        const type = specification.types.declaredType(id), node = specification.inspection.read(id);
        return { id, type, description: specification.types.describe(type),
          ...(node.kind === 'record-type-declaration' ? { fields: specification.types.fields(type) } : {}) };
      }),
      messages: this.query('message', specification).map(message => specification.message(message.id)),
    }));
  }
  private capture(value: unknown): unknown {
    if (typeof value !== 'object' || value === null) return value;
    if (isNodeId(value) || !Array.isArray(value) && Object.isFrozen(value) && Object.keys(value).length === 0) {
      if (!this.identities.has(value)) this.identities.set(value, this.identities.size);
      return { identity: this.identities.get(value) };
    }
    return Array.isArray(value) ? value.map(item => this.capture(item))
      : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.capture(item)]));
  }
}

function one<T>(items: readonly T[], description: string): T {
  if (items.length !== 1) throw new Error(`Expected one ${description}; found ${items.length}`);
  return items[0]!;
}
function known<T>(fact: TypeFact<T>): T {
  if (fact.status !== 'known') throw new Error('Expected a known type fact: ' + JSON.stringify(fact));
  return fact.value;
}
function bound(reference: Item<'reference'>): NodeId {
  if (reference.resolution.status !== 'bound') throw new Error('Expected a resolved declaration reference');
  return reference.resolution.target;
}
