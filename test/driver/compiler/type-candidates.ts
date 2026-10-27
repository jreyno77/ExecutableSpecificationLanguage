import {
  Compiler, ExternalModel, LangiumModel, LangiumReader, QueryInspection, Resolver, SourceComposer,
  isNodeId, typeCandidates,
  type Check, type Compilation, type Diagnostic, type ExternalDefinition, type Item, type Model,
  type ModuleModel, type NodeId, type NodeKind, type Requirement, type Resolution, type TypeCandidate,
} from '../../../src/index.js';

type Reply = Check<readonly TypeCandidate[]>;

/** Exercises the public query on real captured models; never computes expected eligibility. */
export class TypeCandidateDriver {
  private readonly reader = new LangiumReader();
  private readonly modules = new Map<string, ModuleModel>();
  private readonly texts = new Map<string, string>();
  private entry = 'entry';
  private resolved: Resolution | undefined;
  private capturedModel: Model | undefined;
  private selected: Item<'reference'> | undefined;
  private answer: Reply | undefined;
  private compilation: Compilation | undefined;
  private readonly replies = new Map<string, Reply>();
  private forbidInputs = false;
  private inputReads = 0;
  private readonly protectedFacts = new WeakMap<object, object>();
  private beforeQuery: unknown;

  sourceIs(text: string): void { this.sourceModuleIs('entry', text); }
  sourceModuleIs(locator: string, text: string): void {
    this.texts.set(locator, text); this.modules.set(locator, this.protect(this.read(locator, text)));
  }
  externalModuleIs(locator: string, definitions: readonly ExternalDefinition[]): void {
    this.modules.set(locator, this.protect(new ExternalModel(locator, definitions)));
  }
  externalEntryIs(definitions: readonly ExternalDefinition[]): void { this.externalModuleIs('entry', definitions); }
  resolveDeclarations(): void {
    this.retain(new Resolver().resolve(this.input(this.entry), { modules: this.dependencies(), packages: [] }));
  }
  composeSources(): void {
    this.retain(new SourceComposer().compose(this.input(this.entry), { modules: this.dependencies(), packages: [] }));
  }
  composeEntries(entries: readonly { locator: string; text: string }[]): void {
    for (const entry of entries) this.sourceModuleIs(entry.locator, entry.text);
    this.entry = entries[0]!.locator;
    this.retain(new SourceComposer().compose(entries.map(entry => ({ entry: this.input(entry.locator),
      dependencies: { modules: this.dependencies(entry.locator), packages: [] } }))));
  }
  compileResolvedSource(): void { this.compilation = new Compiler().compile({ resolution: this.resolution }); }
  ask(path: readonly string[], occurrence?: number, module = this.entry): void {
    this.selected = this.reference(this.resolution.model, module, path, occurrence);
    this.answer = typeCandidates(this.resolution, this.selected.id);
  }
  get result(): Reply { if (!this.answer) throw new Error('Ask the public query first.'); return this.answer; }
  get resolution(): Resolution { if (!this.resolved) throw new Error('Resolve the real input first.'); return this.resolved; }
  get referenceAsked(): Item<'reference'> { if (!this.selected) throw new Error('Ask at a reference first.'); return this.selected; }
  get compiled(): Compilation { if (!this.compilation) throw new Error('Compile the resolved source first.'); return this.compilation; }
  get furtherInputReads(): number { return this.inputReads; }
  get sameCapturedModel(): boolean { return this.resolution.model === this.capturedModel; }
  candidate(name: string): TypeCandidate {
    const found = this.result.value?.filter(candidate => candidate.name === name);
    if (!found || found.length !== 1) throw new Error(`Expected one actual candidate ${name}; got ${found?.length ?? 0}.`);
    return found[0]!;
  }
  target(name: string): Item { return new QueryInspection(this.resolution.model).read(this.candidate(name).target); }
  rememberReply(name: string): void { this.replies.set(name, detached(this.result)); }
  remembered(name: string): Reply { const reply = this.replies.get(name); if (!reply) throw new Error('Remember the reply first.'); return reply; }
  useSameModelReport(problems: readonly Diagnostic[], deferred: readonly Requirement[]): void {
    this.resolved = { ...this.resolution, problems: problems as Resolution['problems'], deferred: deferred as Resolution['deferred'] };
  }
  forbidFurtherInputModelReads(): void {
    this.beforeQuery = this.modelFacts(); this.forbidInputs = true; this.inputReads = 0;
  }
  suppliedNameReadFromCallback(name: string): () => string {
    let retained: { readonly decoded: string } | undefined;
    this.input(this.entry).nodes('name').forEach(node => { if (node.decoded === name) retained = node; });
    if (!retained) throw new Error('The real supplied name must exist before observing its getter.');
    const observed = retained;
    return () => observed.decoded;
  }
  capturedModelObservation(): { before: unknown; after: unknown } { return { before: this.beforeQuery, after: this.modelFacts() }; }
  attemptCandidateMutation(name: string): void {
    const candidate = this.candidate(name) as { name: string; insertionText: string; target: NodeId };
    for (const attempt of [() => { candidate.name = 'Changed'; }, () => { candidate.insertionText = 'Changed'; },
      () => { candidate.target = {} as NodeId; }, () => { (this.result.value as TypeCandidate[]).length = 0; }]) {
      try { attempt(); } catch (error) { if (!(error instanceof TypeError)) throw error; }
    }
  }
  insertedNameBinding(name: string): { expected: Item; actual: Item } {
    const candidate = this.candidate(name), expected = this.target(name), reference = this.referenceAsked;
    const terminal = reference.segmentOrigins.at(-1);
    if (terminal?.kind !== 'source') throw new Error('Insertion requires an actual source terminal range.');
    const text = this.texts.get(terminal.module);
    if (text === undefined) throw new Error('The example has no captured source text.');
    const scalars = [...text];
    const changed = scalars.slice(0, terminal.range.start.offset).join('') + candidate.insertionText
      + scalars.slice(terminal.range.end.offset).join('');
    const changedModel = this.read(terminal.module, changed);
    const inputs = [...this.modules].map(([locator, model]) => locator === terminal.module ? changedModel : model);
    const entry = inputs.find(model => model.locator === this.entry)!;
    const resolved = new Resolver().resolve(entry, { modules: inputs.filter(model => model !== entry), packages: [] });
    const inspection = new QueryInspection(resolved.model);
    const inserted = [...inspection.query('reference')].find(item => {
      const origin = item.segmentOrigins.at(-1);
      return origin?.kind === 'source' && origin.module === terminal.module
        && origin.range.start.offset === terminal.range.start.offset;
    });
    if (!inserted || inserted.resolution.status !== 'bound') throw new Error('The returned insertion did not resolve: ' + JSON.stringify(inserted?.resolution));
    return { expected, actual: inspection.read(inserted.resolution.target) };
  }
  foreignQuery(text: string): { id: NodeId; run: () => Reply } {
    const foreign = new Resolver().resolve(this.read('foreign', text), { modules: [], packages: [] });
    const id = foreign.model.nodes('reference')[0]!.id;
    return { id, run: () => typeCandidates(this.resolution, id) };
  }
  unreachedQuery(module: string, path: readonly string[]): { id: NodeId; run: () => Reply } {
    const id = this.reference(this.input(module), module, path).id;
    return { id, run: () => typeCandidates(this.resolution, id) };
  }
  unpreparedQuery(text: string, path: readonly string[], substitute: boolean): { id: NodeId; run: () => Reply } {
    const model = this.read('raw', text), id = this.reference(model, 'raw', path).id;
    const resolution: Resolution = substitute ? { ...this.resolution, model }
      : { entry: model.locator, model, problems: [], deferred: [] };
    return { id, run: () => typeCandidates(resolution, id) };
  }
  declarationQuery(name: string, kind: NodeKind): { id: NodeId; run: () => Reply } {
    const declarations = [...new QueryInspection(this.resolution.model).query(kind)]
      .filter(item => 'name' in item && item.name === name);
    if (declarations.length !== 1) throw new Error('Expected one actual declaration for the query control.');
    const id = declarations[0]!.id;
    return { id, run: () => typeCandidates(this.resolution, id) };
  }
  nonissuedQuery(): { id: NodeId; run: () => Reply } {
    const id = {} as NodeId; return { id, run: () => typeCandidates(this.resolution, id) };
  }
  referenceQuery(path: readonly string[]): { id: NodeId; run: () => Reply } {
    const id = this.reference(this.resolution.model, this.entry, path).id;
    return { id, run: () => typeCandidates(this.resolution, id) };
  }
  private retain(resolution: Resolution): void { this.resolved = resolution; this.capturedModel = resolution.model; }
  private input(locator: string): ModuleModel {
    const model = this.modules.get(locator); if (!model) throw new Error('No arranged module ' + locator); return model;
  }
  private dependencies(entry = this.entry): ModuleModel[] { return [...this.modules].filter(([locator]) => locator !== entry).map(([, model]) => model); }
  private read(locator: string, text: string): ModuleModel {
    const read = this.reader.read({ sourceId: locator + '.expec', text });
    if (read.status !== 'accepted') throw new Error('The literal fixture is not accepted: ' + JSON.stringify(read.diagnostics));
    return new LangiumModel(locator, read.document);
  }
  private reference(model: Model, module: string, path: readonly string[], occurrence?: number): Item<'reference'> {
    const references = [...new QueryInspection(model).query('reference')].filter(item => item.origin.kind !== 'builtin'
      && item.origin.module === module && item.segments.length === path.length && item.segments.every((segment, index) => segment === path[index]));
    if (occurrence === undefined && references.length !== 1) throw new Error(`Expected one reference ${module}:${path.join('.')}; got ${references.length}.`);
    const selected = references[occurrence ?? 0]; if (!selected) throw new Error('The stated reference occurrence is absent.'); return selected;
  }
  private protect<T extends object>(input: T): T {
    if (isNodeId(input)) return input;
    const known = this.protectedFacts.get(input); if (known) return known as T;
    const proxy = new Proxy(input, { get: (target, key) => {
      const check = (): void => { if (this.forbidInputs) { this.inputReads++; throw new Error('A completed query reread a supplied model fact.'); } };
      check(); const value: unknown = Reflect.get(target, key, target);
      if (typeof value === 'function') return (...args: unknown[]) => { check(); const result: unknown = Reflect.apply(value, Array.isArray(target) ? proxy : target, args);
        return result && typeof result === 'object' ? this.protect(result) : result; };
      return value && typeof value === 'object' ? this.protect(value) : value;
    } });
    this.protectedFacts.set(input, proxy); return proxy;
  }
  private modelFacts(): unknown {
    const model = this.resolution.model, nodes: unknown[] = [], seen = new Set<NodeId>();
    const visit = (id: NodeId): void => {
      if (seen.has(id)) return; seen.add(id);
      const node = model.node(id); nodes.push({ id, record: detached(node), children: [...model.children(id)],
        parent: model.parent(id), ...(node.kind === 'reference' ? { resolution: detached(model.resolution(id)) } : {}) });
      for (const child of model.children(id)) visit(child);
    };
    const roots = [...model.roots()]; roots.forEach(visit); return { roots, nodes, problems: detached(this.resolution.problems), deferred: detached(this.resolution.deferred) };
  }
}

/** Materializes observations without replacing actual opaque identity handles. */
function detached<T>(value: T): T {
  if (!value || typeof value !== 'object' || isNodeId(value)) return value;
  if (Array.isArray(value)) return value.map(detached) as T;
  return Object.fromEntries(Object.entries(value).map(([key, fact]) => [key, detached(fact)])) as T;
}
