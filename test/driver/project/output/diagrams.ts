import { promises as fs, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { D2, type CompileResponse } from '@d2lang/d2';
import { vi } from 'vitest';
import workers from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import { Compiler, ConfigurationReader, FileProjectWriter, Outputs, ProjectConnector, SpecificationIdentity, umlOutput, LangiumModel, LangiumReader, SourceComposer, ExternalModel,
  reconcileRelationships, type ProjectRead, type ProjectSearch, type Reconciliation, type OutputPlan, type Check, type Diagnostic,
  type IdentifiedSpecification, type Output, type OutputWrite, type ProjectContext, type SpecDiff, type Specification, type BuiltinName, type Item } from '../../../../src/index.js';

export class DiagramDriver {
  private readonly temporary = realpathSync.native(tmpdir());
  readonly directory = realpathSync.native(mkdtempSync(join(this.temporary, 'expec-diagrams-')));
  readonly root = join(this.directory, 'project');
  readonly outputs = new Outputs();
  readonly identity = new SpecificationIdentity(() => 'diagram-id-' + ++this.nextId);
  private nextId = 0;
  context!: ProjectContext;
  output!: Output;
  current!: IdentifiedSpecification;
  diff!: SpecDiff;
  written!: OutputWrite;
  found!: ProjectSearch;
  reading!: ProjectRead;
  comparison!: Reconciliation;
  before = new Map<string, string>();
  after = new Map<string, string>();
  bytes = new Map<string, Uint8Array>();
  findings: readonly Diagnostic[] = [];
  planned!: Check<OutputPlan>;
  private restoreWrite: (() => void) | undefined;
  readonly deniedResources: string[] = [];
  private restoreResources: (() => void) | undefined;
  fresh?: DiagramDriver;
  native = new Map<string, CompileResponse>();
  roles = new Map<string, string>();
  texts = new Map<string, string>();
  readonly sourceFiles: Record<string, string> = {};
  readonly external: ExternalModel[] = [];
  pending: { text: string; retired: string[] } | undefined;
  readonly renames = new Map<string, string>();
  readonly remembered = new Map<string, unknown>();
  async initialize(): Promise<void> {
    await fs.mkdir(this.root); this.outputs.register(umlOutput);
    const settings = new ConfigurationReader(this.outputs.profiles).read({ sourceId: 'manifest', text: JSON.stringify({
      formatVersion: 1, version: '0.1.0', build: { entries: ['game.expec'] }, project: { root: 'project' },
    }) });
    if (!settings.value) throw new Error(JSON.stringify(settings));
    const connection = await new ProjectConnector(join(this.directory, 'expec.json')).connect(settings.value);
    if (connection.value?.status !== 'connected') throw new Error(JSON.stringify(connection));
    this.context = connection.value.context;
  }
  specify(text: string, retired: string[] = []): void {
    const checked = new Compiler().compile({ locator: 'game', source: { sourceId: 'game.expec', text }, dependencies: { modules: [], packages: [] } });
    if (!checked.value) throw new Error('Invalid acceptance source: ' + JSON.stringify(checked));
    this.identify(checked.value, retired);
  }
  private identify(specification: Specification, retired: string[] = []): void {
    const qualified = (node: Item): string => {
      const owner = specification.inspection.parent(node.id), name = 'name' in node ? node.name : node.kind === 'interaction' ? node.title.value : '';
      const prefix = owner ? qualified(owner) : ''; return prefix && name ? prefix + '.' + name : name || prefix;
    };
    const nodes = (node: Item): Item[] => [node, ...[...specification.inspection.children(node.id)].flatMap(nodes)];
    const all = [...specification.inspection.roots()].flatMap(nodes);
    const decisions = [...retired.map(name => ({ retire: this.identifier(name) })), ...[...this.renames].map(([before, after]) => {
      const node = all.find(node => qualified(node) === after && ('name' in node || node.kind === 'interaction'));
      if (!node) throw new Error('Missing new identity target ' + after); return { id: this.identifier(before), to: node.id };
    })];
    const identified = this.identity.associate(specification, this.current?.baseline, decisions);
    if (!identified.value) throw new Error(JSON.stringify(identified));
    this.diff = this.identity.compare(this.current?.baseline, identified.value).value!; this.current = identified.value; this.renames.clear();
  }
  identifier(name: string): string {
    const records = this.current.baseline.elements;
    const qualified = (id: string): string => { const record = records.find(item => item.id === id)!; return (record.address.owner ? qualified(record.address.owner) + '.' : '') + record.address.name; };
    const found = records.find(record => qualified(record.id) === name); if (!found) throw new Error('Unknown subject ' + name); return found.id;
  }
  async create(options: { views: string[] }): Promise<void> {
    const opened = this.outputs.open('uml', { directory: 'design', ...options }, this.context, new FileProjectWriter(this.context));
    if (!opened.value) throw new Error(JSON.stringify(opened)); this.output = opened.value;
    await this.captureBefore(); this.written = await this.output.create(this.current); this.findings = this.written.problems; await this.inspectNative();
  }
  async update(): Promise<void> {
    if (this.pending) { this.specify(this.pending.text, this.pending.retired); this.pending = undefined; }
    await this.captureBefore(); this.written = await this.output.update(this.diff, this.current); this.findings = this.written.problems; await this.inspectNative();
  }
  async captureBefore(): Promise<void> { this.before = new Map((await this.context.readSnapshot()).files.map(file => [file.path, file.version])); }
  async search(name: string): Promise<void> { await this.captureBefore(); this.found = await this.output.search(this.identifier(name)); this.findings = this.found.problems; await this.captureAfter(); }
  async read(name: string): Promise<void> { await this.captureBefore(); this.reading = await this.output.read(this.identifier(name)); this.findings = this.reading.problems; await this.captureAfter(); }
  async captureAfter(): Promise<void> { this.after = new Map((await this.context.readSnapshot()).files.map(file => [file.path, file.version])); }
  async delete(name: string): Promise<void> { await this.captureBefore(); this.written = await this.output.delete(this.identifier(name)); this.findings = this.written.problems; await this.inspectNative(); }
  async append(path: string, value: string | Uint8Array): Promise<void> { await fs.appendFile(join(this.root, path), value); await this.captureBytes(); }
  async captureBytes(): Promise<void> { this.bytes = new Map((await this.context.readSnapshot()).files.map(file => [file.path, file.bytes])); this.texts = new Map([...this.bytes].map(([path, bytes]) => [path, Buffer.from(bytes).toString()])); }
  async insert(): Promise<void> {
    if (this.pending) { this.specify(this.pending.text, this.pending.retired); this.pending = undefined; }
    await this.captureBefore(); this.written = await this.output.insert(this.diff, this.current); this.findings = this.written.problems; await this.inspectNative();
  }
  async plan(): Promise<void> {
    if (this.pending) { this.specify(this.pending.text, this.pending.retired); this.pending = undefined; }
    await this.captureBefore(); this.planned = await this.output.plan({ operation: 'update', diff: this.diff, current: this.current }, await this.context.readSnapshot());
    this.findings = this.planned.problems; await this.captureAfter();
  }
  async apply(): Promise<void> {
    if (!this.planned.value) throw new Error(JSON.stringify(this.planned));
    const receipt = await new FileProjectWriter(this.context).apply(this.planned.value); this.written = { receipt, problems: receipt.problems }; this.findings = receipt.problems; await this.inspectNative();
  }
  failWrite(path: string): void {
    const original = fs.open.bind(fs), target = resolve(this.root, path);
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      if (resolve(String(file)) === target && String(flags).includes('w')) throw Object.assign(new Error('Deliberate disk refusal'), { code: 'EACCES' });
      return original(file, flags, mode);
    });
    this.restoreWrite = () => spy.mockRestore();
  }
  restoreWrites(): void { this.restoreWrite?.(); this.restoreWrite = undefined; }
  denyResources(): void {
    const denied = (name: string): never => { this.deniedResources.push(name); throw Error('Diagram resource denied: ' + name); };
    const Worker = workers.Worker, observations = this.deniedResources;
    const spy = vi.spyOn(workers, 'Worker').mockImplementation(class extends Worker {
      constructor(file: string | URL, options: workers.WorkerOptions = {}) {
        super(file, { ...options, execArgv: [...process.execArgv, '--import', new URL('../../../resources/diagrams/resource-guard.mjs', import.meta.url).href] });
        this.on('message', message => { if (message.expecResourceDenied) observations.push(message.expecResourceDenied); });
      }
    });
    const spies = [vi.spyOn(globalThis, 'fetch').mockImplementation(() => denied('fetch')), vi.spyOn(http, 'request').mockImplementation(() => denied('http')),
      vi.spyOn(https, 'request').mockImplementation(() => denied('https'))]; syncBuiltinESMExports();
    this.restoreResources = () => { spy.mockRestore(); spies.forEach(spy => spy.mockRestore()); syncBuiltinESMExports(); };
  }
  async renderFresh(): Promise<void> {
    const fresh = this.fresh = new DiagramDriver(); await fresh.initialize(); fresh.current = this.current; fresh.diff = this.diff; await fresh.create({ views: ['structure'] });
  }
  async write(path: string, text: string): Promise<void> { await fs.mkdir(dirname(join(this.root, path)), { recursive: true }); await fs.writeFile(join(this.root, path), text); this.texts.set(path, text); }
  async independent(path: string, reference: { key: string; subject: string }, source: string): Promise<void> {
    const mark = '# expec-uml: ' + Buffer.from(JSON.stringify({ format: 1, outputId: 'uml', reference: this.identifier(reference.subject) })).toString('base64url');
    const text = source.replace(reference.key + ':', mark + '\n' + reference.key + ':');
    if (text === source) throw new Error('Reference statement absent from independent fixture');
    await this.write(path, text); this.remembered.set(path, text);
  }
  nativeKey(name: string): string {
    const id = this.identifier(name);
    for (const native of this.native.values()) {
      let selected = false;
      for (const node of native.graph.ast.nodes as { comment?: { value: string }; map_key?: { key?: { path?: { unquoted_string?: { value: { string: string }[] } }[] } } }[]) {
        for (const line of node.comment?.value.split('\n') ?? []) if (line.startsWith('expec-uml: ')) selected = JSON.parse(Buffer.from(line.slice(11), 'base64url').toString()).definition === id;
        if (node.map_key && selected) return node.map_key.key!.path![0]!.unquoted_string!.value.map(part => part.string).join('');
        if (node.map_key) selected = false;
      }
    }
    throw new Error('No actual native declaration ' + name);
  }
  async changeEndpoint(owner: string, target: string, replacement: { key: string; label: string }): Promise<void> {
    const path = 'design/structure.d2', from = this.nativeKey(owner), to = this.nativeKey(target), text = this.texts.get(path)!;
    const before = from + ' -> ' + to, after = from + ' -> ' + replacement.key;
    if (!text.includes(before)) throw new Error('Actual dependency edge is missing');
    await this.write(path, text.replace(before, after) + '\n' + replacement.key + ': ' + JSON.stringify(replacement.label) + '\n');
  }
  async replaceMember(before: string, after: string): Promise<void> {
    const path = 'design/structure.d2', text = this.texts.get(path)!, actual = text.includes(before) ? before : before.replace(/: Nothing$/, ': "Nothing"');
    if (!text.includes(actual)) throw new Error('Actual member statement is missing'); await this.write(path, text.replace(actual, after));
  }
  async compare(name: string, expected: string[]): Promise<void> {
    await this.search(name); const result = reconcileRelationships(this.current, expected.map(name => this.identifier(name)), this.found.outgoing);
    if (!result.value) throw new Error(JSON.stringify(result)); this.comparison = result.value;
  }
  async createFrom(entry: string, options: { views: string[] }): Promise<void> {
    const models = Object.entries(this.sourceFiles).map(([locator, text]) => {
      const result = new LangiumReader().read({ sourceId: locator, text });
      if (result.status !== 'accepted') throw new Error(JSON.stringify(result)); return new LangiumModel(locator, result.document);
    });
    const resolution = new SourceComposer((owner, text) => text.startsWith('./') ? join(dirname(owner), text).replaceAll('\\', '/') : text)
      .compose(models.find(model => model.locator === entry)!, { modules: [...models.filter(model => model.locator !== entry), ...this.external], packages: [] });
    const result = new Compiler().compile({ resolution }); if (!result.value) throw new Error(JSON.stringify(result));
    this.identify(result.value); await this.create(options);
  }
  externalRecord(module: string, name: string, fields: string[]): void {
    this.external.push(new ExternalModel(module, [{ kind: 'record-type', name, fields: fields.map(field => {
      const [name, type] = field.split(': '); return { kind: 'field', name: name!, type: { kind: 'builtin', name: type as BuiltinName } };
    }) }]));
  }
  async inspectNative(): Promise<void> {
    this.native.clear(); this.roles.clear(); const snapshot = await this.context.readSnapshot();
    this.after = new Map(snapshot.files.map(file => [file.path, file.version]));
    this.bytes = new Map(snapshot.files.map(file => [file.path, file.bytes]));
    const files = Object.fromEntries(snapshot.files.filter(file => file.path.endsWith('.d2')).map(file => [file.path, Buffer.from(file.bytes).toString('utf8')]));
    this.texts = new Map(snapshot.files.map(file => [file.path, Buffer.from(file.bytes).toString('utf8')]));
    if (!Object.keys(files).length) return;
    const engine = new D2();
    try { for (const inputPath of Object.keys(files)) {
      let compiled: CompileResponse; try { compiled = await engine.compile({ fs: files, inputPath }); } catch { continue; } this.native.set(inputPath, compiled);
      let role: string | undefined;
      for (const node of compiled.graph.ast.nodes as { comment?: { value: string }; map_key?: { edges?: unknown[]; value?: { double_quoted_string?: { value: { string: string }[] } } } }[]) {
        for (const line of node.comment?.value.split('\n') ?? []) if (line.startsWith('expec-uml: ')) role = (JSON.parse(Buffer.from(line.slice(11), 'base64url').toString('utf8')) as { edge?: { role: string } }).edge?.role;
        if (node.map_key?.edges && role) this.roles.set(node.map_key.value?.double_quoted_string?.value.map(part => part.string).join('') ?? '', role);
        if (node.map_key) role = undefined;
      }
    } }
    finally { await engine.dispose(); }
  }
  async dispose(): Promise<void> {
    this.restoreWrites(); this.restoreResources?.(); await this.fresh?.dispose();
    const path = resolve(this.directory), child = relative(this.temporary, path);
    if (!child || child.startsWith('..' + sep) || child === '..' || !path.startsWith(this.temporary + sep)) throw new Error('Unsafe fixture cleanup');
    await fs.rm(path, { recursive: true, force: true });
  }
}
