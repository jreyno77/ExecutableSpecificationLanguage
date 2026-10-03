import {
  Compiler, ExternalModel, LangiumModel, LangiumReader, QueryInspection, SourceComposer, TypeDescriber,
  type Compilation, type ExternalDefinition, type Model, type ModelNode, type ModuleModel,
  type NodeId, type Resolution, type TypeCatalog, type TypeFact, type TypeId,
} from '../../src/index.js';

export class CompositionDriver {
  readonly modules = new Map<string, ModuleModel>();
  readonly texts = new Map<string, string>();
  readonly inputs = new Map<ModuleModel, ReturnType<typeof modelState>>();
  readonly remembered = new Map<string, { resolution: Resolution; compilation: Compilation; state: ReturnType<typeof modelState>; findings: string }>();
  private readonly mappings = new Map<string, string>();
  private entryLocator!: string;
  resolution!: Resolution;
  compilation!: Compilation;
  types!: TypeCatalog;

  source(locator: string, text: string, entry = false): void {
    const read = new LangiumReader().read({ sourceId: locator + '.expec', text });
    if (read.status !== 'accepted') throw new Error('Malformed acceptance input: ' + JSON.stringify(read.diagnostics));
    this.supply(new LangiumModel(locator, read.document));
    this.texts.set(locator, text);
    if (entry) this.entryLocator = locator;
  }
  external(locator: string, definitions: readonly ExternalDefinition[]): void { this.supply(new ExternalModel(locator, definitions)); }
  private supply(model: ModuleModel): void {
    this.modules.set(model.locator, model);
    this.inputs.set(model, modelState(model));
  }
  maps(owner: string, authored: string, supplied: string): void { this.mappings.set(JSON.stringify([owner, authored]), supplied); }
  compose(): void {
    const locate = (owner: string, authored: string) => this.mappings.get(JSON.stringify([owner, authored]))
      ?? (authored.startsWith('.') ? undefined : authored);
    this.resolution = new SourceComposer(locate).compose(this.modules.get(this.entryLocator)!, {
      modules: [...this.modules.values()].filter(model => model.locator !== this.entryLocator), packages: [],
    });
  }
  compile(): void {
    this.compilation = new Compiler().compile({ resolution: this.resolution });
    this.types = this.compilation.value?.types ?? new TypeDescriber().describe(this.resolution);
  }

  declaration(module: string, path: string): ModelNode {
    const model = this.modules.get(module)!;
    const node = allNodes(model).find(node => 'name' in node && this.namePath(model, node) === path);
    if (!node) throw new Error('No authored declaration ' + module + ':' + path);
    return node;
  }
  private namePath(model: Model, node: ModelNode): string {
    const names: string[] = [];
    for (let current: ModelNode | undefined = node; current; ) {
      if ('name' in current) names.unshift(model.node(current.name, 'name').decoded);
      const parent = model.parent(current.id);
      current = parent ? model.node(parent) : undefined;
    }
    return names.join('.');
  }
  parameterType(module: string, callable: string, name: string): TypeFact<TypeId> {
    const parameter = this.types.callable(this.declaration(module, callable).id).parameters.find(slot =>
      this.types.inspection.read(slot.declaration, 'parameter').name === name);
    if (!parameter) throw new Error('Missing parameter ' + name);
    return parameter.type;
  }
  fieldType(module: string, record: string, name: string): TypeFact<TypeId> {
    const fields = this.types.fields(this.declaredType(module, record));
    if (fields.status !== 'known' || fields.value.kind !== 'available') throw new Error('Fields unavailable: ' + JSON.stringify(fields));
    const field = fields.value.fields.find(slot => this.types.inspection.read(slot.declaration, 'field').name === name);
    if (!field) throw new Error('Missing field ' + name);
    return field.type;
  }
  declaredType(module: string, name: string): TypeId { return this.types.declaredType(this.declaration(module, name).id); }
  located(module: string, text: string, line: number) {
    const source = this.texts.get(module)!;
    const lines = source.split('\n'), column = lines[line - 1]!.indexOf(text);
    if (column < 0) throw new Error('Expected text is absent from the authored line');
    return { module, sourceId: module + '.expec', line, column: column + 1,
      offset: lines.slice(0, line - 1).reduce((length, line) => length + line.length + 1, 0) + column };
  }
  originalLocators(module: string): readonly string[] {
    const model = this.modules.get(module)!;
    return [...model.nodes('use'), ...model.nodes('include')].map(node => model.node(node.locator, 'string-literal').value);
  }
  declarationsNamed(name: string): readonly NodeId[] {
    return allNodes(this.resolution.model).filter(node => 'name' in node
      && this.resolution.model.node(node.name, 'name').decoded === name
      && this.types.inspection.parent(node.id) === undefined).map(node => node.id);
  }
  readOriginal(module: string, name: string) {
    return new QueryInspection(this.resolution.model).read(this.declaration(module, name).id);
  }
  remember(name: string): void {
    this.remembered.set(name, { resolution: this.resolution, compilation: this.compilation,
      state: modelState(this.resolution.model), findings: JSON.stringify(this.compilation) });
  }
}

export function modelState(model: Model) {
  const nodes = allNodes(model);
  const bindings = nodes.filter(node => node.kind === 'reference').map(node => model.resolution(node.id));
  return { ids: nodes.map(node => node.id), roots: [...model.roots()],
    parents: nodes.map(node => model.parent(node.id)), children: nodes.map(node => [...model.children(node.id)]),
    targets: bindings.map(binding => binding.status === 'bound' ? binding.target : undefined),
    facts: JSON.stringify({ nodes, bindings }) };
}

function allNodes(model: Model): ModelNode[] {
  const nodes = new Map<NodeId, ModelNode>();
  const visit = (id: NodeId): void => {
    if (nodes.has(id)) return;
    nodes.set(id, model.node(id));
    for (const child of model.children(id)) visit(child);
  };
  for (const root of model.roots()) visit(root);
  return [...nodes.values()];
}
