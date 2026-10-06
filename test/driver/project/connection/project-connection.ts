import { mkdtempSync, realpathSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, readlink, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { unreadableFile } from '../../unreadable-file.js';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ConfigurationReader, ProjectConnector, type Check, type Configuration, type ProjectConnection, type ProjectContext, type ProjectSnapshot } from '../../../../src/index.js';

/** Real temporary project and public calls; observations remain in the acceptance DSL. */
export class ConnectionDriver {
  readonly directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'expec-connection-')));
  configuration!: Configuration;
  connection!: Check<ProjectConnection>;
  current!: ProjectSnapshot;
  before: unknown;
  readonly remembered = new Map<string, { source: ProjectSnapshot; facts: unknown }>();
  private context: ProjectContext | undefined;
  private location = '';
  private exclusions?: readonly string[];
  private readonly blocked = new Map<string, () => Promise<void>>();

  path(name: string): string {
    const path = resolve(this.directory, name), inside = relative(this.directory, path);
    if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) throw new Error('Fixture path escaped its temporary project.');
    return path;
  }
  manifest(path: string, contents: unknown, sourceId = 'settings'): void {
    const checked = new ConfigurationReader([]).read({ sourceId, text: JSON.stringify(contents) });
    if (!checked.value) throw new Error(`Invalid configuration fixture: ${JSON.stringify(checked.problems)}`);
    this.configuration = checked.value;
    this.location = this.path(path);
  }
  excludeNames(names: readonly string[]): void { this.exclusions = [...names]; }
  async connect(): Promise<void> {
    this.before = await this.tree();
    this.connection = await new ProjectConnector(this.location, this.exclusions ? { excludeNames: this.exclusions } : undefined).connect(this.configuration);
    this.context = this.connection.value?.status === 'connected' ? this.connection.value.context : undefined;
  }
  async readSnapshot(): Promise<void> {
    if (!this.context) throw new Error(`Expected a connected project; connect returned ${JSON.stringify(this.connection)}.`);
    this.current = await this.context.readSnapshot();
  }
  async files(files: Record<string, string>): Promise<void> { for (const [path, text] of Object.entries(files)) await this.file(path, text); }
  async file(path: string, content: string | Uint8Array): Promise<void> {
    await mkdir(dirname(this.path(path)), { recursive: true });
    await writeFile(this.path(path), content);
  }
  async mkdir(path: string): Promise<void> { await mkdir(this.path(path), { recursive: true }); }
  async remove(path: string): Promise<void> { await rm(this.path(path), { recursive: true, force: true }); }
  async move(from: string, to: string): Promise<void> { await rename(this.path(from), this.path(to)); }
  async directoryLink(path: string, target: string): Promise<void> {
    await mkdir(dirname(this.path(path)), { recursive: true });
    await symlink(this.path(target), this.path(path), process.platform === 'win32' ? 'junction' : 'dir');
  }
  async retargetDirectoryLink(path: string, target: string): Promise<void> {
    await unlink(this.path(path));
    await this.directoryLink(path, target);
  }
  async preventRead(path: string): Promise<void> { this.blocked.set(path, await unreadableFile(this.path(path))); }
  async allowRead(path: string): Promise<void> { await this.blocked.get(path)?.(); this.blocked.delete(path); }
  remember(label: string): void { this.remembered.set(label, { source: this.current, facts: this.facts(this.current) }); }
  facts(snapshot: ProjectSnapshot): unknown { return structuredClone({ ...snapshot, files: snapshot.files.map(file => ({ ...file, bytes: [...file.bytes] })) }); }
  async tree(path = ''): Promise<unknown[]> {
    const entries: unknown[] = [];
    for (const name of (await readdir(this.path(path))).sort()) {
      const next = path ? `${path}/${name}` : name, info = await lstat(this.path(next));
      if (info.isSymbolicLink()) entries.push({ path: next, kind: 'link', target: await readlink(this.path(next)) });
      else if (info.isDirectory()) { entries.push({ path: next, kind: 'directory' }); entries.push(...await this.tree(next)); }
      else entries.push({ path: next, kind: 'file', bytes: [...await readFile(this.path(next))] });
    }
    return entries;
  }
  async dispose(): Promise<void> {
    for (const path of this.blocked.keys()) await this.allowRead(path);
    await rm(this.path(''), { recursive: true, force: true });
  }
}
