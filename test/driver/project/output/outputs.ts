import { promises as fs, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { vi } from 'vitest';
import { Compiler, ConfigurationReader, FileProjectWriter, Outputs, ProjectConnector, SpecificationIdentity, SourceComposer, LangiumReader, LangiumModel, ExternalModel,
  contractListOutput, structureListOutput, reconcileRelationships,
  type Check, type Configuration, type IdentifiedSpecification, type IdentityDecision, type Output,
  type OutputPlan, type OutputWrite, type ProjectContext, type ProjectRead, type ProjectSearch, type ProjectSnapshot,
  type Reconciliation, type SpecDiff, type Specification } from '../../../../src/index.js';

/** Real checked specifications, connected files, and writer effects for the output examples. */
export class OutputsDriver {
  private readonly temporary = realpathSync.native(tmpdir());
  readonly directory = realpathSync.native(mkdtempSync(join(this.temporary, 'expec-outputs-')));
  root = '';
  readonly outputs = new Outputs();
  readonly identity = new SpecificationIdentity(() => 'id-' + ++this.nextId);
  private nextId = 0;
  context!: ProjectContext;
  output!: Output;
  current!: IdentifiedSpecification;
  previous!: IdentifiedSpecification;
  text = '';
  selected = { id: 'contract-list', options: { directory: 'docs/contracts' } };
  settings!: Configuration;
  opened!: Check<Output>;
  written!: OutputWrite;
  readResult!: ProjectRead;
  searchResult!: ProjectSearch;
  compared!: Check<Reconciliation>;
  diff!: SpecDiff;
  savedDiff!: SpecDiff;
  savedCurrent!: IdentifiedSpecification;
  savedIdentifier = '';
  readonly originalIdentifiers = new Map<string, string>();
  readonly captures: Specification[] = [];
  modelBefore = '';
  remembered!: Awaited<ReturnType<OutputsDriver['files']>>;
  oneFile!: { path: string; bytes: string; metadata: string };
  plans: OutputPlan[] = [];
  planResult!: Check<OutputPlan>;
  baseline!: ProjectSnapshot;
  globalBefore = '';
  error: unknown;
  writerCalls = 0;
  restoreFailure: (() => void) | undefined;
  constructor() {
    for (const registration of [contractListOutput, structureListOutput]) this.outputs.register({ ...registration, open: options => {
      const adapter = registration.open(options);
      return { id: adapter.id, read: (id, snapshot) => adapter.read(id, snapshot), search: (id, snapshot) => adapter.search(id, snapshot),
        plan: (request, snapshot) => { if ('current' in request) this.captures.push(request.current.specification); return adapter.plan(request, snapshot); } };
    } });
  }
  async initialize(name = 'project-a'): Promise<void> {
    this.root = join(this.directory, name);
    await fs.mkdir(this.root); await fs.mkdir(join(this.directory, 'project-b'));
    const settings = new ConfigurationReader(this.outputs.profiles).read({ sourceId: 'expec.json', text: JSON.stringify({
      formatVersion: 1, version: '0.1.0', build: { entries: ['store.expec'] }, project: { root: name },
    }) });
    if (!settings.value) throw new Error(JSON.stringify(settings));
    const connection = await new ProjectConnector(join(this.directory, 'expec.json')).connect(settings.value);
    if (connection.value?.status !== 'connected') throw new Error(JSON.stringify(connection));
    this.context = connection.value.context;
  }
  async readSettings(part: object): Promise<void> {
    const result = new ConfigurationReader(this.outputs.profiles).read({ sourceId: 'expec.json', text: JSON.stringify({
      formatVersion: 1, version: '0.1.0', build: { entries: ['store.expec'] }, ...part,
    }) });
    if (!result.value) throw new Error(JSON.stringify(result)); this.settings = result.value;
  }
  async createConfiguredOutput(): Promise<void> {
    const selected = this.settings.outputs[0]!;
    await this.createWith(selected.id, selected.options as { directory: string });
  }
  compile(text: string): Specification {
    const result = new Compiler().compile({ locator: 'store', source: { sourceId: 'store.expec', text }, dependencies: { modules: [], packages: [] } });
    if (!result.value) throw new Error('Invalid acceptance source: ' + JSON.stringify(result));
    return result.value;
  }
  async specify(text: string): Promise<void> {
    this.text = text;
    const result = this.identity.associate(this.compile(text));
    if (!result.value) throw new Error(JSON.stringify(result));
    this.current = result.value; this.diff = this.identity.compare(undefined, this.current).value!;
    this.modelBefore = this.modelState();
  }
  async specifyModules(entry: string, files: Record<string, string>, externalConcepts: Record<string, string[]> = {}): Promise<void> {
    const models = Object.entries(files).map(([locator, text]) => { const read = new LangiumReader().read({ sourceId: locator, text });
      if (read.status !== 'accepted') throw new Error(JSON.stringify(read.diagnostics)); return new LangiumModel(locator, read.document); });
    const resolution = new SourceComposer().compose(models.find(model => model.locator === entry)!, { packages: [],
      modules: [...models.filter(model => model.locator !== entry), ...Object.entries(externalConcepts).map(([locator, names]) => new ExternalModel(locator,
        names.map(name => ({ kind: 'concept', name, public: [], members: [] }))))] });
    const checked = new Compiler().compile({ resolution });
    if (!checked.value) throw new Error(JSON.stringify(checked));
    const identified = this.identity.associate(checked.value);
    if (!identified.value) throw new Error(JSON.stringify(identified)); this.current = identified.value;
    this.diff = this.identity.compare(undefined, this.current).value!; this.modelBefore = this.modelState();
  }
  async revise(text: string, decisions: (specification: Specification) => IdentityDecision[] = () => []): Promise<void> {
    this.previous = this.current;
    const specification = this.compile(text), result = this.identity.associate(specification, this.previous.baseline, decisions(specification));
    if (!result.value) throw new Error(JSON.stringify(result));
    this.text = text; this.current = result.value; this.diff = this.identity.compare(this.previous.baseline, this.current).value!;
  }
  identifier(name: string): string { return this.findIdentity(name, this.current); }
  findIdentity(name: string, current: IdentifiedSpecification): string {
    const path = (id: string): string => { const record = current.baseline.elements.find(item => item.id === id)!;
      return (record.address.owner ? path(record.address.owner) + '.' : '') + record.address.name; };
    const record = current.baseline.elements.find(item => path(item.id) === name);
    if (!record) throw new Error('No persistent subject ' + name); return record.id;
  }
  modelState(): string { return JSON.stringify({ baseline: this.current.baseline, roots: [...this.current.specification.inspection.roots()] }); }
  async open(id: string, options: { directory?: string }): Promise<void> {
    this.opened = this.outputs.open(id, options, this.context, { apply: input => { this.writerCalls++; return new FileProjectWriter(this.context).apply(input); } });
    if (this.opened.value) { this.output = this.opened.value; this.selected = { id, options: options as { directory: string } }; }
  }
  async createWith(id: string, options: { directory: string }): Promise<void> { await this.open(id, options); await this.create(); }
  async create(): Promise<void> { this.written = await this.output.create(this.current); }
  async update(): Promise<void> { this.written = await this.output.update(this.diff, this.current); }
  async insert(): Promise<void> { this.written = await this.output.insert(this.diff, this.current); }
  async delete(name: string): Promise<void> { this.written = await this.output.delete(this.identifier(name)); }
  async read(name: string): Promise<void> { this.readResult = await this.output.read(this.identifier(name)); }
  async search(name: string): Promise<void> { this.searchResult = await this.output.search(this.identifier(name)); }
  async writeForeignContract(path: string, outputId: string, name: string, link?: string): Promise<void> {
    const specId = this.identifier(name), encoded = Buffer.from(specId).toString('hex');
    const metadata = Buffer.from(JSON.stringify({ outputId, specId })).toString('hex');
    await this.write(path, `<!-- expec-section:${metadata} -->\n\n# ${name}\n\n<a id="expec-${encoded}"></a>\n\n`
      + (link ? `[contract](${link})\n\n` : '') + `<!-- expec-end:${encoded} -->\n`);
  }
  async reopenOutput(): Promise<void> { await this.open(this.selected.id, this.selected.options); }
  async reopenOutputWithoutSavingHostBaseline(): Promise<void> { await this.reopenOutput(); }
  rememberIdentifier(name: string): void { this.savedIdentifier = this.identifier(name); this.originalIdentifiers.set(name, this.savedIdentifier); }
  async deleteRememberedIdentifier(): Promise<void> { this.written = await this.output.delete(this.savedIdentifier); }
  async deleteOriginalIdentifier(name: string): Promise<void> { this.written = await this.output.delete(this.originalIdentifiers.get(name)!); }
  rememberDiff(): void { this.savedDiff = this.diff; }
  rememberCurrentAndDiff(): void { this.savedDiff = this.diff; this.savedCurrent = this.current; }
  async repeatRememberedUpdate(): Promise<void> { this.written = await this.output.update(this.savedDiff, this.savedCurrent); }
  async updateUsingRememberedDiff(): Promise<void> { this.written = await this.output.update(this.savedDiff, this.current); }
  async saveHostBaselineWithoutRunningOutput(): Promise<void> { this.savedCurrent = this.current; }
  async compareUnchangedCurrentWithSavedHostBaseline(): Promise<void> { this.diff = this.identity.compare(this.savedCurrent.baseline, this.current).value!; }
  async reidentifyWithUnrelatedNewIdentifiers(text: string): Promise<void> { this.previous = this.current; await this.specify(text); }
  async revisePromise(_name: string, text: string): Promise<void> { await this.revise(this.text.replace(/promises "[^"\n]*"/, 'promises ' + JSON.stringify(text))); }
  async addPublicCapability(owner: string, signature: string): Promise<void> {
    const item = this.current.specification.inspection.read(this.current.node(this.identifier(owner)));
    if (item.origin.kind !== 'source') throw new Error('Expected authored concept');
    const { start, end } = item.origin.range;
    const edited = this.text.slice(start.offset, end.offset).replace(/public ([^\n]+)/, '$&, ' + signature.split('(')[0]);
    await this.revise(this.text.slice(0, start.offset) + edited.slice(0, -1) + '\ncapability ' + signature + '\n}' + this.text.slice(end.offset));
  }
  async renameWithIdentity(from: string, to: string): Promise<void> {
    const id = this.identifier(from); this.originalIdentifiers.set(from, id);
    const old = from.split('.').at(-1)!, name = to.split('.').at(-1)!;
    await this.revise(this.text.replace(new RegExp('\\b' + old + '\\b', 'g'), name), specification => {
      const kind = this.previous.baseline.elements.find(item => item.id === id)!.address.kind;
      const node = [...specification.inspection.query(kind)].find(item => 'name' in item && item.name === name)!;
      return [{ id, to: node.id }];
    });
  }
  async removeCapabilityAndPublicSelection(owner: string, name: string): Promise<void> {
    const id = this.identifier(owner + '.' + name);
    await this.revise(this.text.replace(new RegExp('public ' + name + '\\s*\\n'), '')
      .replace(new RegExp('capability ' + name + '[^\\n{]*(?:\\{[^}]*\\})?'), ''), () => [{ retire: id }]);
  }
  path(name: string): string {
    const target = resolve(this.root, name), inside = relative(this.root, target);
    if (isAbsolute(inside) || inside === '..' || inside.startsWith('..' + sep)) throw new Error('Fixture path escaped project.'); return target;
  }
  async write(path: string, text: string): Promise<void> { await fs.mkdir(dirname(this.path(path)), { recursive: true }); await fs.writeFile(this.path(path), text); }
  async content(path: string): Promise<string> { return fs.readFile(this.path(path), 'utf8'); }
  async append(path: string, text: string): Promise<void> { await fs.appendFile(this.path(path), text); }
  async copy(from: string, to: string): Promise<void> { await this.write(to, await this.content(from)); }
  async writeJson(path: string, value: unknown): Promise<void> { await this.write(path, JSON.stringify(value, null, 2)); }
  async changeJsonDeclarationName(path: string, name: string): Promise<void> { const value = JSON.parse(await this.content(path)); value.declaration.name = name; await this.writeJson(path, value); }
  async files(): Promise<{ path: string; bytes: string; metadata: string }[]> {
    const snapshot = await this.context.readSnapshot();
    return Promise.all(snapshot.files.map(async file => { const stat = await fs.stat(this.path(file.path), { bigint: true });
      return { path: file.path, bytes: Buffer.from(file.bytes).toString('base64'), metadata: `${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}` }; }));
  }
  async rememberFiles(): Promise<void> { this.remembered = await this.files(); }
  async rememberFilesAndMetadata(): Promise<void> { await this.rememberFiles(); }
  async rememberFileAndMetadata(path: string): Promise<void> { this.oneFile = (await this.files()).find(file => file.path === path)!; }
  statePath(): string { return '.expec/outputs/' + Buffer.from(this.selected.id).toString('hex') + '.json'; }
  async removeOutputStateKeepingArtifacts(): Promise<void> { await fs.unlink(this.path(this.statePath())); }
  async corruptOutputState(): Promise<void> { await this.write(this.statePath(), '{ broken'); }
  async denyNextStateFileWrite(): Promise<void> {
    const original = fs.open.bind(fs), state = this.path(this.statePath());
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      if (String(path) === state && flags === 'r+') throw Object.assign(new Error('Injected state replacement failure'), { code: 'EACCES' });
      return original(path, flags, mode);
    });
    this.restoreFailure = () => spy.mockRestore();
  }
  async releaseWriteFailure(): Promise<void> { this.restoreFailure?.(); this.restoreFailure = undefined; }
  async writeMalformedSectionMetadata(path: string): Promise<void> { await this.write(path, '<!-- expec-section: malformed -->\n# Broken identity'); }
  async replaceDependencyLinks(name: string, links: string[]): Promise<void> {
    const path = `${this.selected.options.directory}/${name}.md`, text = await this.content(path);
    await this.write(path, text.replace(/^.*depends on.*$/im, 'Depends on: ' + links.map(link => `[${link}](${link.includes('/') ? link : link + '.md'})`).join(', ')));
  }
  compareOutgoingWith(names: string[]): void { this.compared = reconcileRelationships(this.current, names.map(name => this.identifier(name)), this.searchResult.outgoing); }
  async planCreate(): Promise<void> { this.baseline = await this.context.readSnapshot(); this.planResult = await this.output.plan({ operation: 'create', current: this.current }, this.baseline); }
  async planUpdate(): Promise<void> { this.baseline = await this.context.readSnapshot(); this.planResult = await this.output.plan({ operation: 'update', diff: this.diff, current: this.current }, this.baseline); }
  async applyPreparedPlan(): Promise<void> {
    if (!this.planResult.value) throw new Error(JSON.stringify(this.planResult));
    const receipt = await new FileProjectWriter(this.context).apply(this.planResult.value);
    this.written = { receipt, problems: receipt.problems, ...(receipt.status === 'stopped' ? {} : { artifacts: this.planResult.value.artifacts }) };
  }
  async saveGlobalIdentityWithUnrelatedArtifact(id: string): Promise<void> {
    this.current = this.identity.withArtifacts(this.current, [{ specId: this.identifier('StoreGame'), locator: { outputId: id, format: 'fixture', value: 'outside' } }]).value!;
    await this.write('.expec/identity.json', this.identity.write(this.current.baseline).value!);
  }
  async rememberGlobalIdentityFile(): Promise<void> { this.globalBefore = await this.content('.expec/identity.json'); }
  async planBothFromOneSnapshot(...ids: string[]): Promise<void> {
    const snapshot = await this.context.readSnapshot(); this.plans = [];
    for (const id of ids) { await this.open(id, { directory: id === 'contract-list' ? 'docs/contracts' : 'design/structure' });
      const result = await this.output.plan({ operation: 'create', current: this.current }, snapshot);
      if (!result.value) throw new Error(JSON.stringify(result)); this.plans.push(result.value); }
  }
  async applyCombinedPreparedChanges(): Promise<void> {
    const receipt = await new FileProjectWriter(this.context).apply({ basedOn: this.plans[0]!.basedOn, changes: this.plans.flatMap(plan => [...plan.changes]) });
    this.written = { receipt, problems: receipt.problems, ...(receipt.status === 'stopped' ? {} : { artifacts: this.plans.flatMap(plan => [...plan.artifacts]) }) };
  }
  acceptSuccessfulNamespacesRetaining(id: string): void {
    if (!this.written.artifacts) throw new Error('No successful proposal');
    this.current = this.identity.withArtifacts(this.current, [...this.current.baseline.artifacts.filter(link => link.locator.outputId === id), ...this.written.artifacts]).value!;
  }
  async planTwoRegisteredOutputsForSameFile(path: string): Promise<void> {
    const snapshot = await this.context.readSnapshot(); this.plans = [];
    for (const id of ['first-test-output', 'second-test-output']) {
      this.outputs.register({ id, validate: () => [], open: () => ({ id,
        plan: async (_request, basedOn) => ({ value: { outputId: id, basedOn, changes: [{ kind: 'write', path, bytes: Buffer.from(id) }], artifacts: [] }, problems: [], deferred: [] }),
        read: async () => { throw new Error('Not part of the overlap fixture'); }, search: async () => { throw new Error('Not part of the overlap fixture'); } }) });
      await this.open(id, {}); const result = await this.output.plan({ operation: 'create', current: this.current }, snapshot);
      if (!result.value) throw new Error(JSON.stringify(result)); this.plans.push(result.value);
    }
  }
  async declineConflictingPlans(): Promise<void> { this.plans = []; }
  async registerAdapterReturningDeferredOnlyPlan(): Promise<void> {
    this.outputs.register({ id: 'invalid', validate: () => [], open: () => ({ id: 'invalid',
      plan: async () => ({ problems: [], deferred: [{ reason: 'unsupported', origin: { kind: 'builtin', name: 'Text' }, requires: 'hidden missing mapping' }] }),
      read: async () => { throw new Error('Unused'); }, search: async () => { throw new Error('Unused'); } }) });
    await this.open('invalid', {});
  }
  async tryCreate(): Promise<void> { try { await this.create(); } catch (error) { this.error = error; } }
  async registerAdapterReturningMalformedObligation(): Promise<void> {
    this.outputs.register({ id: 'malformed-obligation', validate: () => [], open: () => ({ id: 'malformed-obligation',
      plan: async (_request, basedOn) => ({ problems: [], deferred: [], value: { outputId: 'malformed-obligation', basedOn,
        changes: [{ kind: 'write', path: 'untrusted.txt', bytes: Buffer.from('must not be written') }], artifacts: [],
        obligations: [{ code: 7 }] as unknown as import('../../../../src/index.js').Diagnostic[] } }),
      read: async () => { throw Error('Unused'); }, search: async () => { throw Error('Unused'); } }) });
    await this.open('malformed-obligation', {});
  }
  async dispose(): Promise<void> {
    this.restoreFailure?.();
    const name = relative(this.temporary, this.directory);
    if (isAbsolute(name) || name.includes(sep) || !name.startsWith('expec-outputs-')) throw new Error('Unexpected fixture directory');
    await fs.rm(this.directory, { recursive: true, force: true });
  }
}
