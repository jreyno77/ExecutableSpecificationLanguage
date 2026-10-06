import {
  LangiumReader, LangiumModel, ExternalModel, Resolver, TypeDescriber,
  type ExternalDefinition, type ModuleModel, type NodeId, type ProblemLocation,
  type Resolution, type TypeCatalog, type TypeId, type TypeFact, type TypedSlot,
} from '../../../src/index.js';

/** Reads and projects actual results from the public type-analysis API. */
export class TypeDescriptionsDriver {
  private entry!: ModuleModel;
  private readonly modules: ModuleModel[] = [];
  private readonly texts = new Map<string, string>();
  private resolution!: Resolution;
  private catalog!: TypeCatalog;
  private selected!: TypeId;
  private originalReferences = '';

  source(text: string, locator = 'types.expec'): void { this.entry = this.read(text, locator); }
  module(locator: string, text: string): void { this.modules.push(this.read(text, locator)); }
  external(definitions: readonly ExternalDefinition[]): void { this.entry = new ExternalModel('external', definitions); }
  externalModule(locator: string, definitions: readonly ExternalDefinition[]): void {
    this.modules.push(new ExternalModel(locator, definitions));
  }
  analyze(): void {
    this.resolution = new Resolver().resolve(this.entry, { modules: this.modules, packages: [] });
    this.originalReferences = JSON.stringify(this.referenceFacts());
    this.catalog = new TypeDescriber().describe(this.resolution);
  }
  describe(name: string): void {
    if (!this.catalog) this.analyze();
    this.selected = this.catalog.declaredType(this.declaration(name));
  }
  followField(name: string): void { this.selected = known(this.field(name).type); }
  followArgument(index: number): void {
    const type = this.catalog.describe(this.meaning(this.selected));
    if (!('arguments' in type)) throw new Error('Expected an applied type');
    this.selected = type.arguments[index]!;
  }

  selectedLabel(): string { return this.label(this.selected); }
  tupleElements() {
    const type = this.catalog.describe(this.meaning(this.selected));
    if (type.kind !== 'tuple') throw new Error('Expected a tuple');
    return { kind: type.kind, elements: type.elements.map(id => this.label(id)) };
  }
  openParameters(first: string, second: string) {
    const one = this.catalog.describe(this.meaning(this.catalog.declaredType(this.declaration(first))));
    const two = this.catalog.describe(this.catalog.declaredType(this.declaration(second)));
    if (one.kind !== 'tuple' || !('arguments' in two)) throw new Error('Expected an open pair and box');
    const parameter = this.catalog.describe(one.elements[0]!);
    const other = this.catalog.describe(two.arguments[0]!);
    if (parameter.kind !== 'parameter' || other.kind !== 'parameter') throw new Error('Expected parameters');
    return { elements: one.elements, parameter, other, node: this.catalog.inspection.read(parameter.declaration, 'type-parameter') };
  }
  declared(name: string) {
    const declaration = this.declaration(name);
    return { declaration, type: this.catalog.declaredType(declaration) };
  }
  alias() {
    const alias = this.catalog.describe(this.selected);
    if (alias.kind !== 'alias') throw new Error('Expected an alias');
    return alias;
  }
  selectedDeclaration(): NodeId | false {
    const type = this.catalog.describe(this.meaning(this.selected));
    return 'declaration' in type && type.declaration;
  }
  fields() {
    const fact = this.catalog.fields(this.selected);
    if (fact.status !== 'known') return fact;
    return { ...fact, value: fact.value.kind === 'available'
      ? { kind: fact.value.kind, fields: fact.value.fields.map(slot => this.name(slot.declaration)) }
      : fact.value };
  }
  field(name: string): TypedSlot {
    const fields = known(this.catalog.fields(this.selected));
    if (fields.kind !== 'available') throw new Error('Expected readable fields');
    const field = fields.fields.find(slot => this.name(slot.declaration) === name);
    if (!field) throw new Error(`Expected field ${name}`);
    this.catalog.inspection.read(field.declaration, 'field');
    return field;
  }
  parameters(name: string): string[] { return this.catalog.callable(this.declaration(name)).parameters.map(slot => this.slotLabel(slot)); }
  parameter(callable: string, parameter: string): TypedSlot {
    const slot = this.catalog.callable(this.declaration(callable)).parameters.find(slot => this.name(slot.declaration) === parameter);
    if (!slot) throw new Error(`Expected parameter ${parameter}`);
    return slot;
  }
  result(name: string) {
    const fact = this.catalog.callable(this.declaration(name)).result;
    if (fact.status !== 'known') return fact;
    return { ...fact, value: fact.value.kind === 'value' ? { kind: fact.value.kind, type: this.label(fact.value.type) } : fact.value };
  }
  callableProblems(name: string) { return this.catalog.callable(this.declaration(name)).problems; }
  construction(name: string) {
    const fact = this.catalog.construction(this.declaration(name));
    return fact.status === 'known'
      ? { ...fact, value: fact.value && { parameters: fact.value.parameters.map(slot => this.slotLabel(slot)), node: this.catalog.inspection.read(fact.value.declaration, 'construction') } }
      : fact;
  }
  externalDefault(callable: string, parameter: string) {
    return this.catalog.inspection.read(this.parameter(callable, parameter).declaration, 'parameter');
  }
  body(callable: string): string {
    const node = this.catalog.inspection.read(this.declaration(callable));
    if (!('body' in node)) throw new Error('Expected a callable');
    return node.body.kind;
  }
  declarations() {
    return {
      types: [...this.catalog.typeDeclarations()].map(id => this.name(id)),
      callables: [...this.catalog.callableDeclarations()].map(id => this.name(id)),
    };
  }
  findings() {
    return { problems: this.catalog.problems, resolutionProblems: this.resolution.problems, deferred: this.catalog.deferred, resolutionDeferred: this.resolution.deferred };
  }
  afterQueries() {
    const before = JSON.stringify([this.catalog.problems, this.catalog.deferred]);
    const declared = [...this.catalog.typeDeclarations()].map(id => [id, this.catalog.declaredType(id)] as const);
    for (const id of [...this.catalog.callableDeclarations()].reverse()) this.catalog.callable(id);
    return {
      declarations: declared.reverse().map(([id, type]) => ({ before: type, after: this.catalog.declaredType(id) })),
      findings: { before, after: JSON.stringify([this.catalog.problems, this.catalog.deferred]) },
      references: { before: this.originalReferences, after: JSON.stringify(this.referenceFacts()) },
      inspectedDeclarations: [...this.catalog.typeDeclarations(), ...this.catalog.callableDeclarations()].map(id => ({
        original: this.resolution.model.node(id), inspected: this.catalog.inspection.read(id),
      })),
    };
  }
  independentCatalog() {
    const next = new TypeDescriber().describe(this.resolution);
    let error: unknown;
    try { next.describe(this.selected); } catch (caught) { error = caught; }
    const original = this.catalog.describe(this.selected);
    if (!('declaration' in original)) throw new Error('Expected a declared type');
    return {
      error, selected: this.selected, original,
      description: next.describe(next.declaredType(original.declaration)),
      type: next.declaredType(original.declaration),
    };
  }
  literalOrigins(): string[] {
    const type = this.catalog.describe(this.meaning(this.selected));
    if (type.kind !== 'tuple') throw new Error('Expected literal tuple');
    return type.elements.map(id => {
      const literal = this.catalog.describe(id);
      if (literal.kind !== 'literal') throw new Error('Expected literal type');
      return this.textAt(this.catalog.inspection.read(literal.expression, 'literal-type').origin);
    });
  }
  label(id: TypeId): string {
    const type = this.catalog.describe(this.meaning(id));
    switch (type.kind) {
      case 'builtin': case 'declared': return this.name(type.declaration) + (type.arguments.length ? `<${type.arguments.map(id => this.label(id)).join(', ')}>` : '');
      case 'parameter': return this.name(type.declaration);
      case 'tuple': return `[${type.elements.map(id => this.label(id)).join(', ')}]`;
      case 'union': return type.alternatives.map(id => this.label(id)).join(' | ');
      case 'optional': return `${this.label(type.inner)}?`;
      case 'literal': return this.textAt(this.catalog.inspection.read(type.expression).origin);
      default: throw new Error('Expected a described type');
    }
  }
  textAt(location: ProblemLocation): string {
    return location.kind === 'source' ? Array.from(this.texts.get(location.module)!).slice(location.range.start.offset, location.range.end.offset).join('') : JSON.stringify(location);
  }

  private referenceFacts() {
    return this.resolution.model.nodes('reference').map(node => ({ node, resolution: this.resolution.model.resolution(node.id) }));
  }
  private read(text: string, locator: string): ModuleModel {
    const result = new LangiumReader().read({ sourceId: locator, text });
    if (result.status !== 'accepted') throw new Error('Acceptance source must be grammatical: ' + JSON.stringify(result.diagnostics));
    this.texts.set(locator, text);
    return new LangiumModel(locator, result.document);
  }
  private declaration(name: string): NodeId {
    const found = [...this.catalog.typeDeclarations(), ...this.catalog.callableDeclarations()].find(id => this.name(id) === name);
    if (!found) throw new Error(`Expected declaration ${name}`);
    return found;
  }
  private name(id: NodeId): string {
    const node = this.catalog.inspection.read(id);
    if (!('name' in node)) throw new Error('Expected a named declaration');
    return node.name;
  }
  private slotLabel(slot: TypedSlot): string { return `${this.name(slot.declaration)}: ${this.label(known(slot.type))}`; }
  private meaning(id: TypeId): TypeId {
    const visited = new Set<TypeId>();
    for (;;) {
      if (visited.has(id)) throw new Error('A type query returned an unreported alias cycle');
      visited.add(id);
      const type = this.catalog.describe(id);
      if (type.kind !== 'alias') return id;
      id = known(type.target);
    }
  }
}

function known<T>(fact: TypeFact<T>): T {
  if (fact.status !== 'known') throw new Error(`Expected a known fact: ${JSON.stringify(fact)}`);
  return fact.value;
}
