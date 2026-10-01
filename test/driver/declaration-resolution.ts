import {
  AntlrSyntaxReader, DescriptionInspection, ExternalInspection, Resolver,
  type Inspection, type ModuleInspection, type InspectionNode, type InspectionKind,
  type NodeId, type ExternalDefinition, type ResolutionDependencies, type Resolution,
} from '../../src/index.js';

export class DeclarationResolutionDriver {
  private readonly resolver = new Resolver();
  private entry!: ModuleInspection;
  private dependencies: ResolutionDependencies = { modules: [], packages: [] };
  private report: Resolution | undefined;
  private readonly originals = new Map<ModuleInspection, readonly InspectionNode<'reference'>[]>();
  private remembered: { view: Resolution; reference: NodeId; target: NodeId } | undefined;

  get entryLocator(): string { return this.entry.locator; }
  get problems() { return this.resolved().problems; }
  sourceIs(text: string, sourceId = 'resolution.expec'): void { this.entryIs('entry', sourceId, text); }
  entryIs(locator: string, sourceId: string, text: string): void {
    this.entry = this.read(locator, sourceId, text);
    this.report = undefined;
  }
  sourceModuleIs(locator: string, text: string, sourceId = locator + '.expec'): void {
    this.addModule(this.read(locator, sourceId, text));
  }
  externalModuleIs(locator: string, definitions: readonly ExternalDefinition[]): void {
    this.addModule(new ExternalInspection(locator, definitions));
  }
  externalEntryIs(locator: string, definitions: readonly ExternalDefinition[]): void {
    this.entry = new ExternalInspection(locator, definitions);
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

  reference(module: string, segments: readonly string[], occurrence = 0): InspectionNode<'reference'> {
    const view = this.resolved();
    const references = Array.from(view.nodes('reference')).filter(node => this.inModule(node, module)
      && JSON.stringify(view.reference(node.id)) === JSON.stringify(segments));
    const reference = references[occurrence];
    if (!reference) throw new Error('The example has no reference occurrence: ' + JSON.stringify({ module, segments, occurrence }));
    return reference;
  }
  target(reference: InspectionNode<'reference'>) {
    const binding = this.resolved().node(reference.id, 'reference').payload.resolution;
    return { binding, node: binding.status === 'bound' ? this.resolved().node(binding.target) : undefined };
  }
  describeTarget(node: InspectionNode) {
    if (!('name' in node.payload)) throw new Error('A declaration target must have a name');
    return { name: this.resolved().name(node.payload.name), kind: node.payload.kind, origin: node.origin };
  }
  deferredFor(id: NodeId) { return this.resolved().deferred.find(requirement => requirement.occurrence === id); }
  declaration(name: string, kind: InspectionKind, owner?: string) {
    const view = this.resolved();
    const found = Array.from(view.nodes(kind)).find(node => 'name' in node.payload && view.name(node.payload.name) === name);
    const parent = owner === undefined ? undefined
      : Array.from(view.nodes('concept')).find(node => view.name(node.payload.name) === owner);
    return { found, readback: found && view.node(found.id), parent, members: parent?.payload.members.map(id => {
      const member = view.node(id);
      return member.payload.kind === 'local' ? member.payload.declaration : member.id;
    }) };
  }
  builtin(name: string) {
    return Array.from(this.resolved().nodes('builtin-type')).find(node => this.resolved().name(node.payload.name) === name);
  }
  rootNames() {
    return Array.from(this.entry.roots(), id => {
      const node = this.resolved().node(id);
      return 'name' in node.payload ? this.resolved().name(node.payload.name) : node.payload.kind;
    });
  }
  declarationsReplay() {
    const records = this.resolved().nodes('record-type-declaration');
    return { first: records[Symbol.iterator]().next(), second: records[Symbol.iterator]().next(),
      before: Array.from(records), after: Array.from(records) };
  }
  inputSnapshots() {
    return Array.from(this.originals, ([input, before]) => ({ before, after: Array.from(input.nodes('reference')) }));
  }
  readback(node: InspectionNode) { return this.resolved().node(node.id); }
  facts() {
    const view = this.resolved();
    return {
      references: Array.from(view.nodes('reference'), node => ({
        origin: node.origin, written: view.reference(node.id),
        resolution: node.payload.resolution.status === 'bound'
          ? { status: 'bound', target: this.describeTarget(view.node(node.payload.resolution.target)) }
          : node.payload.resolution,
      })), problems: view.problems,
    };
  }
  queryWrongKind(): void {
    this.resolved().node(Array.from(this.entry.nodes('record-type-declaration'))[0]!.id, 'reference');
  }
  queryForeignNode(): void {
    const foreign = this.read('foreign', 'foreign.expec', 'type Elsewhere {}');
    this.resolved().node(Array.from(foreign.roots())[0]!);
  }
  queryMissingNode(): void { this.resolved().node({} as NodeId); }

  record(module: string, name: string, resolved = true) {
    const view = resolved ? this.resolved() : this.module(module);
    const record = this.named(view, module, 'record-type-declaration', name);
    return Object.fromEntries(record.payload.fields.map(id => {
      const field = view.node(id, 'field');
      return [view.name(field.payload.name), this.typeText(view, field.payload.declaredType)];
    }));
  }
  callable(module: string, name: string, resolved = true) {
    const view = resolved ? this.resolved() : this.module(module);
    const callable = this.named(view, module, 'function', name);
    return {
      parameters: Object.fromEntries(callable.payload.parameters.map(id => {
        const parameter = view.node(id, 'parameter');
        return [view.name(parameter.payload.name), this.typeText(view, parameter.payload.declaredType)];
      })),
      result: callable.payload.returnType ? this.typeText(view, callable.payload.returnType) : undefined,
      body: callable.payload.body.kind,
    };
  }
  parameterType(module: string, callableName: string, parameterName: string, resolved = true) {
    const view = resolved ? this.resolved() : this.module(module);
    return this.typeReference(view, this.parameter(view, module, callableName, parameterName).payload.declaredType);
  }
  fieldType(module: string, recordName: string, fieldName: string) {
    const view = this.resolved();
    const record = this.named(view, module, 'record-type-declaration', recordName);
    const field = record.payload.fields.map(id => view.node(id, 'field')).find(node => view.name(node.payload.name) === fieldName)!;
    return this.typeReference(view, field.payload.declaredType);
  }
  origin(module: string, kind: InspectionKind, name: string) {
    const view = this.resolved();
    return Array.from(view.nodes(kind)).find(node => this.inModule(node, module)
      && 'name' in node.payload && view.name(node.payload.name) === name)?.origin;
  }
  rememberBinding(module: string, written: readonly string[], occurrence = 0) {
    const reference = this.reference(module, written, occurrence);
    const target = this.target(reference);
    if (target.node) this.remembered = { view: this.resolved(), reference: reference.id, target: target.node.id };
    return target;
  }
  rememberedBinding() {
    if (!this.remembered) throw new Error('Remember a resolved reference first');
    const { view, reference, target } = this.remembered;
    const node = view.node(target);
    return { binding: view.node(reference, 'reference').payload.resolution, target,
      name: 'name' in node.payload && view.name(node.payload.name) };
  }
  unreachedModule(locator: string, name: string) {
    const module = this.module(locator);
    const node = Array.from(module.nodes('record-type-declaration')).find(node => module.name(node.payload.name) === name)!;
    return { node, readback: module.node(node.id), query: () => this.resolved().node(node.id),
      included: Array.from(this.resolved().nodes('record-type-declaration')).some(node => this.inModule(node, locator)) };
  }
  referenceOutcomes() {
    const view = this.resolved();
    return Array.from(view.nodes('reference'), reference => ({ outcome: reference.payload.resolution,
      target: reference.payload.resolution.status === 'bound' ? view.node(reference.payload.resolution.target) : undefined }));
  }
  parameterDefault(module: string, callableName: string, parameterName: string) {
    const view = this.resolved();
    const parameter = this.parameter(view, module, callableName, parameterName);
    return { present: parameter.payload.hasDefault, value: parameter.payload.defaultValue,
      text: parameter.payload.defaultValue ? view.node(parameter.payload.defaultValue, 'string-literal').payload.value : undefined };
  }
  rejectedExternal(locator: string, definitions: unknown): unknown {
    try { new ExternalInspection(locator, definitions as readonly ExternalDefinition[]); }
    catch (error) { return error; }
  }
  originalReferences(module: string) { return this.module(module).nodes('reference'); }
  typeParameters(module: string, first: string, second: string, name: string) {
    const view = this.resolved();
    const parameter = (owner: string) => this.named(view, module, 'record-type-declaration', owner).payload.typeParameters
      .map(id => view.node(id, 'type-parameter')).find(node => view.name(node.payload.name) === name)!;
    return { first: parameter(first), second: parameter(second),
      targets: Array.from(view.nodes('reference')).filter(node => this.inModule(node, module)
        && JSON.stringify(view.reference(node.id)) === JSON.stringify([name])).map(node => this.target(node)) };
  }
  iteratorWhileResolving(module: string) {
    const nodes = this.module(module).nodes('reference');
    const before = Array.from(nodes);
    const cursor = nodes[Symbol.iterator]();
    const first = cursor.next();
    this.resolveDeclarations();
    return { before, first, remaining: Array.from({ [Symbol.iterator]: () => cursor }), replay: Array.from(nodes) };
  }
  moduleDeclaration(module: string, kind: InspectionKind, name: string) {
    const view = this.resolved();
    return Array.from(this.module(module).nodes(kind)).find(node => 'name' in node.payload && view.name(node.payload.name) === name)!;
  }

  private typeReference(view: Inspection, id: NodeId) {
    const reference = view.node(view.node(id, 'named-type').payload.reference, 'reference');
    const outcome = reference.payload.resolution;
    const target = outcome.status === 'bound' ? view.node(outcome.target) : undefined;
    return { written: view.reference(reference.id), outcome, target,
      name: target && 'name' in target.payload && view.name(target.payload.name) };
  }
  private parameter(view: Inspection, module: string, callableName: string, parameterName: string) {
    return this.named(view, module, 'function', callableName).payload.parameters.map(id => view.node(id, 'parameter'))
      .find(node => view.name(node.payload.name) === parameterName)!;
  }
  private named<K extends 'record-type-declaration' | 'function'>(view: Inspection, module: string, kind: K, name: string): InspectionNode<K> {
    const found = Array.from(view.nodes(kind)).find(node => this.inModule(node, module) && view.name(node.payload.name) === name);
    if (!found) throw new Error(`Expected ${kind} ${module}.${name}`);
    return found;
  }
  private typeText(view: Inspection, id: NodeId): string {
    const type = view.node(id);
    switch (type.payload.kind) {
      case 'named-type': return view.reference(type.payload.reference).join('.')
        + (type.payload.arguments.length ? '<' + type.payload.arguments.map(id => this.typeText(view, id)).join(', ') + '>' : '');
      case 'tuple-type': return '[' + type.payload.elements.map(id => this.typeText(view, id)).join(', ') + ']';
      case 'optional-type': return this.typeText(view, type.payload.inner) + '?';
      case 'union-type': return type.payload.alternatives.map(id => this.typeText(view, id)).join(' | ');
      case 'grouped-type': return '(' + this.typeText(view, type.payload.inner) + ')';
      default: throw new Error('This observation expects a named, tuple, optional, union or grouped type');
    }
  }
  private module(locator: string): ModuleInspection {
    const module = [this.entry, ...this.dependencies.modules].find(module => module.locator === locator);
    if (!module) throw new Error('No supplied module ' + locator);
    return module;
  }
  private read(locator: string, sourceId: string, text: string): ModuleInspection {
    const result = new AntlrSyntaxReader().read({ sourceId, text });
    if (result.status !== 'accepted') throw new Error('Acceptance source must be grammatical: ' + JSON.stringify(result.diagnostics));
    const inspection = new DescriptionInspection(locator, result.description);
    this.rememberInput(inspection);
    return inspection;
  }
  private rememberInput(module: ModuleInspection): void { this.originals.set(module, Array.from(module.nodes('reference'))); }
  private addModule(module: ModuleInspection): void {
    this.dependencies = { ...this.dependencies, modules: [...this.dependencies.modules, module] };
    this.rememberInput(module);
    this.report = undefined;
  }
  private resolved(): Resolution {
    if (!this.report) throw new Error('Resolve declarations before observing them');
    return this.report;
  }
  private inModule(node: InspectionNode, module: string): boolean {
    return node.origin.kind !== 'builtin' && node.origin.module === module;
  }
}
