import {
  Compiler, ExternalModel, LangiumModel, LangiumReader, SourceComposer, SpecificationIdentity, reconcileRelationships,
  type ArtifactAssociation, type ArtifactLocator, type Check, type Compilation, type ExternalDefinition, type IdentityBaseline,
  type IdentifiedSpecification, type IdentityDecision, type Item, type ModuleModel, type NodeId, type Reconciliation,
  type RelationshipObservation, type Resolution, type SpecDiff,
} from '../../src/index.js';

export interface SuppliedUses {
  direction: 'incoming' | 'outgoing'; complete: boolean; scope: string[]; limitations?: string[];
  uses: { specified?: string; project?: string; at: string }[];
  unresolved?: { at: string; reason: string }[];
}
type Capture = { identified: IdentifiedSpecification; resolution: Resolution; compilation: Compilation };
export const locator = (value: string): ArtifactLocator => ({ outputId: 'ts', format: 'identity-test-symbol-v1', value });

export class IdentityDriver {
  readonly sources = new Map<string, string>();
  readonly external = new Map<string, readonly ExternalDefinition[]>();
  entry = '';
  requested = 0;
  counted = 0;
  observedCount = 0;
  identity: SpecificationIdentity;
  compilation!: Compilation;
  resolution!: Resolution;
  result: Check<IdentifiedSpecification> = { problems: [], deferred: [] };
  artifactResult: Check<IdentifiedSpecification> = { problems: [], deferred: [] };
  readResult: Check<IdentityBaseline> = { problems: [], deferred: [] };
  diff!: Check<SpecDiff>;
  reconciliation!: Check<Reconciliation>;
  observation!: RelationshipObservation;
  previous?: Capture;
  baseline: IdentityBaseline | undefined;
  saved = '';
  rememberedBytes = '';
  inputState = '';
  decisions: { old: string; current?: string }[] = [];
  private readonly createId: () => string;

  constructor(ids?: readonly string[]) {
    this.createId = () => ids ? ids[this.requested++]! : 'id-' + ++this.requested;
    this.identity = new SpecificationIdentity(this.createId);
  }
  source(module: string, text: string, entry = false): void {
    this.sources.set(module, text);
    if (entry) this.entry = module;
  }
  compile(): void {
    const models: ModuleModel[] = [...this.sources].map(([module, text]) => {
      const read = new LangiumReader().read({ sourceId: module + '.expec', text });
      if (read.status !== 'accepted') throw new Error('Malformed example: ' + JSON.stringify(read.diagnostics));
      return new LangiumModel(module, read.document);
    });
    models.push(...[...this.external].map(([module, declarations]) => new ExternalModel(module, declarations)));
    this.resolution = new SourceComposer().compose(models.find(model => model.locator === this.entry)!, {
      modules: models.filter(model => model.locator !== this.entry), packages: [],
    });
    this.compilation = new Compiler().compile({ resolution: this.resolution });
  }
  identify(): void {
    this.compile();
    this.inputState = this.modelState();
    if (!this.compilation.value) { this.result = { problems: this.compilation.problems, deferred: this.compilation.deferred }; return; }
    const decisions: IdentityDecision[] = this.decisions.map(decision => {
      const id = this.prior().identified.id(this.select(decision.old, true).id);
      return decision.current ? { id, to: this.select(decision.current).id } : { retire: id };
    });
    this.result = this.identity.associate(this.compilation.value, this.baseline, decisions);
  }
  current(): IdentifiedSpecification {
    if (!this.result.value) throw new Error('Expected an identified specification; got ' + JSON.stringify(this.result));
    return this.result.value;
  }
  prior(): Capture { if (!this.previous) throw new Error('No remembered proposal'); return this.previous; }
  remember(): void {
    this.previous = { identified: this.current(), resolution: this.resolution, compilation: this.compilation };
    this.baseline = this.previous.identified.baseline;
    this.rememberedBytes = JSON.stringify(this.baseline);
    this.counted = this.requested;
    this.decisions = [];
  }
  save(): void {
    const check = this.identity.write(this.current().baseline);
    if (!check.value) throw new Error('Expected baseline bytes; got ' + JSON.stringify(check));
    this.saved = check.value;
  }
  restart(): void {
    this.save();
    this.identity = new SpecificationIdentity(this.createId);
    this.read();
    if (!this.readResult.value) throw new Error('Expected readable baseline: ' + JSON.stringify(this.readResult));
    this.baseline = this.readResult.value;
    this.counted = this.requested;
  }
  read(): void { this.readResult = this.identity.read({ sourceId: '.expec/identity.json', text: this.saved }); }
  compare(): void { this.diff = this.identity.compare(this.baseline, this.current()); }
  nodes(prior = false): Item[] {
    const { resolution, compilation } = prior ? this.prior() : this;
    const inspection = compilation.value?.inspection;
    if (!inspection) throw new Error('Expected successful compilation: ' + JSON.stringify(compilation));
    const nodes: Item[] = [];
    const walk = (id: NodeId): void => {
      nodes.push(inspection.read(id));
      resolution.model.children(id).forEach(walk);
    };
    resolution.model.roots().forEach(walk);
    return nodes;
  }
  path(node: Item, prior = false, ordinal = false): string {
    const { resolution, compilation } = prior ? this.prior() : this;
    const inspection = compilation.value!.inspection, segments: string[] = [];
    for (let item: Item | undefined = node; item; item = inspection.parent(item.id)) {
      if (item.kind === 'name') continue;
      if (item.kind === 'examples' || ordinal && (item.kind === 'example' || item.kind === 'scenario')) {
        const parent = inspection.parent(item.id);
        const siblings = (parent ? resolution.model.children(parent.id) : resolution.model.roots())
          .map(id => inspection.read(id)).filter(sibling => sibling.kind === item!.kind
            && sibling.origin.kind !== 'builtin' && item!.origin.kind !== 'builtin'
            && sibling.origin.module === item!.origin.module);
        segments.unshift(item.kind + '[' + siblings.findIndex(sibling => sibling.id === item!.id) + ']');
      } else if ('name' in item) segments.unshift(String(item.name));
      else if ('title' in item) segments.unshift(item.title.value);
    }
    return segments.join('.');
  }
  select(subject: string, prior = false): Item {
    const colon = subject.indexOf(':'), module = colon < 0 ? undefined : subject.slice(0, colon), path = subject.slice(colon + 1);
    const found = this.nodes(prior).filter(node => node.kind !== 'name'
      && (!module || node.origin.kind !== 'builtin' && node.origin.module === module)
      && (this.path(node, prior) === path || this.path(node, prior, true) === path
        || !!module && this.path(node, prior).endsWith('.' + path)))
      .filter(node => 'name' in node || 'title' in node || node.kind === 'examples');
    if (found.length !== 1) throw new Error('Expected one ' + subject + '; found ' + found.map(item => item.kind).join(', '));
    return found[0]!;
  }
  id(subject: string, prior = false): string { return (prior ? this.prior().identified : this.current()).id(this.select(subject, prior).id); }
  record(subject: string, prior = false) {
    const baseline = prior ? this.prior().identified.baseline : this.current().baseline;
    return baseline.elements.find(record => record.id === this.id(subject, prior))!;
  }
  artifacts(subject: string, prior = false, retired = false): readonly ArtifactAssociation[] {
    const baseline = prior ? this.prior().identified.baseline : this.baselineAfterRestart();
    const id = this.id(subject, prior || retired);
    return baseline.artifacts.filter(association => association.specId === id);
  }
  private baselineAfterRestart(): IdentityBaseline { return this.readResult.value ?? this.current().baseline; }
  associations(items: readonly { subject: string; locator: ArtifactLocator }[]): void {
    this.artifactResult = this.identity.withArtifacts(this.current(), items.map(item => ({ specId: this.id(item.subject), locator: item.locator })));
    if (this.artifactResult.value) this.result = this.artifactResult;
  }
  observe(subject: string, input: SuppliedUses): void {
    this.observedCount = this.requested;
    this.observation = { subject: this.id(subject), direction: input.direction,
      coverage: { scope: input.scope.map(locator), complete: input.complete, limitations: input.limitations ?? [] },
      uses: input.uses.map(use => ({ target: use.specified ? { kind: 'specified', id: this.id(use.specified) }
        : { kind: 'project', id: use.project! }, at: locator(use.at) })),
      unresolved: (input.unresolved ?? []).map(use => ({ at: locator(use.at), reason: use.reason })) };
  }
  reconcile(expected: string[]): void { this.reconciliation = reconcileRelationships(this.current(), expected.map(name => this.id(name)), this.observation); }
  modelState(): string {
    return JSON.stringify(this.resolution.model.roots().map(id => this.tree(id)));
  }
  private tree(id: NodeId): unknown {
    const model = this.resolution.model, node = model.node(id);
    return { node, ...(node.kind === 'reference' ? { binding: model.resolution(id) } : {}),
      children: model.children(id).map(child => this.tree(child)) };
  }
}
