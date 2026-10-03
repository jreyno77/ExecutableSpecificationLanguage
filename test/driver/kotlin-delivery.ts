import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Compiler, ConfigurationReader, FileProjectWriter, KotlinContext, KotlinDependencies, kotlinOutput, LangiumModel, LangiumReader, Outputs, ProjectConnector, ProjectInitializer, SourceComposer, SpecificationIdentity,
  type Check, type Configuration, type InitializationPlan, type InitializationResult, type IdentifiedSpecification, type Output, type OutputWrite, type PackageRead, type ProjectContext, type ProjectRead, type ProjectSearch, type SpecDiff } from '../../src/index.js';

/** Reaches the connected project and the actual pinned Kotlin compiler/JVM. */
export class KotlinDeliveryDriver {
  readonly outputs = new Outputs();
  readonly identity = new SpecificationIdentity(() => 'kotlin-example-' + ++this.sequence);
  private sequence = 0;
  temporary = '';
  directory = '';
  root = '';
  manifest = '';
  configuration!: Configuration;
  initializer!: ProjectInitializer;
  prepared!: Check<InitializationPlan>;
  initialized!: InitializationResult;
  context!: ProjectContext;
  current!: IdentifiedSpecification;
  diff!: SpecDiff;
  written!: OutputWrite;
  output!: Output;
  searchResult!: ProjectSearch;
  readResult!: ProjectRead;
  files = new Map<string, string>();
  consumer = '';
  compiled = { code: -1, stdout: '', stderr: '' };
  execution = { code: -1, stdout: '', stderr: '' };
  packages!: PackageRead;
  async acquire(install: boolean): Promise<void> {
    const dependencies = new KotlinDependencies(this.root);
    this.packages = await (install ? dependencies.install(this.configuration.packages) : dependencies.read(this.configuration.packages));
    if (install && this.packages.value) this.context = new KotlinContext(this.initialized.value!.context);
    this.files = await this.capturedFiles();
  }
  async initialize(): Promise<void> {
    this.outputs.register(kotlinOutput);
    this.temporary = await fs.realpath(tmpdir());
    this.directory = await fs.realpath(await fs.mkdtemp(join(this.temporary, 'expec-kotlin-')));
    this.root = join(this.directory, 'project'); await fs.mkdir(this.root);
    const manifest = this.manifest = join(this.directory, 'expec.json');
    const configuration = new ConfigurationReader(this.outputs.profiles).read({ sourceId: manifest,
      text: JSON.stringify({ formatVersion: 1, version: '0.1.0', project: { root: 'project' }, build: { entries: ['main.expec'] } }) });
    if (!configuration.value) throw new Error(JSON.stringify(configuration));
    this.configuration = configuration.value;
    const connection = await new ProjectConnector(manifest, { excludeNames: ['.git', 'node_modules', '.gradle', '.kotlin', 'build'] }).connect(configuration.value);
    if (connection.value?.status !== 'connected') throw new Error(JSON.stringify(connection));
    this.context = connection.value.context;
  }
  async prepareKotlin(): Promise<void> {
    this.initializer = new ProjectInitializer(this.manifest, this.configuration);
    const javaHome = process.env.EXPEC_TEST_JAVA_HOME ?? process.env.JAVA_HOME;
    this.prepared = await this.initializer.prepare({ root: 'project', target: 'kotlin', ...javaHome ? { javaHome } : {} });
  }
  async initializeKotlin(accepted: boolean): Promise<void> {
    if (!this.prepared.value) throw new Error(JSON.stringify(this.prepared));
    this.initialized = await this.initializer.apply(this.prepared.value, accepted);
    if (this.initialized.value) { this.context = this.initialized.value.context; this.configuration = this.initialized.value.configuration; }
    this.files = await this.capturedFiles();
  }
  async configureNative(): Promise<void> {
    const javaHome = process.env.EXPEC_TEST_JAVA_HOME ?? process.env.JAVA_HOME;
    if (!javaHome) throw new Error('Supply an actual JDK21 for native acceptance.');
    const sourceRoots = { main: ['src/main/kotlin'], test: ['src/test/kotlin'] };
    await this.file('expec.kotlin.json', JSON.stringify({ javaHome, sourceRoots }));
    await this.file('build.gradle.kts', 'plugins { kotlin("jvm") version "2.4.10" }\n');
    await this.file('settings.gradle.kts', 'rootProject.name = "kotlin-acceptance"\n');
    const library = resolve('src/kotlin/lib/kotlin-stdlib-2.4.10.jar');
    const inputs = (await this.context.readSnapshot()).files.map(file => ({ path: file.path, version: file.version }));
    await this.file('.expec/kotlin/classpath.json', JSON.stringify({ format: 1, kotlin: '2.4.10', gradle: '9.1.0', jvmTarget: '21', javaHome, sourceRoots,
      classPath: { main: [library], test: [library] }, packages: [], inputs }));
    this.context = new KotlinContext(this.context);
  }
  source(text: string, renames: Readonly<Record<string, string>> = {}, retire: readonly string[] = []): void {
    const read = new LangiumReader().read({ sourceId: 'main.expec', text });
    if (read.status !== 'accepted') throw new Error(JSON.stringify(read));
    const result = new Compiler().compile({ resolution: new SourceComposer().compose(new LangiumModel('main', read.document), { modules: [], packages: [] }) });
    if (!result.value) throw new Error(JSON.stringify(result));
    const previous = this.current;
    const proposed = this.identity.associate(result.value);
    if (!proposed.value) throw new Error(JSON.stringify(proposed));
    const identified = previous ? this.identity.associate(result.value, previous.baseline, [...Object.entries(renames).map(([before, after]) => ({
      id: this.subject(previous, before), to: proposed.value!.node(this.subject(proposed.value!, after)),
    })), ...retire.map(name => ({ retire: this.subject(previous, name) }))]) : proposed;
    if (!identified.value) throw new Error(JSON.stringify(identified)); this.current = identified.value;
    if (previous) { const compared = this.identity.compare(previous.baseline, this.current); if (!compared.value) throw new Error(JSON.stringify(compared)); this.diff = compared.value; }
  }
  async build(): Promise<void> {
    const opened = this.outputs.open('kotlin', { directory: 'src/main/kotlin', package: 'store' }, this.context, new FileProjectWriter(this.context));
    if (opened.value) this.output = opened.value;
    this.written = opened.value ? await opened.value.create(this.current) : { problems: opened.problems };
    this.files = new Map((await this.context.readSnapshot()).files.map(file => [file.path, Buffer.from(file.bytes).toString('utf8')]));
  }
  async file(path: string, text: string): Promise<void> { await fs.mkdir(dirname(join(this.root, path)), { recursive: true }); await fs.writeFile(join(this.root, path), text); }
  async replace(path: string, before: string, after: string): Promise<void> {
    const text = await fs.readFile(join(this.root, path), 'utf8');
    if (!text.includes(before)) throw new Error('Fixture replacement did not match: ' + before);
    await this.file(path, text.replace(before, after));
  }
  async capturedFiles(): Promise<Map<string, string>> { return new Map((await this.context.readSnapshot()).files.map(file => [file.path, Buffer.from(file.bytes).toString('utf8')])); }
  async update(): Promise<void> {
    this.written = await this.output.update(this.diff, this.current);
    this.files = new Map((await this.context.readSnapshot()).files.map(file => [file.path, Buffer.from(file.bytes).toString('utf8')]));
  }
  async search(name: string): Promise<void> { this.searchResult = await this.output.search(this.subject(this.current, name)); }
  async read(name: string): Promise<void> { this.readResult = await this.output.read(this.subject(this.current, name)); }
  private subject(current: IdentifiedSpecification, name: string): string {
    const path = (id: string): string => { const record = current.baseline.elements.find(record => record.id === id)!; return (record.address.owner ? path(record.address.owner) + '.' : '') + record.address.name; };
    const subject = current.baseline.elements.find(record => path(record.id) === name);
    if (!subject) throw new Error('Missing source subject ' + name); return subject.id;
  }
  private async native(): Promise<{ java: string; jars: string[]; stdlib: string }> {
    const javaHome = process.env.EXPEC_TEST_JAVA_HOME ?? process.env.JAVA_HOME;
    if (!javaHome || !isAbsolute(javaHome)) throw new Error('Kotlin acceptance requires explicit EXPEC_TEST_JAVA_HOME or JAVA_HOME (JDK21).');
    const libraries = process.env.EXPEC_TEST_KOTLIN_LIB ?? resolve('src/kotlin/lib');
    const jars = (await fs.readdir(libraries)).filter(name => name.endsWith('.jar')).map(name => join(libraries, name));
    const stdlib = jars.find(path => /[\\/]kotlin-stdlib-2\.4\.10\.jar$/.test(path));
    if (!stdlib) throw new Error('Build the pinned Kotlin bridge before native acceptance.');
    return { java: join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), jars, stdlib };
  }
  async compile(consumer: string): Promise<void> {
    this.consumer = consumer;
    const input = join(this.directory, 'Consumer.kt'); await fs.writeFile(input, consumer);
    const native = await this.native();
    this.compiled = await this.run(native.java, ['-cp', native.jars.join(delimiter), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
      '-no-stdlib', '-no-reflect', '-classpath', native.stdlib, '-jvm-target', '21', '-d', join(this.directory, 'classes'),
      ...[...this.files.keys()].filter(path => path.endsWith('.kt')).map(path => join(this.root, path)), input]);
  }
  async execute(consumer: string): Promise<void> {
    await this.compile(consumer); if (this.compiled.code !== 0) return;
    const native = await this.native(); this.execution = await this.run(native.java, ['-cp', [join(this.directory, 'classes'), native.stdlib].join(delimiter), 'ConsumerKt']);
  }
  private async run(command: string, args: string[]) {
    try { return { ...await promisify(execFile)(command, args, { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true }), code: 0 }; }
    catch (error) { const result = error as { code?: number; stdout?: string; stderr?: string }; return { code: typeof result.code === 'number' ? result.code : -1, stdout: result.stdout ?? '', stderr: result.stderr ?? String(error) }; }
  }
  async dispose(): Promise<void> {
    const path = relative(this.temporary, this.directory);
    if (isAbsolute(path) || path.includes(sep) || !path.startsWith('expec-kotlin-') || resolve(this.temporary, path) !== this.directory) throw new Error('Unsafe fixture cleanup.');
    await fs.rm(this.directory, { recursive: true, force: true });
  }
}
