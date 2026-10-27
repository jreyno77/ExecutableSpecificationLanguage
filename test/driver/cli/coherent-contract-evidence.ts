import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { onTestFinished } from 'vitest';
import ts from 'typescript';
import { build } from '../../../src/cli/cli-build.js';
import { checkManifest, type CheckedManifest } from '../../../src/cli/cli-check.js';
import { BuildAdmission } from '../../../src/cli/cli-host.js';
import type { Diagnostic, Check } from '../../../src/compiler/checking.js';
import { ProjectConnector, type ProjectContext } from '../../../src/project/connection/project-connection.js';
import type { ProjectRead } from '../../../src/project/connection/project-inspection.js';
import { Outputs, type Output, type OutputRegistration, type OutputContext } from '../../../src/project/output/output.js';
import { typescriptOutput } from '../../../src/project/typescript/output-typescript.js';
import { acceptanceOutput } from '../../../src/project/typescript/output-acceptance.js';
import { copyInstalledPackages } from '../project/typescript/typescript-context.js';

type BuildResult = Awaited<ReturnType<typeof build>>;
type Query = { id: string; result: ProjectRead };
export class CoherentContractEvidenceDriver {
  private constructor(readonly directory: string, private readonly parent: string) {}
  readonly controller = new AbortController();
  readonly adapterQueries: Query[] = [];
  readonly publicQueries: Query[] = [];
  liveCapturesInQueries = 0;
  hookCompleted = false;
  private activeQueries = 0;
  private afterFirst?: () => Promise<void> | void;
  private hostProblems: readonly Diagnostic[] = [];
  private project!: ProjectContext;
  private checked!: CheckedManifest;
  private outputs!: ObservedOutputs;
  private building?: Promise<BuildResult>;
  result!: BuildResult;

  static async create(): Promise<CoherentContractEvidenceDriver> {
    const parent = await fs.realpath(tmpdir()), directory = await fs.realpath(await fs.mkdtemp(join(parent, 'expec-contract-evidence-')));
    const driver = new CoherentContractEvidenceDriver(directory, parent);
    onTestFinished(() => driver.dispose());
    return driver;
  }
  path(path: string): string {
    const full = resolve(this.directory, path), within = relative(this.directory, full);
    if (isAbsolute(within) || within === '..' || within.startsWith('../') || within.startsWith('..\\')) throw Error('Owned contract evidence path escaped.');
    return full;
  }
  projectPath(path: string): string { return this.path('project/' + path); }
  private async file(path: string, text: string): Promise<void> {
    const full = this.path(path); await fs.mkdir(dirname(full), { recursive: true }); await fs.writeFile(full, text);
  }
  async setup(source: string): Promise<void> {
    await this.file('spec/main.expec', source);
    await this.file('project/package.json', '{"name":"coherent-contract-consumer","type":"module","private":true}');
    await this.file('project/src/existing.ts', 'export {};\n');
    await this.file('project/tsconfig.json', JSON.stringify({ compilerOptions: {
      target: 'ES2022', lib: ['ES2022'], module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
      types: ['node'], skipLibCheck: true,
    }, include: ['src/**/*.ts', 'test/**/*.ts'] }));
    await this.file('project/tsconfig.source.json', JSON.stringify({ extends: './tsconfig.json', compilerOptions: { types: [] }, include: ['src/**/*.ts'] }));
    await copyInstalledPackages(this.projectPath(''), { vitest: '5.0.2', '@types/node': '24.13.6' });
    this.outputs = new ObservedOutputs(this);
    this.outputs.register({ ...typescriptOutput, open: (options, context) => {
      const actual = typescriptOutput.open(options, context);
      return { id: actual.id, plan: actual.plan.bind(actual), search: actual.search.bind(actual),
        read: async (id, snapshot) => {
          const result = await actual.read(id, snapshot);
          this.adapterQueries.push({ id, result }); return result;
        },
      };
    } });
    this.outputs.register(acceptanceOutput);
    await this.file('spec/expec.json', JSON.stringify({
      formatVersion: 1, version: '1.0.0', project: { root: '../project' }, build: { entries: ['main.expec'] },
      outputs: [
        { id: 'typescript', options: { directory: 'src', configFile: 'tsconfig.source.json' } },
        { id: 'acceptance', options: { domain: 'arithmetic', configFile: 'tsconfig.json' } },
      ],
    }));
    this.checked = await checkManifest(this.path('spec/expec.json'), this.outputs.profiles);
    if (!this.checked.specification || this.checked.problems.length || this.checked.syntax.length || this.checked.deferred.length)
      throw Error('Actual contract fixture compilation failed: ' + JSON.stringify({ problems: this.checked.problems, syntax: this.checked.syntax, deferred: this.checked.deferred }));
    const connected = await new ProjectConnector(this.checked.manifest).connect(this.checked.configuration!);
    if (connected.value?.status !== 'connected' || connected.problems.length) throw Error('Actual contract fixture connection failed: ' + JSON.stringify(connected));
    const actual = connected.value.context, observeCapture = () => { if (this.activeQueries) this.liveCapturesInQueries++; };
    this.project = { get root() { return actual.root; },
      readSnapshot: () => { observeCapture(); return actual.readSnapshot(); },
      ...(actual.captureSnapshot ? { captureSnapshot: () => { observeCapture(); return actual.captureSnapshot!(); } } : {}),
    };
  }
  async observeRead(id: string, read: () => Promise<ProjectRead>): Promise<ProjectRead> {
    this.activeQueries++;
    try {
      const result = await read(); this.publicQueries.push({ id, result });
      if (!this.hookCompleted && this.afterFirst && result.coverage.complete && !result.problems.length) {
        this.hookCompleted = true; await this.afterFirst();
      }
      return result;
    } finally { this.activeQueries--; }
  }
  appendAfterFirst(path: string, text: string): void {
    this.afterFirst = () => fs.appendFile(this.projectPath(path), text);
  }
  refuseAfterFirst(problem: Diagnostic): void { this.afterFirst = () => { this.hostProblems = [problem]; }; }
  cancelAfterFirst(): void { this.afterFirst = () => { this.controller.abort(); }; }
  async generate(): Promise<void> {
    const admission = new BuildAdmission(this.checked.manifest, this.controller.signal, () => this.hostProblems);
    this.building = build(this.checked, this.project, this.outputs, new Set(['acceptance']), this.controller.signal, undefined, admission);
    this.result = await this.building;
  }
  subjects(): string[] {
    return this.adapterQueries.flatMap(query => [...new Set(query.result.artifacts.flatMap(artifact => {
      const at = artifact.at;
      if (at.format !== 'typescript-symbol-1' || !at.value || typeof at.value !== 'object' || !('declaration' in at.value)) return [];
      const declaration = at.value.declaration;
      if (!Array.isArray(declaration)) return [];
      return [declaration.map(part => {
        if (!part || typeof part !== 'object' || !('name' in part) || typeof part.name !== 'string') throw Error('Actual native declaration observation is malformed.');
        return part.name;
      }).join('.')];
    }))]);
  }
  async text(path: string): Promise<string> { return fs.readFile(this.projectPath(path), 'utf8'); }
  async source(path: string): Promise<ts.SourceFile> { return ts.createSourceFile(path, await this.text(path), ts.ScriptTarget.Latest, true); }
  async filesUnder(path: string): Promise<string[]> {
    const found: string[] = [];
    const walk = async (path: string): Promise<void> => {
      for (const entry of await fs.readdir(this.projectPath(path), { withFileTypes: true })) {
        const child = path + '/' + entry.name;
        if (entry.isDirectory()) await walk(child); else if (entry.isFile()) found.push(child);
        else throw Error('Unexpected owned linked test artifact.');
      }
    };
    await walk(path); return found;
  }
  async absent(path: string): Promise<boolean> {
    try { await fs.lstat(this.projectPath(path)); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error; }
  }
  async dispose(): Promise<void> {
    this.controller.abort();
    if (this.building) await Promise.allSettled([this.building]);
    if (dirname(this.directory) !== this.parent || !this.directory.split(/[\\/]/).at(-1)?.startsWith('expec-contract-evidence-')
      || await fs.realpath(this.directory) !== this.directory) throw Error('Refuse unowned contract fixture cleanup.');
    await fs.rm(this.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

class ObservedOutputs extends Outputs {
  constructor(private readonly owner: CoherentContractEvidenceDriver) { super(); }
  override open(id: string, options: Readonly<Record<string, unknown>>, project: ProjectContext,
    writer: Parameters<Outputs['open']>[3], context?: OutputContext): Check<Output> {
    const opened = super.open(id, options, project, writer, context);
    if (!opened.value || id !== 'typescript') return opened;
    const actual = opened.value;
    return { ...opened, value: {
      create: actual.create.bind(actual), insert: actual.insert.bind(actual), update: actual.update.bind(actual),
      delete: actual.delete.bind(actual), plan: actual.plan.bind(actual), search: actual.search.bind(actual),
      read: subject => this.owner.observeRead(subject, () => actual.read(subject)),
    } };
  }
}
