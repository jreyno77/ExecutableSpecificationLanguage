import childProcess from 'node:child_process';
import { vi } from 'vitest';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  Compiler, ConfigurationReader, DependencyPlanner, LangiumModel, LangiumReader, SourceComposer, SourceLoader, requirementsFor,
  type Check, type Compilation, type Configuration, type Diagnostic, type ModuleModel, type ProblemLocation,
  type ScopedPackageRequirement, type SourceCapture, type SourceLoad,
} from '../../../../src/index.js';
import { ScopedCliDriver } from './scoped-cli.js';

type CurrentCapture = { source: { sourceId: string; text: string }; version: string | number; model: ModuleModel; localPath?: string };

/** Supplies actual source files or captured current models, then observes returned scoped facts. */
export class ScopedRequirementsDriver {
  private readonly manifest: Record<string, unknown>;
  private readonly explicitBuild: boolean;
  private readonly sources = new Map<string, string>();
  private readonly outsideSources = new Map<string, string>();
  private readonly editors = new Map<string, CurrentCapture>();
  private configured: Check<Configuration> | undefined;
  private loaded: SourceLoad | undefined;
  private compiled: Compilation | undefined;
  private planned: ReturnType<DependencyPlanner['resolve']> | undefined;
  private mapped: ReturnType<typeof requirementsFor> | undefined;
  private current: ReturnType<typeof requirementsFor> | undefined;
  private previousCurrent: readonly ScopedPackageRequirement[] = [];
  private currentCaptures: readonly CurrentCapture[] = [];
  private currentCompiled: Compilation | undefined;
  private temporary: string | undefined;
  private directory: string | undefined;
  private cli: ScopedCliDriver | undefined;
  private beforeCommands: string | undefined;
  private arranged = false;
  private nativeStarts = 0;
  private readonly restoreNative: () => void;
  constructor(settings: Readonly<Record<string, unknown>>) {
    this.explicitBuild = settings.build !== undefined;
    this.manifest = { formatVersion: 1, version: '0.1.0', build: { entries: ['src/core/store.expec'] }, ...structuredClone(settings) };
    const spawned = vi.spyOn(childProcess, 'spawn').mockImplementation(() => { this.nativeStarts++; throw new Error('Scoped metadata must not start a native process.'); });
    this.restoreNative = () => spawned.mockRestore();
  }
  source(path: string, text: string): void { this.sources.set(path, text); }
  outsideSource(path: string, text: string): void { this.outsideSources.set(path, text); }
  readConfiguration(): void {
    this.configured = new ConfigurationReader([]).read({ sourceId: this.sourceId(), text: this.manifestText() });
  }
  configurationAccepted(): boolean { return accepted(this.configurationReport()); }
  configurationFindings() { return this.configurationReport().problems.map(problem => this.manifestFinding(problem)); }
  finding(code: string) { const problem = this.configurationReport().problems.find(problem => problem.code === code); return problem && this.manifestFinding(problem); }
  async check(): Promise<void> {
    await this.arrangeFiles(); this.readConfiguration(); this.loaded = undefined; this.compiled = undefined;
    const configuration = this.configurationReport().value;
    if (!configuration) return;
    this.loaded = await new SourceLoader(this.manifestFilename()).load(configuration, {
      modules: [], packages: configuration.packages.map(({ alias, phases }) => ({ alias, phases })),
    });
    if (this.loaded.value) this.compiled = new Compiler().compile({ resolution: new SourceComposer(this.loaded.value.locate).compose(this.loaded.value.entries) });
  }
  compilationAccepted(): boolean { return this.loaded !== undefined && accepted(this.loaded) && this.loaded.syntax.length === 0 && this.compiled !== undefined && accepted(this.compiled) && this.compiled.syntax.length === 0; }
  requirements(path: string): string[] { return this.recordsFor(this.capture(path), this.load().requirements); }
  outsideRequirements(path: string): string[] { return this.requirements(path); }
  capturedRequirements(path: string): string[] { return this.requirements(path); }
  captureLocalPath(path: string): string | undefined { return this.capture(path).localPath; }
  outsideCaptureLocalPath(path: string): string | undefined { return this.capture(path).localPath; }
  requirementOrigins(path: string, alias: string, phase: string) {
    const capture = this.capture(path), record = this.load().requirements.find(record => record.sourceId === capture.source.sourceId && record.alias === alias && record.phase === phase);
    if (!record) throw new Error('No actual effective requirement for this captured source.');
    return [record.at, ...record.related].map(at => this.manifestPath(at));
  }
  explicitRequirements(name: string): string[] {
    const inspection = this.specification().inspection;
    const components = [...inspection.query('component')].filter(component => component.name === name);
    if (components.length !== 1) throw new Error('Expected one actual compiled component ' + name + '.');
    return components[0]!.members.filter(member => member.kind === 'requires-package')
      .map(member => member.locator.value + ':' + (member.phase ?? 'runtime'));
  }
  verifyInventory(packages: readonly { name: string; version: string }[]): void {
    const configuration = this.configurationReport().value;
    if (!configuration) throw new Error('Read a valid configuration before supplying inventory.');
    this.planned = new DependencyPlanner().resolve(configuration, { modules: [], packages });
  }
  inventoryAccepted(): boolean { if (!this.planned) throw new Error('Supply actual inventory first.'); return accepted(this.planned); }
  inventoryFinding(name: string) {
    if (!this.planned) throw new Error('Supply actual inventory first.');
    const configuration = this.configurationReport().value!;
    const index = configuration.packages.findIndex(item => item.name === name);
    const problem = this.planned.problems.find(problem => problem.at.kind === 'dependency'
      && problem.at.path[0] === 'manifest' && problem.at.path[1] === configuration.sourceId && problem.at.path[2] === 'packages' && problem.at.path[3] === index);
    return problem && this.manifestFinding(problem);
  }
  nativeInstallations(): number { return this.nativeStarts + (this.cli?.calls.filter(call => call.args[0] === 'install').length ?? 0); }
  editorSource(path: string, text: string, version: number): void {
    const capture = this.capture(path), source = { sourceId: capture.source.sourceId, text };
    const read = new LangiumReader().read(source);
    if (read.status !== 'accepted') throw new Error('The supplied current source must be grammatical: ' + JSON.stringify(read.diagnostics));
    this.editors.set(source.sourceId, { source, version, model: new LangiumModel(source.sourceId, read.document),
      ...(capture.localPath === undefined ? {} : { localPath: capture.localPath }) });
  }
  async savedRequirements(requirements: unknown): Promise<void> {
    const saved = JSON.parse(await readFile(this.manifestFilename(), 'utf8'));
    saved.requirements = structuredClone(requirements); await writeFile(this.manifestFilename(), JSON.stringify(saved));
  }
  checkCurrent(): void {
    this.readConfiguration(); this.previousCurrent = this.current?.value ?? []; this.currentCompiled = undefined;
    const configuration = this.configurationReport().value;
    if (!configuration) { this.current = undefined; this.currentCaptures = []; return; }
    this.currentCaptures = this.load().captures.map(capture => {
      const edited = this.editors.get(capture.source.sourceId); if (edited) return edited;
      if (!capture.model) throw new Error('An actual current source needs its captured parsed model.');
      return { source: capture.source, version: capture.version, model: capture.model,
        ...(capture.localPath === undefined ? {} : { localPath: capture.localPath }) };
    });
    this.current = requirementsFor(configuration, this.currentCaptures.map(capture => ({ sourceId: capture.source.sourceId,
      ...(capture.localPath === undefined ? {} : { localPath: capture.localPath }) })));
    if (!this.current.value) return;
    const packages = configuration.packages.map(({ alias, phases }) => ({ alias, phases }));
    const entries = this.load().value!.entries.map(row => ({ entry: this.currentCaptures.find(capture => capture.model.locator === row.entry.locator)!.model,
      dependencies: { modules: this.currentCaptures.filter(capture => capture.model.locator !== row.entry.locator).map(capture => capture.model), packages } }));
    this.currentCompiled = new Compiler().compile({ resolution: new SourceComposer(this.load().value!.locate).compose(entries) });
  }
  currentRequirements(path: string): string[] { return this.recordsFor(this.capture(path), this.current?.value ?? []); }
  previousCurrentRequirements(path: string): string[] { return this.recordsFor(this.capture(path), this.previousCurrent); }
  currentSourceVersion(path: string): string | number {
    const capture = this.currentCaptures.find(capture => capture.source.sourceId === this.capture(path).source.sourceId);
    if (!capture) throw new Error('No actual current source capture.'); return capture.version;
  }
  currentDeclarationNames(): string[] {
    if (!this.currentCompiled?.value) throw new Error('No accepted current-source compilation: ' + JSON.stringify(this.currentCompiled));
    return [...this.currentCompiled.value.inspection.roots()].flatMap(item => item.origin.kind === 'source' && 'name' in item ? [item.name] : []);
  }
  savedSource(path: string): string { return readFileSync(this.path(path), 'utf8'); }
  async mapSameCapturedSource(paths: readonly string[]): Promise<void> {
    await this.check(); const capture = this.capture(paths[0]!);
    this.mapped = requirementsFor(this.configurationReport().value!, paths.map(localPath => ({ sourceId: capture.source.sourceId, localPath })));
  }
  requirementMappingAccepted(): boolean { if (!this.mapped) throw new Error('Supply captured source mappings first.'); return accepted(this.mapped); }
  mappingFinding(code: string) {
    if (!this.mapped) throw new Error('Supply captured source mappings first.');
    const problem = this.mapped.problems.find(problem => problem.code === code);
    return problem && { code: problem.code, path: dependencyPath(problem.at), related: problem.related.map(dependencyPath) };
  }
  async supplyNativeInventoryFiles(name: string, version: string): Promise<void> {
    await this.arrangeFiles(); const target = this.target();
    const packages = { '': { name: 'scope-consumer', version: '1.0.0', devDependencies: { [name]: '^3' } },
      ['node_modules/' + name]: { name, version } };
    await mkdir(join(target, 'node_modules', name), { recursive: true });
    await writeFile(join(target, 'package.json'), JSON.stringify(packages['']));
    await writeFile(join(target, 'package-lock.json'), JSON.stringify({ name: 'scope-consumer', version: '1.0.0', lockfileVersion: 3, packages }));
    await writeFile(join(target, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
    this.manifest.project = { root: '../native' }; await this.writeManifest();
  }
  cliCheckWithRecordedNativePort(): Promise<void> { return this.runCli('check', true); }
  cliCheck(): Promise<void> { return this.runCli('check'); }
  cliInstall(): Promise<void> { return this.runCli('install'); }
  private async runCli(command: 'check' | 'install', recordedInventory = false): Promise<void> {
    await this.arrangeFiles(); this.beforeCommands ??= await this.fileTree();
    this.cli ??= new ScopedCliDriver(this.manifestFilename(), this.target()); await this.cli.run(command, recordedInventory);
  }
  cliStatus(): string { return this.cliReport().status; }
  cliExitCode(): number { return this.cliReport().exitCode; }
  cliFinding(code: string) { const problem = this.cliReport().problems.find(problem => problem.code === code); return problem && this.manifestFinding(problem); }
  cliLoadedRequirements(path: string): string[] { const load = this.cliLoad(); return this.recordsFor(this.capture(path, load), load.requirements); }
  cliCaptureLocalPath(path: string): string | undefined { return this.capture(path, this.cliLoad()).localPath; }
  cliNativeInventoryVersions() { if (!this.cli?.inventory) throw new Error('No actual native inventory was returned to the CLI.'); return this.cli.inventory; }
  actualSourceLoadCalls(): number { return this.cli?.loads ?? 0; }
  actualNativeCalls(): number { return this.cli?.calls.length ?? 0; }
  async filesUnchangedByCheck(): Promise<boolean> { return this.filesUnchangedByCommands(); }
  async filesUnchangedByCommands(): Promise<boolean> { if (this.beforeCommands === undefined) throw new Error('No actual pre-command files were captured.'); return this.beforeCommands === await this.fileTree(); }
  private cliReport() { if (!this.cli?.report) throw new Error('Run the actual CLI command before observing its report.'); return this.cli.report; }
  private cliLoad(): SourceLoad { if (!this.cli?.loaded) throw new Error('The actual CLI did not return a forwarded source load.'); return this.cli.loaded; }
  private recordsFor(capture: SourceCapture, records: readonly ScopedPackageRequirement[]): string[] { return records.filter(record => record.sourceId === capture.source.sourceId).map(record => record.alias + ':' + record.phase); }
  private capture(path: string, load = this.load()): SourceCapture {
    const uri = pathToFileURL(this.path(path)).href, capture = load.captures.find(capture => capture.source.sourceId === uri);
    if (!capture) throw new Error('The actual source loader did not capture ' + path + '.'); return capture;
  }
  private load(): SourceLoad { if (!this.loaded) throw new Error('Load the actual scoped sources before observing them.'); return this.loaded; }
  private specification() { if (!this.compiled?.value) throw new Error('No accepted actual compilation: ' + JSON.stringify(this.compiled)); return this.compiled.value; }
  private configurationReport(): Check<Configuration> { if (!this.configured) throw new Error('Read the actual scoped configuration first.'); return this.configured; }
  private manifestFinding(problem: Diagnostic) { return { code: problem.code, path: this.manifestPath(problem.at), related: problem.related.map(at => this.manifestPath(at)) }; }
  private manifestPath(at: ProblemLocation): readonly (string | number)[] {
    const path = dependencyPath(at);
    if (path[0] !== 'manifest' || path[1] !== this.sourceId()) throw new Error('The reader finding did not retain the supplied manifest origin.'); return path.slice(2);
  }
  private sourceId(): string { return this.directory ? pathToFileURL(this.manifestFilename()).href : 'project44/expec.json'; }
  private manifestText(): string { return this.directory ? readFileSync(this.manifestFilename(), 'utf8') : JSON.stringify(this.manifest); }
  private manifestFilename(): string { if (!this.directory) throw new Error('No actual manifest folder is arranged.'); return join(this.directory, 'expec.json'); }
  private target(): string { if (!this.temporary) throw new Error('No actual native target is arranged.'); return join(this.temporary, 'native'); }
  private path(path: string): string {
    if (!this.directory || !this.temporary) throw new Error('No actual source folder is arranged.');
    const location = resolve(this.directory, path), local = relative(this.temporary, location);
    if (isAbsolute(local) || local === '..' || local.startsWith('..' + sep)) throw new Error('The fixture left its owned temporary directory.'); return location;
  }
  private async arrangeFiles(): Promise<void> {
    if (this.arranged) return;
    if (!this.temporary) { this.temporary = realpathSync.native(mkdtempSync(join(tmpdir(), 'expec-scoped-requirements-'))); this.directory = join(this.temporary, 'project'); await mkdir(this.directory); }
    for (const [path, text] of [...this.sources, ...this.outsideSources]) { const filename = this.path(path); await mkdir(dirname(filename), { recursive: true }); await writeFile(filename, text); }
    if (!this.explicitBuild && this.sources.size) this.manifest.build = { entries: [...this.sources.keys()] };
    await this.writeManifest(); this.arranged = true;
  }
  private writeManifest(): Promise<void> { return writeFile(this.manifestFilename(), JSON.stringify(this.manifest)); }
  private async fileTree(): Promise<string> {
    const rows: { path: string; kind: string; bytes?: string }[] = [];
    const walk = async (directory: string): Promise<void> => { for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = join(directory, entry.name), path = relative(this.temporary!, filename);
      if (entry.isDirectory()) { rows.push({ path, kind: 'directory' }); await walk(filename); }
      else if (entry.isFile()) rows.push({ path, kind: 'file', bytes: (await readFile(filename)).toString('base64') });
      else rows.push({ path, kind: entry.isSymbolicLink() ? 'link' : 'other' });
    } };
    await walk(this.temporary!); return JSON.stringify(rows.sort((a, b) => a.path.localeCompare(b.path)));
  }
  async dispose(): Promise<void> {
    this.restoreNative();
    if (!this.temporary) return;
    const local = relative(realpathSync.native(tmpdir()), this.temporary);
    if (isAbsolute(local) || local.includes(sep) || !local.startsWith('expec-scoped-requirements-')) throw new Error('Refusing to remove an unexpected scoped fixture path.');
    await rm(this.temporary, { recursive: true, force: true }); this.temporary = undefined; this.directory = undefined;
  }
}
function dependencyPath(at: ProblemLocation): readonly (string | number)[] { if (at.kind !== 'dependency') throw new Error('Expected the actual dependency origin.'); return at.path; }
function accepted(result: Check<unknown>): boolean { return result.value !== undefined && result.problems.length === 0 && result.deferred.length === 0; }