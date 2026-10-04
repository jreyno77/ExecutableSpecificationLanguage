import fs, { promises as files } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { createRequire } from 'node:module';
import { vi } from 'vitest';
import { Compiler, ConfigurationReader, ProjectConnector, SpecificationIdentity, TypeScriptProject, TypeScriptContext, reconcileRelationships,
  type ArtifactAssociation, type Diagnostic, type IdentifiedSpecification, type ProjectContext, type ProjectRead,
  type ProjectSearch, type ProjectSnapshot, type Reconciliation, type TypeScriptProjectOptions } from '../../src/index.js';

export type Selector = { kind: string; name: string; static?: boolean };
export type Occurrence = { file: string; text: string; within?: string; role?: string };
export type Site = { file: string; version: string; start: number; end: number; role: string };

/** Real connected files and explicit identity mappings; observations come from the public scanner. */
export class ProjectReadingDriver {
  private readonly temporary = fs.realpathSync.native(tmpdir());
  readonly directory = fs.realpathSync.native(fs.mkdtempSync(join(this.temporary, 'expec-reading-')));
  readonly originals = new Map<string, Uint8Array>();
  readonly associations: ArtifactAssociation[] = [];
  readonly reads = new Map<string, ProjectRead>();
  readonly searches = new Map<string, ProjectSearch>();
  readonly diskReads: string[] = [];
  readonly libraryRoot = dirname(createRequire(import.meta.url).resolve('typescript'));
  context!: ProjectContext;
  readResult!: ProjectRead;
  searchResult!: ProjectSearch;
  snapshot!: ProjectSnapshot;
  originalProblem!: Diagnostic;
  current!: IdentifiedSpecification;
  compared!: Reconciliation;
  stateBefore = '';
  specificationBefore = '';
  private reader: TypeScriptProject | undefined;
  private readonly options: TypeScriptProjectOptions;
  constructor(options: { configFile?: string; excludeNames?: readonly string[] }) {
    this.options = { outputId: 'typescript', ...(options.configFile ? { configFile: options.configFile } : {}) };
  }
  async initialize(excludeNames?: readonly string[]): Promise<void> {
    const configuration = new ConfigurationReader([]).read({ sourceId: 'settings', text: JSON.stringify({
      formatVersion: 1, version: '0.1.0', project: { root: '.' }, build: { entries: ['main.expec'] },
    }) });
    if (!configuration.value) throw Error(JSON.stringify(configuration));
    const result = await new ProjectConnector(join(this.directory, 'expec.json'), excludeNames ? { excludeNames } : undefined).connect(configuration.value);
    if (result.value?.status !== 'connected') throw Error(JSON.stringify(result));
    this.context = result.value.context;
  }
  async file(path: string, content: string | Uint8Array): Promise<void> {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    await files.mkdir(dirname(join(this.directory, path)), { recursive: true });
    await files.writeFile(join(this.directory, path), bytes); this.originals.set(path, Uint8Array.from(bytes));
  }
  associate(id: string, file: string, declaration?: Selector[]): void {
    this.associations.push({ specId: id, locator: { outputId: 'typescript', format: declaration ? 'typescript-symbol-1' : 'typescript-file-1',
      value: declaration ? { file, declaration } : { file } } }); this.reader = undefined;
  }
  scanner(): TypeScriptProject {
    this.stateBefore = JSON.stringify(this.associations);
    return this.reader ??= new TypeScriptProject(this.options, this.associations);
  }
  async capture(): Promise<ProjectSnapshot> { return this.snapshot = await this.context.readSnapshot(); }
  nativeDependencies(): void { this.context = new TypeScriptContext(this.context, this.options.configFile ? { configFile: this.options.configFile } : {}); }
  async read(id: string): Promise<void> { this.readResult = this.scanner().read(id, await this.capture()); }
  async search(id: string): Promise<void> { this.searchSnapshot(id, await this.capture()); }
  searchSnapshot(id: string, snapshot: ProjectSnapshot): void { this.snapshot = snapshot; this.searchResult = this.scanner().search(id, snapshot); }
  async guardedSearch(id: string): Promise<void> {
    const snapshot = await this.capture(), original = fs.readFileSync, library = fs.realpathSync.native(this.libraryRoot);
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation((...args: Parameters<typeof fs.readFileSync>) => {
      const path = String(args[0]); this.diskReads.push(path);
      const name = relative(library, path);
      if (isAbsolute(name) || name.startsWith('..') || name.includes(sep) || !/^lib(?:\.[\w.-]+)?\.d\.ts$/.test(name)) throw Error('Unexpected project filesystem read: ' + path);
      return original(...args);
    });
    try { this.searchSnapshot(id, snapshot); } finally { spy.mockRestore(); }
  }
  async readFailure(path: string): Promise<ProjectSnapshot> {
    await this.file(path, 'export const broken = true;');
    const original = files.open;
    const spy = vi.spyOn(files, 'open').mockImplementation((...args: Parameters<typeof files.open>) => {
      if (String(args[0]) === join(this.directory, path)) return Promise.reject(Object.assign(Error('Cannot read fixture.'), { code: 'EACCES' }));
      return original(...args);
    });
    try {
      const result = await this.capture(); this.originalProblem = result.problems.find(problem => problem.code === 'read-failed')!;
      if (!this.originalProblem) throw Error('Real capture did not record the read failure.');
      return result;
    } finally { spy.mockRestore(); }
  }
  specification(text: string): void {
    const checked = new Compiler().compile({ source: { sourceId: 'main.expec', text }, locator: 'main', dependencies: { modules: [], packages: [] } });
    if (!checked.value) throw Error(JSON.stringify(checked));
    let next = 0;
    const identified = new SpecificationIdentity(() => 'subject-' + ++next).associate(checked.value);
    if (!identified.value) throw Error(JSON.stringify(identified));
    this.current = identified.value; this.specificationBefore = JSON.stringify(this.current.baseline);
  }
  id(name: string): string {
    const record = this.current.baseline.elements.find(item => item.address.name === name);
    if (!record) throw Error('No authored specification declaration ' + name); return record.id;
  }
  reconcile(names: string[]): void {
    const result = reconcileRelationships(this.current, names.map(name => this.id(name)), this.searchResult.outgoing);
    if (!result.value) throw Error(JSON.stringify(result)); this.compared = result.value;
  }
  text(path: string): string { return new TextDecoder().decode([...this.snapshot.files, ...this.snapshot.readOnlyFiles ?? []].find(file => file.path === path)?.bytes ?? this.originals.get(path)); }
  range(occurrence: Occurrence): { start: number; end: number } {
    const source = this.text(occurrence.file), context = occurrence.within ? source.indexOf(occurrence.within) : 0;
    const start = source.indexOf(occurrence.text, context);
    if (context < 0 || start < 0) throw Error('Authored occurrence is absent: ' + JSON.stringify(occurrence));
    return { start, end: start + occurrence.text.length };
  }
  async dispose(): Promise<void> {
    const name = relative(this.temporary, this.directory);
    if (isAbsolute(name) || name.includes(sep) || !name.startsWith('expec-reading-')) throw Error('Unexpected project fixture path.');
    await files.rm(this.directory, { recursive: true, force: true });
  }
}
