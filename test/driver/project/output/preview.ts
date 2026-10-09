import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { vi } from 'vitest';
import { Compiler, FileProjectWriter, Outputs, ProjectConnector, contractListOutput, markdownOutput,
  structureListOutput, typescriptOutput, umlOutput, type Check, type OutputContext, type OutputPreview,
  type Specification } from '../../../../src/index.js';

/** Records real file access within this example's owned tree, forwarding the operation unchanged. */
export class PreviewAccessObservation {
  readonly accesses: { operation: string; path: string }[] = [];
  constructor(private readonly root: string) {}
  private observe(operation: string, input: unknown): void {
    const path = input instanceof URL ? fileURLToPath(input) : Buffer.isBuffer(input) ? input.toString() : input;
    if (typeof path !== 'string') return;
    const local = relative(this.root, resolve(path));
    if (!isAbsolute(local) && local !== '..' && !local.startsWith('..' + sep)) this.accesses.push({ operation, path: local.split(sep).join('/') });
  }
  async during<T>(action: () => Promise<T>): Promise<T> {
    const open = fs.open.bind(fs), readFile = fs.readFile.bind(fs), writeFile = fs.writeFile.bind(fs);
    const observers = [
      vi.spyOn(fs, 'open').mockImplementation((...args) => { this.observe('open', args[0]); return open(...args); }),
      vi.spyOn(fs, 'readFile').mockImplementation((...args) => { this.observe('readFile', args[0]); return readFile(...args); }),
      vi.spyOn(fs, 'writeFile').mockImplementation((...args) => { this.observe('writeFile', args[0]); return writeFile(...args); }),
    ];
    try { return await action(); } finally { for (const observer of observers) observer.mockRestore(); }
  }
}

/** Real supplied compilation and registered draft projections; no project is connected or captured. */
export class PreviewDriver {
  readonly root = resolve(tmpdir(), 'expec-preview-' + randomUUID());
  readonly outputs = new Outputs();
  readonly results = new Map<string, Check<OutputPreview>>();
  readonly observation = new PreviewAccessObservation(this.root);
  readonly specificationsUsed: Specification[] = [];
  private sourceId: string;
  specification!: Specification;
  private beforeSpecification = '';
  private context: OutputContext | undefined;
  private ownsRoot = false;
  private existingFiles: { path: string; bytes?: string }[] | undefined;
  remembered: Check<OutputPreview> | undefined;
  forbiddenEntries: string[] = [];
  constructor(text: string, sourceId = 'book.expec') {
    this.sourceId = sourceId;
    for (const registration of [typescriptOutput, markdownOutput, umlOutput, contractListOutput, structureListOutput]) {
      this.outputs.register({ ...registration, open: () => {
        this.forbiddenEntries.push('open:' + registration.id); throw new Error('Preview opened a connected-project output adapter.');
      } });
    }
    this.revise(text);
  }
  revise(text: string): void {
    const result = new Compiler().compile({ locator: this.sourceId, source: { sourceId: this.sourceId, text }, dependencies: { modules: [], packages: [] } });
    if (!result.value) throw new Error('Invalid acceptance source: ' + JSON.stringify(result));
    this.specification = result.value;
    this.beforeSpecification = this.specificationState();
    if (this.context) this.context = { ...this.context, workspaceModules: [this.sourceId] };
  }
  sourcePath(path: string, text: string): void {
    this.sourceId = pathToFileURL(join(this.root, path)).href;
    this.useManifest(); this.revise(text);
  }
  useManifest(): void { this.context = { workspaceModules: [this.sourceId], manifestLocation: join(this.root, 'expec.json') }; }
  specificationState(): string { return JSON.stringify({ entry: this.specification.entry, roots: [...this.specification.inspection.roots()] }); }
  get originalSpecificationState(): string { return this.beforeSpecification; }
  async show(id: string, options: Readonly<Record<string, unknown>>): Promise<void> {
    const entries = [
      vi.spyOn(ProjectConnector.prototype, 'connect').mockImplementation(async () => {
        this.forbiddenEntries.push('connect'); throw new Error('Preview connected a project.');
      }),
      vi.spyOn(FileProjectWriter.prototype, 'apply').mockImplementation(async () => {
        this.forbiddenEntries.push('apply'); throw new Error('Preview applied project changes.');
      }),
    ];
    try {
      this.specificationsUsed.push(this.specification);
      const result = await this.observation.during(() => this.outputs.preview(id, options, this.specification, this.context));
      this.results.set(id, result);
    } finally { for (const entry of entries) entry.mockRestore(); }
  }
  remember(id: string): void {
    const result = this.results.get(id);
    if (!result) throw new Error('No preview to remember: ' + id);
    this.remembered = result;
  }
  async arrangeFiles(files: Readonly<Record<string, string>>): Promise<void> {
    await fs.mkdir(this.root); this.ownsRoot = true;
    for (const [path, text] of Object.entries(files)) {
      await fs.mkdir(dirname(join(this.root, path)), { recursive: true }); await fs.writeFile(join(this.root, path), text);
    }
    this.existingFiles = await this.tree();
  }
  async tree(): Promise<{ path: string; bytes?: string }[]> {
    const files: { path: string; bytes?: string }[] = [];
    const visit = async (path: string): Promise<void> => {
      for (const entry of await fs.readdir(join(this.root, path), { withFileTypes: true })) {
        const local = path ? path + '/' + entry.name : entry.name;
        if (entry.isDirectory()) { files.push({ path: local + '/' }); await visit(local); }
        else if (entry.isFile()) files.push({ path: local, bytes: (await fs.readFile(join(this.root, local))).toString('base64') });
        else throw new Error('Unexpected fixture entry: ' + local);
      }
    };
    await visit(''); return files.sort((a, b) => a.path.localeCompare(b.path));
  }
  get originalFiles(): { path: string; bytes?: string }[] {
    if (!this.existingFiles) throw new Error('No owned files were arranged.'); return this.existingFiles;
  }
  async dispose(): Promise<void> {
    if (!this.ownsRoot) return;
    if (dirname(this.root) !== resolve(tmpdir()) || !relative(tmpdir(), this.root).startsWith('expec-preview-')) throw new Error('Unexpected fixture directory.');
    await fs.rm(this.root, { recursive: true, force: true }); this.ownsRoot = false;
  }
}
