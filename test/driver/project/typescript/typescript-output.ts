import { promises as fs, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ts from 'typescript';
import { vi } from 'vitest';
import { Compiler, ConfigurationReader, FileProjectWriter, LangiumModel, LangiumReader, Outputs, ProjectConnector, SourceComposer, SourceLoader, SpecificationIdentity, typescriptOutput,
  type Check, type Diagnostic, type IdentifiedSpecification, type IdentityDecision, type Item, type ModuleModel, type Output, type OutputContext, type OutputWrite,
  type ProjectContext, type ProjectRead, type ProjectSearch, type SpecDiff, type Specification } from '../../../../src/index.js';

/** Actual checked language, project writes, native TypeScript analysis and Node execution. */
export class TypeScriptOutputDriver {
  readonly temporary = realpathSync.native(tmpdir());
  readonly directory = realpathSync.native(mkdtempSync(join(this.temporary, 'expec-ts-output-')));
  readonly root = join(this.directory, 'project');
  readonly outputs = new Outputs();
  readonly identity = new SpecificationIdentity(() => 'typescript-example-' + ++this.next);
  private next = 0;
  readonly libraries: ModuleModel[] = [];
  readonly libraryBefore: string[] = [];
  readonly packages: { alias: string; phases: ('build' | 'runtime' | 'test')[] }[] = [];
  context!: ProjectContext;
  membership?: OutputContext;
  callerContext: OutputContext | undefined;
  current!: IdentifiedSpecification;
  previous!: IdentifiedSpecification;
  diff!: SpecDiff;
  output!: Output;
  opened!: Check<Output>;
  written?: OutputWrite;
  readResult!: ProjectRead;
  searchResult!: ProjectSearch;
  text = '';
  options: Record<string, unknown> = { directory: 'src' };
  beforeModel = '';
  openedCount = 0;
  files = new Map<string, string>();
  rootEntries: string[] = [];
  remembered = new Map<string, string>();
  rememberedFile?: { path: string; text: string };
  originalIds = new Map<string, string>();
  nativeDiagnostics: { code: string; text: string; message: string }[] = [];
  runtime = { stdout: '', stderr: '', code: 0 };
  restoreFailure: (() => void) | undefined;
  constructor() {
    this.outputs.register({ ...typescriptOutput, open: (options, context) => { this.openedCount++; return typescriptOutput.open(options, context); } });
  }
  async initialize(): Promise<void> {
    await fs.mkdir(this.root);
    const configuration = this.configuration();
    const connected = await new ProjectConnector(join(this.directory, 'expec.json')).connect(configuration);
    if (connected.value?.status !== 'connected') throw new Error(JSON.stringify(connected));
    this.context = connected.value.context;
  }
  configuration(entries = ['main.expec']) {
    const configuration = new ConfigurationReader(this.outputs.profiles).read({ sourceId: join(this.directory, 'expec.json'), text: JSON.stringify({
      formatVersion: 1, version: '0.1.0', project: { root: 'project' }, build: { entries },
      libraries: this.libraries.map(model => ({ module: model.locator, version: '*' })),
    }) });
    if (!configuration.value) throw new Error(JSON.stringify(configuration)); return configuration.value;
  }
  model(locator: string, text: string): ModuleModel {
    const read = new LangiumReader().read({ sourceId: locator + '.expec', text });
    if (read.status !== 'accepted') throw new Error('Invalid acceptance source: ' + JSON.stringify(read));
    return new LangiumModel(locator, read.document);
  }
  libraryState(model: ModuleModel): string {
    const read = (id: ReturnType<ModuleModel['roots']>[number]): unknown => ({ node: model.node(id), children: model.children(id).map(read) });
    return JSON.stringify(model.roots().map(read));
  }
  compile(text: string): Specification {
    const result = new Compiler().compile({ resolution: new SourceComposer().compose(this.model('main', text), { modules: this.libraries, packages: this.packages }) });
    if (!result.value) throw new Error('Invalid acceptance source: ' + JSON.stringify(result)); return result.value;
  }
  identify(specification: Specification, decisions: IdentityDecision[] = [], reuse = false): void {
    const result = this.identity.associate(specification, reuse ? this.current.baseline : undefined, decisions);
    if (!result.value) throw new Error(JSON.stringify(result));
    this.previous = this.current; this.current = result.value;
    this.diff = this.identity.compare(reuse ? this.previous.baseline : undefined, this.current).value!;
    this.beforeModel = JSON.stringify({ baseline: this.current.baseline, roots: [...specification.inspection.roots()] });
  }
  source(text: string): void { this.text = text; this.identify(this.compile(text)); }
  async workspace(files: Record<string, string>): Promise<void> {
    for (const [path, text] of Object.entries(files)) { const target = join(this.directory, path); await fs.mkdir(dirname(target), { recursive: true }); await fs.writeFile(target, text); }
    const loaded = await new SourceLoader(join(this.directory, 'expec.json')).load(this.configuration(['main.expec']), { modules: this.libraries, packages: this.packages });
    if (!loaded.value) throw new Error(JSON.stringify(loaded));
    this.membership = { workspaceModules: loaded.captures.flatMap(capture => capture.model ? [capture.model.locator] : []) };
    const entry = loaded.value.entries[0]!, result = new Compiler().compile({ resolution: new SourceComposer(loaded.value.locate).compose(entry.entry, entry.dependencies) });
    if (!result.value) throw new Error(JSON.stringify(result)); this.identify(result.value);
  }
  subject(name: string, current = this.current): string {
    const path = (id: string): string => { const record = current.baseline.elements.find(item => item.id === id)!;
      return (record.address.owner ? path(record.address.owner) + '.' : '') + record.address.name; };
    const found = current.baseline.elements.find(record => path(record.id) === name);
    if (!found) throw new Error('No subject ' + name); return found.id;
  }
  item(name: string): Item { return this.current.specification.inspection.read(this.current.node(this.subject(name))); }
  change(text: string, decisions: { rename?: Record<string, string> } = {}): void {
    const specification = this.compile(text), identified = this.identity.associate(specification);
    if (!identified.value) throw new Error(JSON.stringify(identified));
    const changes = Object.entries(decisions.rename ?? {}).map(([from, to]) => {
      const id = this.subject(from); this.originalIds.set(from, id); return { id, to: identified.value!.node(this.subject(to, identified.value)) };
    });
    this.text = text; this.identify(specification, changes, true);
  }
  open(options: Record<string, unknown>, membership = this.membership): void {
    this.options = options; this.callerContext = membership;
    this.opened = this.outputs.open('typescript', options, this.context, new FileProjectWriter(this.context), membership);
    if (this.opened.value) this.output = this.opened.value;
  }
  async create(options: Record<string, unknown>): Promise<void> { this.open(options); await this.createOpened(); }
  async createOpened(): Promise<void> { this.written = this.opened.value ? await this.output.create(this.current) : { problems: this.opened.problems }; await this.capture(); }
  async update(): Promise<void> { this.written = await this.output.update(this.diff, this.current); await this.capture(); }
  async insert(): Promise<void> { this.written = await this.output.insert(this.diff, this.current); await this.capture(); }
  async delete(name: string): Promise<void> { this.written = await this.output.delete(this.subject(name)); await this.capture(); }
  async read(name: string): Promise<void> { this.readResult = await this.output.read(this.subject(name)); }
  async search(name: string): Promise<void> { this.searchResult = await this.output.search(this.subject(name)); }
  get problems(): readonly Diagnostic[] { return this.written?.problems ?? this.opened?.problems ?? []; }
  async file(path: string, text: string): Promise<void> { await fs.mkdir(dirname(join(this.root, path)), { recursive: true }); await fs.writeFile(join(this.root, path), text); await this.capture(); }
  async append(path: string, text: string): Promise<void> { await fs.appendFile(join(this.root, path), text); await this.capture(); }
  async capture(): Promise<void> {
    this.files = new Map((await this.context.readSnapshot()).files.map(file => [file.path, Buffer.from(file.bytes).toString('utf8')]));
    this.rootEntries = await fs.readdir(this.root);
  }
  nativeFiles(): ts.SourceFile[] { return [...this.files].filter(([path]) => path.endsWith('.ts')).map(([path, text]) => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)); }
  native(name: string): ts.Declaration | undefined {
    const names = name.split('.'); let nodes: readonly ts.Node[] = this.nativeFiles().flatMap(file => [...file.statements]);
    for (const [index, part] of names.entries()) {
      const found = nodes.find(node => 'name' in node && node.name && (node.name as ts.Node).getText().replace(/^["']|["']$/g, '') === part);
      if (!found) return undefined;
      if (index === names.length - 1) return found as ts.Declaration;
      nodes = ts.isClassDeclaration(found) || ts.isInterfaceDeclaration(found) ? found.members : ts.isTypeAliasDeclaration(found) && ts.isTypeLiteralNode(found.type) ? found.type.members : [];
    }
    return undefined;
  }
  async check(consumer?: string, emit = false): Promise<string> {
    if (consumer !== undefined) await this.file('consumer.ts', consumer);
    const destination = join(this.directory, 'runtime'), roots = [...this.files.keys()].filter(path => path.endsWith('.ts')).map(path => join(this.root, path));
    const program = ts.createProgram(roots, { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, outDir: destination, noEmit: !emit, skipLibCheck: true });
    this.nativeDiagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => ({ code: 'typescript-' + diagnostic.code,
      text: diagnostic.file?.text.slice(diagnostic.start, (diagnostic.start ?? 0) + (diagnostic.length ?? 0)) ?? '',
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') }));
    if (emit && !this.nativeDiagnostics.length) { program.emit(); await fs.writeFile(join(destination, 'package.json'), '{"type":"module"}'); }
    return destination;
  }
  async run(consumer: string): Promise<void> {
    const destination = await this.check(consumer, true);
    if (this.nativeDiagnostics.length) { this.runtime = { stdout: '', stderr: JSON.stringify(this.nativeDiagnostics), code: -1 }; return; }
    try { const result = await promisify(execFile)(process.execPath, [join(destination, 'consumer.js')], { timeout: 10_000 }); this.runtime = { ...result, code: 0 }; }
    catch (error) { const result = error as { stdout: string; stderr: string; code: number }; this.runtime = { stdout: result.stdout, stderr: result.stderr, code: result.code }; }
  }
  failStateWrite(): void {
    const open = fs.open.bind(fs), path = join(this.root, '.expec', 'outputs', Buffer.from('typescript').toString('hex') + '.json');
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      if (String(file) === path && ['wx', 'r+'].includes(String(flags))) throw Object.assign(new Error('State write refused by fixture'), { code: 'EACCES' });
      return open(file, flags, mode);
    }); this.restoreFailure = () => spy.mockRestore();
  }
  async dispose(): Promise<void> {
    this.restoreFailure?.(); const path = relative(this.temporary, this.directory);
    if (isAbsolute(path) || path.includes(sep) || !path.startsWith('expec-ts-output-') || resolve(this.temporary, path) !== this.directory) throw new Error('Unsafe fixture cleanup');
    await fs.rm(this.directory, { recursive: true, force: true });
  }
}
