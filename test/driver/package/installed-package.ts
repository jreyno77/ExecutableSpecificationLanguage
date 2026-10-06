import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Check, InitializationPlan, InitializationResult, OutputWrite, ProjectRead, ProjectSearch } from '../../../src/index.js';
import type { PackageRead } from '../../../src/index.js';
import { NativePackageDriver, npmCommand } from '../project/dependencies/native-packages.js';

const execute = promisify(execFile), require = createRequire(import.meta.url);
const checkout = fileURLToPath(new URL('../../../', import.meta.url));
const resources = join(checkout, 'test/resources/package-consumer');
const packageName = 'executable-specification-language';
type ProcessResult = { code: number; stdout: string; stderr: string };
interface KotlinCommand {
  code: number; stderr: string; report: { status: string; exitCode: number; problems: unknown[]; stages: {
    name: string; status: string; packages?: PackageRead; tests?: {title:string;state:string;errors:string[]}[];
  }[] };
}
interface ConsumerReport {
  kotlinCli?: { executable: string; initialized: KotlinCommand; acquired: KotlinCommand; built: KotlinCommand; passed: KotlinCommand; broken: KotlinCommand;
    original: string; testText: string; testUnchanged: boolean; canaries: boolean[]; unexpectedDenials: string[] };
  javaCli?: { executable: string; commands: JavaCommand[]; first: JavaCommand; renamed: JavaCommand; wrong: JavaCommand; source: string; caller: string; readable: string };
  java?: { complete:boolean; problems:unknown[]; search:ProjectSearch; read:Omit<ProjectRead,'artifacts'>&{artifacts:{at:unknown;path:string;text:string}[]}; wrong:ProcessResult };
  customCli?: { result: { status: string; exitCode: number; problems: unknown[]; stages: unknown[] };
    checkoutDenied: string; privateImportDenied: string; catalog: string; note: string };
  cli?: { executable: string; result: { format: number; status: string; exitCode: number; version: string; problems: unknown[]; syntax: unknown[]; stages: unknown[] };
    stderr: string; manifestBefore: string; manifestAfter: string; files: string[]; note: string };
  packageUrl: string;
  kotlin?: {
    initialized: string; acquired: PackageRead; created: OutputWrite; repeated: OutputWrite; tests: OutputWrite; testText: string;
    observed: { coverage: { complete: boolean }; problems: unknown[]; files: { path: string; text: string }[] }; search: ProjectSearch;
    caller: string; callerPath: string; before: string; after: string; passed: ProcessResult & { xml: string[] }; broken: ProcessResult & { xml: string[] };
    testUnchanged: boolean; canaries: boolean[]; unexpectedDenials: string[]; jars: number; nativeBytes: number; notice: string;
    artifacts: { file: string; expected: string; actual: string; notices: { path: string; bytes: number }[] }[];
  };
  lifecycle?: {
    written: OutputWrite; scenario: string; unchangedTests: boolean;
    passed: { code: number; success: boolean; assertions: { title: string; status: string; failureMessages: string[] }[]; events: { id: string; event: string; title?: string; actual?: number; listening?: boolean }[] };
    broken: NonNullable<ConsumerReport['lifecycle']>['passed'];
  };
  acceptance?: {
    written: OutputWrite; scenario: string; driverBefore: string; driverAfter: string; unchangedTests: boolean;
    passed: { code: number; success: boolean; assertions: { title: string; status: string; failureMessages: string[] }[] };
    broken: { code: number; success: boolean; assertions: { title: string; status: string; failureMessages: string[] }[] };
  };
  nativeInputs?: {
    complete: boolean; problems: unknown[]; evidence: { uri: string; version: string }[]; actualUri: string;
    editable: string[]; before: string; after: string; laterVersion: string; targetExists: boolean; handwritten: string;
    receipt: import('../../../src/index.js').WriteResult;
  };
  preservation?: {
    adopted: OutputWrite; updated?: OutputWrite; original: string; afterAdoption: string;
    source?: string; caller?: string; diagnostics?: unknown[]; runtime?: ProcessResult;
    generatedDuplicate: boolean; retainedIdentity?: boolean;
  };
  workspace?: { functions: string[]; books: string[]; parameters: number; bothParametersUseBook: boolean; bookIdentityRecords: number };
  nativeContext?: {
    complete: boolean; problems: unknown[]; search: ProjectSearch;
    editable: string[]; readonly: { path: string; version: string }[];
    files: Record<string, string>; versions: Record<string, string>;
    receipt: import('../../../src/index.js').WriteResult; notesExist: boolean;
    capturedText: string; originalText: string; diskText: string;
    packages: Record<string, string>;
  };
  initialization?: {
    prepared: Check<InitializationPlan>; result?: InitializationResult; acquisition?: PackageRead;
    connectedRoot?: { path: string; identity: string };
    selectedRoot?: { requested: string; actual: string };
    snapshot?: { complete: boolean; files: { path: string; text: string }[]; problems: unknown[]; excluded: string[] };
    beforeBuildEntries?: string[]; typescript?: { version: string; location: string };
    build?: { code: number; output: string }; emitted?: Record<string, string>; manifest: string;
  };
  acquisition?: { packages: PackageRead; fields?: { name: string; type: string }[]; workspace?: string[]; libraryOrigins?: string[]; problems?: unknown[]; syntax?: unknown[] };
  typescriptOutput?: {
    written: OutputWrite; typescript: { version: string; location: string }; source?: string;
    validDiagnostics?: unknown[]; invalidDiagnostics?: { code: number; file: string; text: string; message: string }[];
    runtime?: { name?: string; message?: string; returned?: boolean }; notes?: string;
    baseline?: string; handwritten?: string; update?: OutputWrite; after?: string; stateBefore?: string; stateAfter?: string;
  };
  projectReading?: {
    read: Omit<ProjectRead, 'artifacts'> & { artifacts: { at: unknown; file: string; text: string }[] };
    search: ProjectSearch; files: Record<string, string>; versions: Record<string, string>;
    typescript: { version: string; location: string };
  };
  documentation?: {
    written: OutputWrite;
    read: Omit<ProjectRead, 'artifacts'> & { artifacts: { path: string; text: string; disk: string }[] };
    search: ProjectSearch;
  };
  domainFailures?: { operation: string; result: string; code: { family: string; codes: string[]; payload: string[] }[];
    documented: { family: string; codes: string[]; payload: string[] }[]; sameDeclaration: boolean; fieldsAgree: boolean; earlierUnchanged: boolean }[];

  accepted?: boolean;
  syntax?: unknown[];
  deferred?: unknown[];
  problems?: { code: string; text?: string }[];
  capabilities?: string[];
  loaded?: { accepted: boolean; captures: number; capabilities: string[]; problems: unknown[]; syntax: unknown[] };
  writing?: { status: string; problems: unknown[]; outcomes: string[]; before: string[];
    file: string; handwritten: string; markerPresent: boolean };
  operations?: string[];
  bodies?: { name: string; generation: string[]; documentation: string[]; statements: string[]; earlierUnchanged: boolean }[];
  steps?: { available: { name: string; type: string }[]; capture?: { name: string; type: string } }[];
  error?: { code?: string; message: string; url?: string };
  output?: CountReport;
  diagram?: { written: OutputWrite; read: NonNullable<CountReport['read']>; search: ProjectSearch;
    native: { label: string; methods?: { name: string; return: string }[] }[];
    guards: { reads: string[]; denied: string[]; workers: { created: number; exited: number } };
    canaries: { failures: boolean[]; denied: string[] }; private: string };

}
interface JavaCommand { command: string; code: number; stderr: string; report: { status: string; exitCode: number; problems: unknown[];
  stages: { name: string; status: string; tests?: { state: string; errors: string[] }[] }[] } }
interface CountReport {
  write?: OutputWrite;
  counts?: { concepts: number; recordTypes: number; capabilities: number; subjects: { id: string; name: string }[] };
  file?: string;
  handwritten?: string;
  read?: Omit<ProjectRead, 'artifacts'> & { artifacts: { path: string; text: string; disk: string }[] };
  search?: ProjectSearch;
}

/** Native packing, isolated installation, and observations from separate consumer processes. */
export class PackageDriver {
  static get packedArtifact(): string { return PackageDriver.artifact; }
  get root(): string { return this.consumer; }
  private static directory: string | undefined;
  private static artifact = '';
  private directory?: string;
  private consumer!: string;
  result!: ProcessResult;
  declarations!: ProcessResult;
  report!: ConsumerReport;
  location!: Awaited<ReturnType<typeof packageLocation>>;
  countReports: Record<string, CountReport> = {};
  private countInput: Record<string, unknown> = {};
  private native: NativePackageDriver | undefined;

  static async prepare(archive = process.env.EXPEC_TEST_PACKAGE): Promise<void> {
    await this.finish();
    if (archive !== undefined) {
      if (!isAbsolute(archive)) throw new Error('Supplied package archive must be an absolute path: ' + archive);
      if (!(await stat(archive)).isFile()) throw new Error('Supplied package archive must be a regular file: ' + archive);
      this.artifact = archive;
      return;
    }
    const version = await npm(checkout, ['--version']);
    if (version.stdout.trim() !== '11.20.0') throw new Error(`Expected npm 11.20.0, received ${version.stdout}`);
    this.directory = await mkdtemp(join(await realpath(tmpdir()), 'expec-package-'));
    this.artifact = await pack(checkout, this.directory, true);
  }
  static async finish(): Promise<void> {
    if (this.directory) await cleanup(this.directory);
    this.directory = undefined;
    this.artifact = '';
  }

  async install(options: { withoutFile?: string; withoutDependency?: string } = {}): Promise<void> {
    this.directory = await mkdtemp(join(await realpath(tmpdir()), 'expec-package-'));
    this.consumer = join(this.directory, 'consumer');
    let artifact = PackageDriver.artifact;
    if (options.withoutFile || options.withoutDependency) {
      const seed = join(this.directory, 'seed'), copy = join(this.directory, 'package-copy');
      await this.installInto(seed, artifact);
      const installed = join(seed, 'node_modules', packageName);
      await cp(installed, copy, { recursive: true,
        filter: source => !relative(installed, source).split(sep).includes('node_modules') });
      if (options.withoutFile) await unlink(child(copy, options.withoutFile));
      if (options.withoutDependency) {
        const manifestPath = join(copy, 'package.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        if (!Object.hasOwn(manifest.dependencies ?? {}, options.withoutDependency)) throw new Error('The negative fixture must remove a real declared dependency');
        delete manifest.dependencies[options.withoutDependency];
        await writeFile(manifestPath, JSON.stringify(manifest));
      }
      artifact = await pack(copy, join(this.directory, 'altered-artifact'));
    }
    await this.installInto(this.consumer, artifact);
    await cp(join(resources, 'consumer.mjs'), join(this.consumer, 'consumer.mjs'));
    if (options.withoutDependency) await this.verifyDependencyAbsent(options.withoutDependency);
  }
  private async installInto(directory: string, artifact: string): Promise<void> {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'expec-package-consumer', private: true, type: 'module' }));
    await npm(directory, ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock', artifact]);
  }
  async check(text: string): Promise<void> {
    const source = join(this.consumer, 'source.expec');
    await writeFile(source, text);
    this.result = await run(process.execPath, ['consumer.mjs', source], this.consumer);
    await this.readReport();
  }
  async deliverKotlinCli(source: string): Promise<void> {
    for (const name of ['checkout-guard.mjs', 'kotlin-cli-consumer.mjs']) await cp(join(resources, name), join(this.consumer, name));
    await writeFile(join(this.consumer, 'kotlin-cli.json'), JSON.stringify({source}));
    this.result = await run(process.execPath, ['kotlin-cli-consumer.mjs', 'kotlin-cli.json'], this.consumer, 600_000, {EXPEC_DENIED_CHECKOUT:checkout});
    await this.readReport();
  }
  async deliverKotlin(source: string): Promise<void> {
    for (const name of ['checkout-guard.mjs', 'kotlin-consumer.mjs']) await cp(join(resources, name), join(this.consumer, name));
    await writeFile(join(this.consumer, 'kotlin.json'), JSON.stringify({ source }));
    this.result = await run(process.execPath, ['kotlin-consumer.mjs', 'kotlin.json'], this.consumer, 600_000, { EXPEC_DENIED_CHECKOUT: checkout });
    await this.readReport();
  }
  async packedBytes(): Promise<number> { return (await stat(PackageDriver.artifact)).size; }
  async checkFromInstalledCommand(): Promise<void> {
    await cp(join(resources, 'cli-consumer.mjs'), join(this.consumer, 'cli-consumer.mjs'));
    this.result = await run(process.execPath, ['cli-consumer.mjs'], this.consumer); await this.readReport();
  }
  async pythonCommand(input: { command: string; source?: string; copies?: number }): Promise<unknown> {
    for (const name of ['python-cli-consumer.mjs', 'python-cli-guard.mjs', 'python-public.mts'])
      await cp(join(resources, name), join(this.consumer, name));
    await cp(join(checkout, 'test/resources/python/basket.py'), join(this.consumer, 'basket.py'));
    const checkoutFile = join(checkout, 'src/index.ts'); await stat(checkoutFile);
    await writeFile(join(this.consumer, 'python-cli-input.json'), JSON.stringify({ ...input, checkoutFile }));
    this.result = await run(process.execPath, ['python-cli-consumer.mjs'], await realpath(this.consumer), 720_000);
    await this.readReport();
    if (this.result.code !== 0) throw Error('Installed Python consumer failed. ' + output(this.result));
    return this.report;
  }
  async buildPublicCatalog(source: string): Promise<void> {
    await cp(join(resources, 'cli-catalog-consumer.mjs'), join(this.consumer, 'cli-catalog-consumer.mjs'));
    const checkoutFile = join(checkout, 'src/index.ts');
    await stat(checkoutFile);
    await writeFile(join(this.consumer, 'catalog-input.json'), JSON.stringify({ source, checkoutFile }));
    const consumer = await realpath(this.consumer);
    this.result = await run(process.execPath, ['--permission', '--allow-fs-read=' + consumer,
      '--allow-fs-write=' + consumer, 'cli-catalog-consumer.mjs'], consumer);
    if (this.result.code !== 0) throw Error('Installed catalog failed. ' + output(this.result));
    const { packageUrl, ...observed } = JSON.parse(await readFile(join(this.consumer, 'catalog-observed.json'), 'utf8'));
    this.report = { packageUrl, customCli: { ...observed, result: JSON.parse(this.result.stdout) } };
    this.location = await packageLocation(this.consumer, fileURLToPath(packageUrl));
  }
  async generateShoppingAcceptance(): Promise<void> {
    await npm(this.consumer, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', 'vitest@5.0.2', '@types/node@24.13.6']);
    await cp(join(resources, 'acceptance-consumer.mjs'), join(this.consumer, 'acceptance-consumer.mjs'));
    this.result = await run(process.execPath, ['acceptance-consumer.mjs'], this.consumer); await this.readReport();
  }
  async runHttpLifecycle(): Promise<void> {
    await npm(this.consumer, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', 'vitest@5.0.2', '@types/node@24.13.6']);
    await cp(join(resources, 'execution-consumer.mjs'), join(this.consumer, 'execution-consumer.mjs'));
    await cp(join(checkout, 'test/resources/scenario-execution'), join(this.consumer, 'resources'), { recursive: true });
    this.result = await run(process.execPath, ['execution-consumer.mjs'], this.consumer); await this.readReport();
  }
  async applyWriteAfterNativeReplacement(input: { library: string; before: string; after: string; file: string; text: string }): Promise<void> {
    await cp(join(resources, 'native-input-consumer.mjs'), join(this.consumer, 'native-input-consumer.mjs'));
    await writeFile(join(this.consumer, 'native-input.json'), JSON.stringify(input));
    this.result = await run(process.execPath, ['native-input-consumer.mjs', 'native-input.json'], this.consumer);
    await this.readReport();
  }
  async preserveJava(input: { source:string; revised:string; implementation:string; caller:string }): Promise<void> {
    await cp(join(resources,'java-consumer.mjs'),join(this.consumer,'java-consumer.mjs'));
    await cp(join(checkout,'test/resources/java-project/build.gradle'),join(this.consumer,'java-capture.gradle'));
    await writeFile(join(this.consumer,'java-input.json'),JSON.stringify(input));
    this.result=await run(process.execPath,['java-consumer.mjs'],this.consumer); await this.readReport();
  }
  async javaCommands(input: { source: string; revised: string }): Promise<void> {
    await cp(join(resources, 'java-cli-consumer.mjs'), join(this.consumer, 'java-cli-consumer.mjs'));
    await cp(join(resources, 'java-cli-guard.mjs'), join(this.consumer, 'java-cli-guard.mjs'));
    const checkoutFile = join(checkout, 'src/index.ts'); await stat(checkoutFile);
    await writeFile(join(this.consumer, 'java-cli-input.json'), JSON.stringify({ ...input, checkoutFile }));
    this.result = await run(process.execPath, ['java-cli-consumer.mjs'], this.consumer, 300_000); await this.readReport();
  }
  async preserveTypeScript(input: { source: string; revised: string; implementation: string; caller: string }): Promise<void> {
    await cp(join(resources, 'preservation-consumer.mjs'), join(this.consumer, 'preservation-consumer.mjs'));
    await writeFile(join(this.consumer, 'preservation.json'), JSON.stringify(input));
    this.result = await run(process.execPath, ['preservation-consumer.mjs', 'preservation.json'], this.consumer);
    await this.readReport();
  }
  async compileWorkspace(files: Record<string, string>, entries: string[]): Promise<void> {
    await cp(join(resources, 'workspace-consumer.mjs'), join(this.consumer, 'workspace-consumer.mjs'));
    await writeFile(join(this.consumer, 'workspace.json'), JSON.stringify({ files, entries }));
    this.result = await run(process.execPath, ['workspace-consumer.mjs'], this.consumer); await this.readReport();
  }
  async captureNativeDependencies(packages: Record<string, string>): Promise<void> {
    const installed = await npm(this.consumer, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock',
      ...Object.entries(packages).map(([name, version]) => name + '@' + version)]);
    if (installed.code !== 0) throw Error(installed.stdout + installed.stderr);
    await cp(join(resources, 'native-context.mjs'), join(this.consumer, 'native-context.mjs'));
    this.result = await run(process.execPath, ['native-context.mjs'], this.consumer);
    await this.readReport();
  }
  async provideDependencies(parent = ''): Promise<void> {
    this.native = new NativePackageDriver(); await this.native.initialize('project', parent);
    await this.native.publish('example-storage', '2.1.0');
    await this.native.file('libraries/books/package.json', JSON.stringify({ name: 'book-contracts', version: '1.2.0', expec: { entry: './index.expec' } }));
    await this.native.file('libraries/books/index.expec', 'use Title from "./types.expec"\ntype Book { title: Title }');
    await this.native.file('libraries/books/types.expec', 'type Title = Text');
    await cp(join(resources, 'dependency-consumer.mjs'), join(this.consumer, 'dependency-consumer.mjs'));
  }
  async acquireDependencies(command: 'install' | 'compile', source = ''): Promise<void> {
    if (!this.native) throw Error('Prepare the actual library and native registry first.');
    await writeFile(join(this.consumer, 'dependencies.json'), JSON.stringify({ root: this.native.root, command: npmCommand(), source }));
    this.result = await run(process.execPath, ['dependency-consumer.mjs', command], this.consumer); await this.readReport();
  }
  typescriptInsideConsumer = false;
  compilerInsideProject = false;
  async initializeProject(root: string, target: string): Promise<void> {
    await cp(join(resources, 'initialization-consumer.mjs'), join(this.consumer, 'initialization-consumer.mjs'));
    await writeFile(join(this.consumer, 'initialization.json'), JSON.stringify({ root, target, npm: npmExecutable() }));
    this.result = await run(process.execPath, ['initialization-consumer.mjs', 'initialization.json'], this.consumer);
    await this.readReport();
    const path = this.report.initialization?.typescript?.location, selectedRoot = this.report.initialization?.selectedRoot?.actual;
    this.compilerInsideProject = !!path && !!selectedRoot && contained(join(selectedRoot, 'node_modules'), await realpath(path));
  }
  async generateTypeScript(source: string, validConsumer: string, invalidConsumer: string, revised: string, handwrittenParameter: string): Promise<void> {
    await cp(join(resources, 'typescript-output-consumer.mjs'), join(this.consumer, 'typescript-output-consumer.mjs'));
    await writeFile(join(this.consumer, 'typescript-output.json'), JSON.stringify({ source, validConsumer, invalidConsumer, revised, handwrittenParameter }));
    this.result = await run(process.execPath, ['typescript-output-consumer.mjs', 'typescript-output.json'], this.consumer);
    await this.readReport();
    const path = this.report.typescriptOutput?.typescript.location;
    this.typescriptInsideConsumer = !!path && contained(join(await realpath(this.consumer), 'node_modules'), await realpath(path));
  }
  async readTypeScriptProject(files: Record<string, string>): Promise<void> {
    await cp(join(resources, 'project-reading.mjs'), join(this.consumer, 'project-reading.mjs'));
    await writeFile(join(this.consumer, 'project.json'), JSON.stringify({ files }));
    this.result = await run(process.execPath, ['project-reading.mjs', 'project.json'], this.consumer);
    await this.readReport();
    const path = this.report.projectReading?.typescript.location;
    this.typescriptInsideConsumer = !!path && contained(join(await realpath(this.consumer), 'node_modules'), await realpath(path));
  }
  async documentProject(source: string, note: string): Promise<void> {
    await cp(join(resources, 'markdown-consumer.mjs'), join(this.consumer, 'markdown-consumer.mjs'));
    await writeFile(join(this.consumer, 'documentation.json'), JSON.stringify({ source, note }));
    this.result = await run(process.execPath, ['markdown-consumer.mjs', 'documentation.json'], this.consumer);
    await this.readReport();
  }
  async writeProject(before: string, after: string): Promise<void> {
    await cp(join(resources, 'writer.mjs'), join(this.consumer, 'writer.mjs'));
    await writeFile(join(this.consumer, 'write.json'), JSON.stringify({ before, after }));
    this.result = await run(process.execPath, ['writer.mjs', 'write.json'], this.consumer);
    await this.readReport();
  }
  async diagramProject(source: string): Promise<void> {
    for (const name of ['diagram-guard.mjs', 'diagram-consumer.mjs']) await cp(join(resources, name), join(this.consumer, name));
    await writeFile(join(this.consumer, 'diagram.json'), JSON.stringify({ source }));
    this.result = await run(process.execPath, ['--import', './diagram-guard.mjs', 'diagram-consumer.mjs', 'diagram.json'], this.consumer);
    await this.readReport();
  }
  diagramResourceInsidePackage(path: string): boolean { return contained(join(this.consumer, 'node_modules/@d2lang/d2'), path) || path === join(this.consumer, 'diagram-guard.mjs'); }
  async registerCountOutput(): Promise<void> {
    for (const name of ['count-adapter.mts', 'output-consumer.mjs']) await cp(join(resources, name), join(this.consumer, name));
  }
  async createCountReport(text: string, directory: string): Promise<void> {
    this.countInput = { text, options: { directory } };
    await mkdir(join(this.consumer, 'project'));
    await writeFile(join(this.consumer, 'project/handwritten.txt'), 'Keep my notes.');
    await this.countCommand('create');
  }
  async readCountReport(subject: string): Promise<void> {
    const definition = this.countReports.create?.counts?.subjects.find(item => item.name === subject);
    if (!definition) throw Error('The generated report did not define ' + subject);
    this.countInput.subjectId = definition.id;
    await this.countCommand('read');
  }
  async writeCountConsumer(title: string): Promise<void> {
    this.countInput.title = title;
    await this.countCommand('consumer');
  }
  searchCountReport(): Promise<void> { return this.countCommand('search'); }
  private async countCommand(command: string): Promise<void> {
    await writeFile(join(this.consumer, 'output.json'), JSON.stringify(this.countInput));
    this.result = await run(process.execPath, ['output-consumer.mjs', command], this.consumer);
    await this.readReport();
    if (this.result.code !== 0 || !this.report.output) throw Error('Installed output consumer failed. ' + output(this.result));
    this.countReports[command] = this.report.output;
  }
  private async readReport(): Promise<void> {
    try { this.report = JSON.parse(this.result.stdout); }
    catch { throw new Error(`Consumer did not return observations. ${output(this.result)}`); }
    if (this.report.packageUrl) {
      this.location = await packageLocation(this.consumer, fileURLToPath(this.report.packageUrl));
    }
  }
  async checkTypeScript(): Promise<void> {
    for (const name of ['consumer.mts', 'count-adapter.mts']) await cp(join(resources, name), join(this.consumer, name));
    await writeFile(join(this.consumer, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', strict: true,
        exactOptionalPropertyTypes: true, skipLibCheck: true, noEmit: true, types: [] },
      files: ['consumer.mts', 'count-adapter.mts'],
    }));
    this.declarations = await run(process.execPath, [require.resolve('typescript/bin/tsc'), '--pretty', 'false', '-p', 'tsconfig.json'], this.consumer);
  }
  private async verifyDependencyAbsent(name: string): Promise<void> {
    const graph = await run(process.execPath, [npmExecutable(), 'ls', name, '--all', '--json'], this.consumer);
    const installed = (entry: { dependencies?: Record<string, typeof entry> }): boolean =>
      !!entry.dependencies && (Object.hasOwn(entry.dependencies, name) || Object.values(entry.dependencies).some(installed));
    if (installed(JSON.parse(graph.stdout))) throw new Error(`Negative fixture still has ${name} in its installed graph`);
    const entry = join(this.consumer, 'node_modules', packageName, 'dist/index.js');
    for (const directory of createRequire(entry).resolve.paths(name) ?? []) {
      try { await stat(join(directory, name)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      throw new Error(`Negative fixture can find ${name} at ${directory}`);
    }
  }
  async dispose(): Promise<void> { if (this.native) await this.native.dispose(); if (this.directory) await cleanup(this.directory); }
}

export async function packageLocation(consumer: string, entry: string) {
  const installed = join(await realpath(consumer), 'node_modules', packageName), real = await realpath(entry);
  return { expected: join(installed, 'dist/index.js'), real, insidePackage: contained(installed, real) };
}

async function pack(directory: string, destination: string, release = false): Promise<string> {
  await mkdir(destination, { recursive: true });
  await npm(directory, [...(release ? ['run', 'release', '--'] : ['pack']), '--ignore-scripts', '--pack-destination', destination]);
  const archives = (await readdir(destination)).filter(name => name.endsWith('.tgz'));
  if (archives.length !== 1) throw new Error(`Expected one packed artifact, found ${archives.length}`);
  return join(destination, archives[0]!);
}
function npmExecutable(): string {
  const executable = process.env.npm_execpath;
  if (!executable || !isAbsolute(executable)) throw new Error('Run the package suite with npm run test:package so its pinned npm executable is available');
  return executable;
}
async function npm(directory: string, args: string[]): Promise<ProcessResult> {
  const result = await run(process.execPath, [npmExecutable(), ...args], directory);
  if (result.code !== 0) throw new Error(`npm ${args[0]} failed. ${output(result)}`);
  return result;
}
async function run(executable: string, args: string[], cwd: string, timeout = 120_000, environment: Record<string, string> = {}): Promise<ProcessResult> {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !['NODE_PATH', 'NODE_OPTIONS'].includes(key.toUpperCase()))), ...environment };
  try {
    const result = await execute(executable, args, { cwd, env, timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', windowsHide: true });
    return { code: 0, ...result };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
    if (typeof failure.code !== 'number' || failure.killed) throw error;
    return { code: failure.code, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}
function output(result: ProcessResult): string { return `Exit ${result.code}\n${result.stdout}\n${result.stderr}`; }
function contained(parent: string, path: string): boolean {
  const inside = relative(resolve(parent), resolve(path));
  return !!inside && !isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`);
}
function child(parent: string, path: string): string {
  const target = resolve(parent, path);
  if (!contained(parent, target)) throw new Error('Fixture path must stay inside its owned directory');
  return target;
}
async function cleanup(directory: string): Promise<void> {
  const name = relative(await realpath(tmpdir()), resolve(directory));
  if (isAbsolute(name) || name.includes(sep) || !name.startsWith('expec-package-')) throw new Error('Refusing to remove an unexpected fixture directory');
  const trace = (status: string, elapsedMs?: number, error?: unknown): void => {
    if (process.env.EXPEC_CLEANUP_TIMINGS !== '1') return;
    try {
      const failure = error as NodeJS.ErrnoException | undefined;
      console.info('[fixture-cleanup]', JSON.stringify({ directory, pid: process.pid, at: new Date().toISOString(),
        status, elapsedMs, code: failure?.code, syscall: failure?.syscall }));
    } catch { /* Diagnostics must not replace the removal result. */ }
  };
  trace('started');
  const start = performance.now();
  try { await rm(directory, { recursive: true, force: true }); }
  catch (error) { trace('rejected', performance.now() - start, error); throw error; }
  trace('fulfilled', performance.now() - start);
}
