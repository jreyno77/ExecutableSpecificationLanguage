import {
  LangiumReader, LangiumModel, ExternalModel, QueryInspection, Resolver,
  type Inspection, type Model, type ModuleModel, type Item, type NodeKind, type NodeId, type Origin,
  type ExternalDefinition, type ResolutionDependencies, type Resolution,
} from '../../src/index.js';

export type Target = { name: string; kind: NodeKind; origin: Origin };

function fieldDeclaration(item: Item<'field' | 'local'>): Item<'field'> {
  const field = item.kind === 'local' ? item.declaration : item;
  if (field.kind !== 'field') throw new Error('Expected a record field declaration');
  return field;
}

/** Calls real model, inspection, and resolution APIs for declaration examples. */
export class ResolutionDriver {
  private readonly resolver = new Resolver();
  private entry!: ModuleModel;
  private dependencies: ResolutionDependencies = { modules: [], packages: [] };
  private report: Resolution | undefined;
  private readonly inspections = new Map<Model, Inspection>();
  private readonly originals = new Map<ModuleModel, readonly Item<'reference'>[]>();
  private remembered: { inspection: Inspection; reference: NodeId; target: NodeId } | undefined;

  get entryLocator(): string { return this.entry.locator; }
  get result(): Resolution {
    if (!this.report) throw new Error('Resolve declarations before observing them');
    return this.report;
  }
  get inspection(): Inspection { return this.inspect(this.result.model); }
  entryIs(locator: string, sourceId: string, text: string): void {
    this.entry = this.read(locator, sourceId, text);
    this.report = undefined;
  }
  sourceModuleIs(locator: string, text: string, sourceId: string): void {
    this.addModule(this.read(locator, sourceId, text));
  }
  externalModuleIs(locator: string, definitions: readonly ExternalDefinition[]): void {
    this.addModule(new ExternalModel(locator, definitions));
  }
  externalEntryIs(locator: string, definitions: readonly ExternalDefinition[]): void {
    this.entry = new ExternalModel(locator, definitions);
    this.rememberInput(this.entry);
    this.report = undefined;
  }
  dependenciesAre(dependencies: ResolutionDependencies): void {
    this.dependencies = dependencies;
    for (const module of dependencies.modules) this.rememberInput(module);
    this.report = undefined;
  }
  removeModules(): void { this.dependencies = { ...this.dependencies, modules: [] }; }
  resolveDeclarations(): void { this.report = this.resolver.resolve(this.entry, this.dependencies); }
  replaceExternalModule(locator: string, definitions: readonly ExternalDefinition[]): void {
    this.dependencies = { ...this.dependencies, modules: this.dependencies.modules.filter(module => module.locator !== locator) };
    this.externalModuleIs(locator, definitions);
  }
  declarations<K extends NodeKind>(kind: K, module?: string): readonly Item<K>[] {
    return [...this.inspection.query(kind)].filter(node => module === undefined || this.inModule(node, module));
  }
  declaration<K extends NodeKind>(module: string, kind: K, name: string, resolved = true): Item<K> {
    const view = resolved ? this.inspection : this.inspect(this.module(module));
    const found = [...view.query(kind)].find(node => this.inModule(node, module) && 'name' in node && node.name === name);
    if (!found) throw new Error(`Expected ${kind} ${module}.${name}`);
    return found;
  }
  readItem(id: NodeId, kind?: NodeKind): Item {
    return kind === undefined ? this.inspection.read(id) : this.inspection.read(id, kind);
  }
  entryRoots(): readonly Item[] { return this.entry.roots().map(id => this.inspection.read(id)); }
  reference(module: string, segments: readonly string[], occurrence = 0): Item<'reference'> {
    const reference = this.declarations('reference', module).filter(node => this.samePath(node.segments, segments))[occurrence];
    if (!reference) throw new Error('The example has no reference occurrence: ' + JSON.stringify({ module, segments, occurrence }));
    return reference;
  }
  references(module: string, segments?: readonly string[]): readonly Item<'reference'>[] {
    return this.declarations('reference', module).filter(node => !segments || this.samePath(node.segments, segments));
  }
  target(reference: Item<'reference'>, view = this.inspection): Item {
    const outcome = reference.resolution;
    if (outcome.status !== 'bound') throw new Error('Expected a bound declaration, got ' + outcome.status);
    return view.read(outcome.target);
  }
  describeTarget(node: Item): Target {
    if (!('name' in node) || typeof node.name !== 'string') throw new Error('A declaration target must have a name');
    return { name: node.name, kind: node.kind, origin: node.origin };
  }
  parameter(module: string, callable: string, parameter: string, resolved = true): Item<'parameter'> {
    const found = this.declaration(module, 'function', callable, resolved).parameters.find(node => node.name === parameter);
    if (!found) throw new Error(`Expected parameter ${module}.${callable}.${parameter}`);
    return found;
  }
  field(module: string, record: string, field: string): Item<'field'> {
    const found = this.declaration(module, 'record-type-declaration', record).fields.map(fieldDeclaration).find(node => node.name === field);
    if (!found) throw new Error(`Expected field ${module}.${record}.${field}`);
    return found;
  }
  namedType(type: Item): Item<'named-type'> {
    if (type.kind !== 'named-type') throw new Error('Expected an authored named type');
    return type;
  }
  recordFields(module: string, name: string, resolved: boolean): Record<string, string> {
    return Object.fromEntries(this.declaration(module, 'record-type-declaration', name, resolved).fields.map(fieldDeclaration)
      .map(field => [field.name, this.typeText(field.declaredType)]));
  }
  functionDetails(module: string, name: string, resolved: boolean) {
    const callable = this.declaration(module, 'function', name, resolved);
    return { parameters: Object.fromEntries(callable.parameters.map(parameter => [parameter.name, this.typeText(parameter.declaredType)])),
      result: callable.returnType ? this.typeText(callable.returnType) : undefined, body: callable.body.kind };
  }
  inputReferences(module: string): readonly Item<'reference'>[] { return [...this.inspect(this.module(module)).query('reference')]; }
  inputSnapshots() {
    return [...this.originals].map(([model, before]) => ({ before, after: [...this.inspect(model).query('reference')] }));
  }
  declarationsReplay() {
    const records = this.inspection.query('record-type-declaration');
    return { first: records[Symbol.iterator]().next(), second: records[Symbol.iterator]().next(), before: [...records], after: [...records] };
  }
  iteratorDuringResolution(module: string) {
    const nodes = this.inspect(this.module(module)).query('reference');
    const before = [...nodes], cursor = nodes[Symbol.iterator](), first = cursor.next();
    this.resolveDeclarations();
    return { before, first, remaining: Array.from({ [Symbol.iterator]: () => cursor }), replay: [...nodes] };
  }
  inputDeclaration(module: string, kind: NodeKind, name: string): Item {
    return this.declaration(module, kind, name, false);
  }
  inputDeclarationReads(module: string, name: string) {
    const view = this.inspect(this.module(module));
    const node = this.declaration(module, 'record-type-declaration', name, false);
    return { node, again: view.read(node.id) };
  }
  checkedReads() {
    const record = [...this.inspect(this.entry).query('record-type-declaration')][0]!;
    const foreign = this.read('foreign', 'foreign.expec', 'type Elsewhere {}');
    return { wrongKind: () => this.inspection.read(record.id, 'reference'),
      foreign: () => this.inspection.read(foreign.roots()[0]!), missing: () => this.inspection.read({} as NodeId) };
  }
  rejectExternal(locator: string, definitions: unknown): unknown {
    try { new ExternalModel(locator, definitions as readonly ExternalDefinition[]); }
    catch (error) { return error; }
    return undefined;
  }
  rememberBinding(module: string, written: readonly string[], occurrence: number): void {
    const reference = this.reference(module, written, occurrence);
    this.remembered = { inspection: this.inspection, reference: reference.id, target: this.target(reference).id };
  }
  rememberedBinding() {
    if (!this.remembered) throw new Error('Remember a resolved reference first');
    const { inspection, reference, target } = this.remembered;
    return { reference: inspection.read(reference, 'reference'), target: inspection.read(target), expectedId: target };
  }
  facts(): unknown {
    return { references: this.declarations('reference').map(node => ({ origin: node.origin, written: node.segments,
      resolution: node.resolution.status === 'bound' ? { status: 'bound', target: this.describeTarget(this.target(node)) } : node.resolution })),
      problems: this.result.problems };
  }
  private typeText(type: Item): string {
    switch (type.kind) {
      case 'named-type': return type.reference.segments.join('.')
        + (type.arguments.length ? '<' + type.arguments.map(type => this.typeText(type)).join(', ') + '>' : '');
      case 'tuple-type': return '[' + type.elements.map(type => this.typeText(type)).join(', ') + ']';
      case 'optional-type': return this.typeText(type.inner) + '?';
      case 'union-type': return type.alternatives.map(type => this.typeText(type)).join(' | ');
      case 'grouped-type': return '(' + this.typeText(type.inner) + ')';
      default: throw new Error('This observation expects a named, tuple, optional, union or grouped type');
    }
  }
  private inspect(model: Model): Inspection {
    let view = this.inspections.get(model);
    if (!view) { view = new QueryInspection(model); this.inspections.set(model, view); }
    return view;
  }
  private module(locator: string): ModuleModel {
    const module = [this.entry, ...this.dependencies.modules].find(module => module.locator === locator);
    if (!module) throw new Error('No supplied module ' + locator);
    return module;
  }
  private read(locator: string, sourceId: string, text: string): ModuleModel {
    const result = new LangiumReader().read({ sourceId, text });
    if (result.status !== 'accepted') throw new Error('Acceptance source must be grammatical: ' + JSON.stringify(result.diagnostics));
    const model = new LangiumModel(locator, result.document);
    this.rememberInput(model);
    return model;
  }
  private rememberInput(model: ModuleModel): void { this.originals.set(model, [...this.inspect(model).query('reference')]); }
  private addModule(module: ModuleModel): void {
    this.dependencies = { ...this.dependencies, modules: [...this.dependencies.modules, module] };
    this.rememberInput(module);
    this.report = undefined;
  }
  private inModule(node: Item, module: string): boolean { return node.origin.kind !== 'builtin' && node.origin.module === module; }
  private samePath(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((part, index) => part === right[index]);
  }
}
