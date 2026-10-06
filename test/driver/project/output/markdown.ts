import { promises as fs, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { vi } from 'vitest';
import { Compiler, ConfigurationReader, ExternalModel, FileProjectWriter, LangiumModel, LangiumReader, Outputs,
  ProjectConnector, SourceComposer, SpecificationIdentity, contractListOutput, markdownOutput,
  type Check, type ExternalDefinition, type IdentifiedSpecification, type IdentityDecision, type Output,
  type OutputPlan, type OutputWrite, type ProjectContext, type ProjectRead, type ProjectSearch, type SpecDiff,
  type Specification } from '../../../../src/index.js';

/** Compiles real inputs and observes real connected files; it never predicts rendered facts. */
export class MarkdownDriver {
  readonly temporary = realpathSync.native(tmpdir());
  readonly root = realpathSync.native(mkdtempSync(join(this.temporary, 'expec-markdown-')));
  readonly outputs = new Outputs();
  readonly identity = new SpecificationIdentity(() => 'markdown-' + ++this.sequence);
  private sequence = 0;
  private context?: ProjectContext;
  private opened = new Map<string, Output>();
  private dirty = true;
  private decisions: { from: string; to?: string; examples?: boolean }[] = [];
  text = '';
  readonly sources = new Map<string, string>();
  readonly external = new Map<string, ExternalDefinition[]>();
  readonly packages: { alias: string; phases: ('build' | 'runtime' | 'test')[] }[] = [];
  entry = 'main.expec';
  current!: IdentifiedSpecification;
  previous?: IdentifiedSpecification;
  diff!: SpecDiff;
  written!: OutputWrite;
  readResult!: ProjectRead;
  searchResult!: ProjectSearch;
  plan!: Check<OutputPlan>;
  problems: { code: string; at: unknown }[] = [];
  before = '';
  selected = 'markdown';
  readonly remembered = new Map<string, Uint8Array>();
  readonly locations = new Map<string, string>();
  readonly originalIds = new Map<string, string>();
  private restore: (() => void) | undefined;

  constructor() { this.outputs.register(markdownOutput); this.outputs.register(contractListOutput); }
  source(text: string): void { this.text = text; this.sources.clear(); this.entry = 'main.expec'; this.dirty = true; }
  sourceFile(path: string, text: string): void { this.sources.set(path, text); this.dirty = true; }
  externalFunction(module: string, name: string, parameters: string[], result: string): void {
    this.external.set(module, [{ kind: 'function', name, parameters: parameters.map(parameter => {
      const [name, type] = parameter.split(':').map(part => part.trim());
      return { name: name!, type: { kind: 'builtin', name: type as 'Text' } };
    }), result: { kind: 'builtin', name: result as 'Nothing' } }]);
  }
  async connect(): Promise<ProjectContext> {
    if (!this.context) {
      const read = new ConfigurationReader(this.outputs.profiles).read({ sourceId: 'expec.json', text: JSON.stringify({
        formatVersion: 1, version: '0.1.0', build: { entries: ['main.expec'] }, project: { root: this.root },
      }) });
      if (!read.value) throw new Error('Invalid project fixture: ' + JSON.stringify(read));
      const connected = await new ProjectConnector(join(this.root, 'expec.json')).connect(read.value);
      if (connected.value?.status !== 'connected') throw new Error('Invalid project fixture: ' + JSON.stringify(connected));
      this.context = connected.value.context;
    }
    return this.context;
  }
  async output(id = 'markdown'): Promise<Output> {
    const existing = this.opened.get(id);
    if (existing) return existing;
    const context = await this.connect(), opened = this.outputs.open(id, { directory: id === 'markdown' ? 'docs/specification' : 'docs/contracts' }, context, new FileProjectWriter(context));
    if (!opened.value) throw new Error('Invalid output fixture: ' + JSON.stringify(opened));
    this.opened.set(id, opened.value); return opened.value;
  }
  private compile(): Specification {
    const models = [...(this.sources.size ? this.sources : new Map([[this.entry, this.text]]))].map(([locator, text]) => {
      const read = new LangiumReader().read({ sourceId: locator, text });
      if (read.status !== 'accepted') throw new Error('Invalid acceptance grammar: ' + JSON.stringify(read.diagnostics));
      return new LangiumModel(locator, read.document);
    });
    const entry = models.find(model => model.locator === this.entry)!;
    const resolution = new SourceComposer((owner, authored) => authored.startsWith('./') || authored.startsWith('../') ? posix.normalize(posix.join(posix.dirname(owner), authored)) : authored).compose(entry, { packages: this.packages,
      modules: [...models.filter(model => model !== entry), ...[...this.external].map(([locator, definitions]) => new ExternalModel(locator, definitions))] });
    const result = new Compiler().compile({ resolution });
    if (!result.value) throw new Error('Invalid acceptance source: ' + JSON.stringify(result));
    return result.value;
  }
  identify(): void {
    if (!this.dirty && this.current) return;
    const specification = this.compile(), fresh = new SpecificationIdentity(() => 'lookup-' + ++this.sequence).associate(specification).value!;
    const decisions: IdentityDecision[] = this.decisions.map(decision => {
      const id = decision.examples ? this.examplesId(decision.from, this.current) : this.id(decision.from, this.current);
      this.originalIds.set(decision.from, id);
      return decision.to ? { id, to: fresh.node(decision.examples ? this.examplesId(decision.to, fresh) : this.id(decision.to, fresh)) } : { retire: id };
    });
    this.previous = this.current;
    const result = this.identity.associate(specification, this.previous?.baseline, decisions);
    if (!result.value) throw new Error('Invalid acceptance identity: ' + JSON.stringify(result));
    this.current = result.value; this.diff = this.identity.compare(this.previous?.baseline, this.current).value!;
    this.decisions = []; this.dirty = false;
  }
  id(name: string, current = this.current): string {
    const path = (id: string): string => {
      const record = current.baseline.elements.find(record => record.id === id)!;
      return [record.address.owner ? path(record.address.owner) : '', record.address.name ?? ''].filter(Boolean).join('.');
    };
    const candidates = current.baseline.elements.filter(record => path(record.id) === name || record.address.name === name);
    const exact = candidates.find(record => path(record.id) === name);
    if (exact) return exact.id;
    if (candidates.length !== 1) throw new Error('Expected one fixture subject ' + name + ', received ' + candidates.length);
    return candidates[0]!.id;
  }
  private examplesId(name: string, current: IdentifiedSpecification): string {
    let record = current.baseline.elements.find(record => record.id === this.id(name, current))!;
    while (record.address.kind !== 'examples') record = current.baseline.elements.find(candidate => candidate.id === record.address.owner)!;
    return record.id;
  }
  rename(from: string, to: string): void { this.decisions.push({ from, to }); }
  retire(name: string): void { this.decisions.push({ from: name }); }
  preserveExamples(name: string): void { this.decisions.push({ from: name, to: name, examples: true }); }
  async mutate(operation: 'create' | 'insert' | 'update', id = 'markdown'): Promise<void> {
    this.identify(); const output = await this.output(id);
    this.before = this.files(); this.selected = id;
    this.written = await (operation === 'create' ? output.create(this.current) : output[operation](this.diff, this.current));
    this.problems = [...this.written.problems];
  }
  async delete(name: string): Promise<void> {
    const output = await this.output(); this.before = this.files();
    this.written = await output.delete(this.id(name)); this.problems = [...this.written.problems];
  }
  async read(name: string): Promise<void> {
    this.readResult = await (await this.output()).read(this.id(name)); this.problems = [...this.readResult.problems];
  }
  async search(name: string, id = 'markdown'): Promise<void> {
    this.selected = id; this.searchResult = await (await this.output(id)).search(this.id(name)); this.problems = [...this.searchResult.problems];
  }
  async planUpdate(): Promise<void> {
    this.identify(); const context = await this.connect(); this.before = this.files();
    this.plan = await (await this.output()).plan({ operation: 'update', current: this.current, diff: this.diff }, await context.readSnapshot());
    this.problems = [...this.plan.problems];
  }
  async applyPlan(): Promise<void> {
    if (!this.plan.value) throw new Error('No prepared plan: ' + JSON.stringify(this.plan));
    const receipt = await new FileProjectWriter(await this.connect()).apply(this.plan.value);
    this.written = { receipt, problems: receipt.problems, ...(receipt.status === 'stopped' ? {} : { artifacts: this.plan.value.artifacts }) };
    this.problems = [...this.written.problems];
  }
  path(path: string): string {
    const target = resolve(this.root, path), inside = relative(this.root, target);
    if (isAbsolute(inside) || inside === '..' || inside.startsWith('..' + sep)) throw new Error('Fixture path escapes project');
    return target;
  }
  paths(): string[] {
    const visit = (directory: string): string[] => readdirSync(this.path(directory), { withFileTypes: true }).flatMap(item =>
      item.isDirectory() ? visit(directory ? directory + '/' + item.name : item.name) : [directory ? directory + '/' + item.name : item.name]);
    return visit('').sort();
  }
  files(): string {
    return JSON.stringify(this.paths().map(path => { const file = statSync(this.path(path), { bigint: true });
      return { path, bytes: this.bytes(path).toString('base64'), mtime: file.mtimeNs.toString() }; }));
  }
  bytes(path: string): Buffer { return readFileSync(this.path(path)); }
  textAt(path: string): string { return this.bytes(path).toString('utf8'); }
  async write(path: string, text: string | Uint8Array): Promise<void> { await fs.mkdir(dirname(this.path(path)), { recursive: true }); await fs.writeFile(this.path(path), text); }
  async append(path: string, text: string | Uint8Array): Promise<void> { await fs.appendFile(this.path(path), text); }
  async replace(path: string, before: string, after: string): Promise<void> {
    const text = this.textAt(path); if (!text.includes(before)) throw new Error('Fixture edit did not find ' + before);
    await this.write(path, text.replace(before, after));
  }
  statePath(): string { return '.expec/outputs/' + Buffer.from('markdown').toString('hex') + '.json'; }
  async removeState(): Promise<void> { await fs.unlink(this.path(this.statePath())); }
  marker(name: string, outputId = 'markdown', kind = 'section'): string { return '<!-- expec-' + kind + ':' + Buffer.from(JSON.stringify({ outputId, specId: this.id(name) })).toString('hex') + ' -->'; }
  end(name: string): string { return '<!-- expec-end:' + Buffer.from(this.id(name)).toString('hex') + ' -->'; }
  fileFor(name: string, outputId = 'markdown'): string {
    const marker = this.marker(name, outputId);
    const files = this.paths().filter(path => /\.md$/.test(path) && (this.textAt(path).includes(marker) || this.textAt(path).includes(this.marker(name, outputId, 'fragment'))));
    if (files.length !== 1) throw new Error('Expected one rendered file for ' + name + ': ' + files.join(', '));
    return files[0]!;
  }
  section(name: string, outputId = 'markdown'): string {
    const text = this.textAt(this.fileFor(name, outputId)), start = text.indexOf(text.includes(this.marker(name, outputId)) ? this.marker(name, outputId) : this.marker(name, outputId, 'fragment')), end = text.indexOf(this.end(name), start);
    if (end < 0) throw new Error('Missing rendered section end for ' + name); return text.slice(start, end);
  }
  notes(name: string): string {
    const text = this.textAt(this.fileFor(name)), end = text.indexOf(this.end(name)) + this.end(name).length;
    return text.slice(end).replace(/^\r?\n\r?\n/, '');
  }
  async replaceNotes(name: string, text: string): Promise<void> {
    const path = this.fileFor(name), current = this.textAt(path), end = current.indexOf(this.end(name)) + this.end(name).length;
    await this.write(path, current.slice(0, end) + '\n\n' + text);
  }
  async linkInNotes(owner: string, label: string, target: string): Promise<void> {
    const path = this.fileFor(owner), targetPath = this.fileFor(target), href = relative(dirname(path), targetPath).split(sep).map(encodeURIComponent).join('/');
    await this.append(path, '\n[' + label + '](' + href + '#expec-' + Buffer.from(this.id(target)).toString('hex') + ')\n');
  }
  failStateWrite(): void {
    const original = fs.open.bind(fs);
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      if (String(path) === this.path(this.statePath()) && (flags === 'r+' || flags === 'wx')) throw Object.assign(new Error('Injected Markdown state failure'), { code: 'EACCES' });
      return original(path, flags, mode);
    });
    this.restore = () => spy.mockRestore();
  }
  restoreWrites(): void { this.restore?.(); this.restore = undefined; }
  async dispose(): Promise<void> {
    this.restoreWrites(); const child = relative(this.temporary, this.root);
    if (isAbsolute(child) || child.includes(sep) || !child.startsWith('expec-markdown-')) throw new Error('Unexpected fixture root');
    await fs.rm(this.root, { recursive: true, force: true });
  }
}
