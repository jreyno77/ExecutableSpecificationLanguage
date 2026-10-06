import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { vi } from 'vitest';
import { FileProjectWriter, ProjectOutput, type Output, type OutputAdapter, type ProjectContext, type ProjectSnapshot } from '../../../../src/index.js';
import { WritingDriver } from './project-writing.js';
import { IdentityDriver } from '../../model/specification-identity.js';

export class NativeInputDriver {
  readonly project = new WritingDriver();
  readonly libraries = new Map<string, string>();
  readonly hooks = new Map<number, () => Promise<void>>();
  readonly identity = new IdentityDriver();
  ordinary!: ProjectContext;
  output!: Output;
  error: unknown;
  mode: 'native' | 'plain' | 'empty' | 'malformed' = 'native';
  reversed = false;
  captures = 0;
  async initialize(): Promise<void> {
    await this.project.initialize({}); this.ordinary = this.project.context;
    this.project.context = { root: this.ordinary.root, readSnapshot: () => this.capture() };
  }
  async capture(): Promise<ProjectSnapshot> {
    await this.hooks.get(++this.captures)?.();
    const snapshot = await this.ordinary.readSnapshot();
    if (this.mode === 'plain') return snapshot;
    if (this.mode === 'malformed') return { ...snapshot, nativeInputs: [{ uri: 'https://example.test/library', version: '1.0.0' }] };
    const nativeInputs = this.mode === 'empty' ? [] : await Promise.all([...this.libraries.values()].map(async path => ({
      uri: pathToFileURL(await fs.realpath(path)).href, version: createHash('sha256').update(await fs.readFile(path)).digest('hex'),
    })));
    return { ...snapshot, nativeInputs: this.reversed ? nativeInputs.reverse() : nativeInputs };
  }
  async addLibrary(name: string, text: string, included = false): Promise<void> {
    const path = included ? this.project.path(name) : join(this.project.directory, 'libraries', name);
    this.libraries.set(name, path); await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(path, text);
  }
  async replaceLibrary(name: string, text: string): Promise<void> {
    const path = this.libraries.get(name); if (!path) throw new Error('Unknown library: ' + name);
    await fs.writeFile(path, text);
  }
  async plan(files: Record<string, string>): Promise<void> {
    await this.project.observe(); this.captures = 0;
    this.project.changes = Object.entries(files).map(([path, text]) => ({ kind: 'write', path, bytes: Buffer.from(text) }));
  }
  replaceLibraryAfterDestinationWrite(destination: string, name: string, text: string): void {
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (String(args[0]) === this.project.path(destination) && args[1] === 'wx') {
        const write = handle.writeFile.bind(handle);
        vi.spyOn(handle, 'writeFile').mockImplementation(async (...values) => {
          await write(...values); await this.replaceLibrary(name, text);
        });
      }
      return handle;
    });
  }
  registerOutput(dropEvidence = false): void {
    const scope = [{ outputId: 'current-files', format: 'file', value: 'contracts.txt' }];
    const coverage = { scope, complete: true, limitations: [] };
    const adapter: OutputAdapter = {
      id: 'current-files',
      plan: async (_request, snapshot) => {
        const { nativeInputs: _ignored, ...plain } = snapshot;
        return { value: { outputId: 'current-files', basedOn: dropEvidence ? plain : snapshot,
          changes: [{ kind: 'write', path: 'contracts.txt', bytes: Buffer.from('contract') }], artifacts: [] }, problems: [], deferred: [] };
      },
      read: async (_id, snapshot) => ({ artifacts: snapshot.files.filter(file => file.path === 'contracts.txt').map(file => ({ at: scope[0]!, file })), coverage, problems: [] }),
      search: async subject => ({ definitions: [], problems: [],
        incoming: { subject, direction: 'incoming', coverage, uses: [], unresolved: [] },
        outgoing: { subject, direction: 'outgoing', coverage, uses: [], unresolved: [] } }),
    };
    this.output = new ProjectOutput(adapter, this.project.context, new FileProjectWriter(this.project.context));
  }
  async observeOutput(action: () => Promise<unknown>): Promise<void> {
    this.error = undefined; try { await action(); } catch (error) { this.error = error; }
  }
  async create(text: string): Promise<void> {
    this.identity.source('store', text, true); this.identity.identify();
    await this.observeOutput(() => this.output.create(this.identity.current()));
  }
}
