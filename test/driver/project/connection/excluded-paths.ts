import { mkdtempSync, realpathSync } from 'node:fs';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { onTestFinished } from 'vitest';
import { ConfigurationReader, FileProjectWriter, ProjectConnector, type Configuration, type FileChange, type ProjectContext, type ProjectSnapshot } from '../../../../src/index.js';

export const pathConfiguration = (excludePaths?: unknown) => ({
  formatVersion: 1 as const, version: '1.0.0', sourceId: 'paths.expec.json',
  build: { entries: ['book.expec'] }, outputs: [], packages: [], libraries: [],
  project: { root: '.', ...(excludePaths === undefined ? {} : { excludePaths }) },
});
export const readPathConfiguration = (excludePaths?: unknown) => new ConfigurationReader([]).read({
  sourceId: 'paths.expec.json', text: JSON.stringify({ ...pathConfiguration(excludePaths), sourceId: undefined }),
});

/** Owns a real project and invokes public capture and conditional file application. */
export class ExcludedPathsProject {
  readonly directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'expec-excluded-paths-')));
  readonly manifest = join(this.directory, 'expec.json');
  context!: ProjectContext;
  constructor() { onTestFinished(async () => {
    if (dirname(this.directory) !== realpathSync.native(tmpdir()) || !basename(this.directory).startsWith('expec-excluded-paths-'))
      throw Error('Refusing cleanup outside the owned temporary project.');
    await rm(this.directory, { recursive: true, force: true });
  }); }
  async files(files: Record<string, string>) {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(this.directory, path)), { recursive: true });
      await writeFile(join(this.directory, path), text);
    }
  }
  connect(excludePaths?: unknown, excludeNames?: readonly string[]) {
    return new ProjectConnector(this.manifest, excludeNames === undefined ? undefined : { excludeNames })
      .connect(pathConfiguration(excludePaths) as unknown as Configuration);
  }
  async usePolicy(excludePaths?: readonly string[], excludeNames?: readonly string[]) {
    const result = await this.connect(excludePaths, excludeNames);
    if (result.value?.status !== 'connected') throw Error('Expected connected fixture: ' + JSON.stringify(result));
    this.context = result.value.context;
    return this;
  }
  capture() { return this.context.captureSnapshot ? this.context.captureSnapshot() : this.context.readSnapshot(); }
  apply(snapshot: ProjectSnapshot, changes: readonly FileChange[]) {
    return new FileProjectWriter(this.context).apply({ basedOn: snapshot, changes });
  }
  text(path: string) { return readFile(join(this.directory, path), 'utf8'); }
  exists(path: string) { return lstat(join(this.directory, path)).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }); }
}
export const writePath = (path: string, text = 'new'): FileChange => ({ kind: 'write', path, bytes: Buffer.from(text) });
