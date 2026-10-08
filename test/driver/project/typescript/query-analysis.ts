import { createHash } from 'node:crypto';
import type ts from 'typescript';
import { vi } from 'vitest';
import { TypeScriptProject, type ArtifactAssociation, type ProjectRead, type ProjectSearch, type ProjectSnapshot } from '../../../../src/index.js';
import { TypeScriptOutputDriver } from './typescript-output.js';

const preparations = vi.hoisted(() => ({ count: 0 }));
vi.mock('typescript', async importOriginal => {
  const actual = await importOriginal<{ default: typeof ts }>();
  return { ...actual, default: new Proxy(actual.default, { get(target, key, receiver) {
    if (key !== 'createLanguageService') return Reflect.get(target, key, receiver);
    return function (...args: Parameters<typeof target.createLanguageService>) {
      preparations.count++;
      return Reflect.apply(target.createLanguageService, target, args);
    };
  } }) };
});
const file = (path: string, bytes: Uint8Array) => ({ path, bytes, version: createHash('sha256').update(bytes).digest('hex') });

/** Tiny supplied captures or the existing real compiler/connected output; no native setup. */
export class QueryAnalysisDriver {
  snapshot: ProjectSnapshot;
  readonly associations: ArtifactAssociation[] = [];
  readResult!: ProjectRead;
  searchResult!: ProjectSearch;
  output: TypeScriptOutputDriver | undefined;
  outputBefore: Map<string, string> | undefined;
  private reader: TypeScriptProject | undefined;
  constructor(files: Record<string, string | Uint8Array>, private readonly configFile?: string) {
    this.snapshot = { root: { path: process.cwd(), identity: 'query-analysis' }, complete: true, problems: [], excludeNames: [], excluded: [],
      files: Object.entries(files).map(([path, body]) => file(path, typeof body === 'string' ? Buffer.from(body) : body)) };
  }
  associate(id: string, path: string, declaration: { kind: string; name: string; static?: boolean }[]): void {
    this.associations.push({ specId: id, locator: { outputId: 'typescript', format: 'typescript-symbol-1', value: { file: path, declaration } } });
    this.reader = undefined;
  }
  async connected(source: string): Promise<void> {
    this.output = new TypeScriptOutputDriver(); await this.output.initialize();
    this.output.source(source); await this.output.create({ directory: 'src' });
    if (this.output.problems.length || !this.output.written?.receipt || this.output.written.receipt.status === 'stopped') throw Error(JSON.stringify(this.output.written));
    this.outputBefore = new Map(this.output.files);
  }
  observe(): void { preparations.count = 0; }
  get prepared(): number { return preparations.count; }
  private project(): TypeScriptProject {
    return this.reader ??= new TypeScriptProject({ outputId: 'typescript', ...this.configFile ? { configFile: this.configFile } : {} }, this.associations);
  }
  async read(id: string): Promise<void> {
    if (this.output) { await this.output.read(id); this.readResult = this.output.readResult; }
    else this.readResult = this.project().read(id, this.snapshot);
  }
  async search(id: string): Promise<void> {
    if (this.output) { await this.output.search(id); this.searchResult = this.output.searchResult; }
    else this.searchResult = this.project().search(id, this.snapshot);
  }
  replaceBytes(path: string, bytes: Uint8Array, keepVersion = false): void {
    const before = this.snapshot.files.find(item => item.path === path);
    if (!before) throw Error('Missing captured file ' + path);
    this.snapshot = { ...this.snapshot, files: this.snapshot.files.map(item => item !== before ? item : { ...item, bytes, ...keepVersion ? {} : { version: file(path, bytes).version } }) };
  }
  nativeDeclaration(path: string, text: string, keepVersion = false): void {
    const before = this.snapshot.readOnlyFiles?.find(item => item.path === path), next = file(path, Buffer.from(text));
    this.snapshot = { ...this.snapshot, readOnlyFiles: [...(this.snapshot.readOnlyFiles ?? []).filter(item => item.path !== path),
      keepVersion && before ? { ...next, version: before.version } : next] };
  }
  async relocateOwnership(path: string): Promise<void> {
    if (!this.output) throw Error('Open the actual output first');
    const statePath = '.expec/outputs/' + Buffer.from('typescript').toString('hex') + '.json', text = this.output.files.get(statePath);
    if (!text) throw Error('Missing actual ownership state');
    const state = JSON.parse(text), owner = state.files[0];
    if (!owner) throw Error('Missing actual generated file');
    owner.path = path;
    for (const at of [...owner.artifacts, ...owner.renderedArtifacts ?? []]) at.locator.value.file = path;
    await this.output.file(statePath, JSON.stringify(state));
  }
  async dispose(): Promise<void> { await this.output?.dispose(); }
}
