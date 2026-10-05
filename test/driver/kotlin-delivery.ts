import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Compiler, ConfigurationReader, FileProjectWriter, KotlinContext, KotlinDependencies, kotlinOutput, LangiumModel, LangiumReader, Outputs, ProjectConnector, ProjectInitializer, SourceComposer, SpecificationIdentity,
  type Check, type Configuration, type InitializationPlan, type InitializationResult, type IdentifiedSpecification, type ModuleModel, type Output, type OutputPlan, type OutputWrite, type PackageRead, type ProjectContext, type ProjectRead, type ProjectSearch, type SpecDiff, type Specification } from '../../src/index.js';

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
  planned!: Check<OutputPlan>;
  options: Record<string, unknown> = {};
  private readonly externalModules: ModuleModel[] = [];
  private sourceText = '';
  private workspaceModules: string[] = ['main'];
  searchResult!: ProjectSearch;
  readResult!: ProjectRead;
  files = new Map<string, string>();
  consumer = '';
  compiled = { code: -1, stdout: '', stderr: '' };
  execution = { code: -1, stdout: '', stderr: '' };
  packages!: PackageRead;
  async installLocalLibrary(coordinate: string, version: string, source: string, packageName: string): Promise<void> {
    const [group, artifact] = coordinate.split(':');
    if (!group || !artifact) throw Error('Supply the fixture Maven group and artifact.');
    const repository = join(this.directory, 'repository'), directory = join(repository, ...group.split('.'), artifact, version);
    await fs.mkdir(directory, { recursive: true });
    const input = join(this.directory, 'Library.kt'); await fs.writeFile(input, 'package ' + packageName + '\n' + source);
    const native = await this.native();
    const compiled = await this.run(native.java, ['-cp', native.jars.join(delimiter), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
      '-no-stdlib', '-no-reflect', '-classpath', native.stdlib, '-jvm-target', '21', '-d', join(directory, artifact + '-' + version + '.jar'), input]);
    if (compiled.code !== 0) throw Error(compiled.stderr);
    await fs.writeFile(join(directory, artifact + '-' + version + '.pom'),
      '<project><modelVersion>4.0.0</modelVersion><groupId>' + group + '</groupId><artifactId>' + artifact
      + '</artifactId><version>' + version + '</version></project>');
    await this.appendBuild('repositories { maven { url = uri(' + JSON.stringify(pathToFileURL(repository).href) + ') } }');
    this.configuration = { ...this.configuration, packages: [...this.configuration.packages,
      { alias: artifact, name: 'maven:' + coordinate, version, phases: ['runtime'] }] };
    await this.acquire(true);
  }
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
  async configureNative(testLibraries: readonly string[] = []): Promise<void> {
    const javaHome = process.env.EXPEC_TEST_JAVA_HOME ?? process.env.JAVA_HOME;
    if (!javaHome) throw new Error('Supply an actual JDK21 for native acceptance.');
    const sourceRoots = { main: ['src/main/kotlin'], test: ['src/test/kotlin'] };
    await this.file('expec.kotlin.json', JSON.stringify({ javaHome, sourceRoots }));
    await this.file('build.gradle.kts', 'plugins { kotlin("jvm") version "2.4.10" }\n');
    await this.file('settings.gradle.kts', 'rootProject.name = "kotlin-acceptance"\n');
    const library = resolve('src/project/kotlin/resources/lib/kotlin-stdlib-2.4.10.jar');
    const inputs = (await this.context.readSnapshot()).files.map(file => ({ path: file.path, version: file.version }));
    await this.file('.expec/kotlin/classpath.json', JSON.stringify({ format: 1, kotlin: '2.4.10', gradle: '9.1.0', jvmTarget: '21', javaHome, sourceRoots,
      classPath: { main: [library], test: [library, ...testLibraries] }, runtimeClassPath: { main: [library], test: [library, ...testLibraries] }, packages: [], inputs }));
    this.context = new KotlinContext(this.context);
  }
  protected model(module: string, text: string): ModuleModel {
    const read = new LangiumReader().read({ sourceId: module + '.expec', text });
    if (read.status !== 'accepted') throw new Error(JSON.stringify(read));
    return new LangiumModel(module, read.document);
  }
  external(module: string, text: string): void { this.externalModules.push(this.model(module, text)); }
  workspace(texts: Record<string, string>): void {
    const models = Object.entries(texts).map(([module, text]) => this.model(module, text)); this.workspaceModules = models.map(model => model.locator);
    const result = new Compiler().compile({ resolution: new SourceComposer().compose(models.map(entry => ({ entry,
      dependencies: { modules: [...models.filter(model => model !== entry), ...this.externalModules], packages: [] } }))) });
    if (!result.value) throw new Error(JSON.stringify(result)); this.identify(result.value);
  }
  source(text: string, renames: Readonly<Record<string, string>> = {}, retire: readonly string[] = []): void {
    this.sourceFile('main', text, renames, retire);
  }
  sourceFile(module: string, text: string, renames: Readonly<Record<string, string>> = {}, retire: readonly string[] = []): void {
    this.sourceText = text; this.workspaceModules = [module];
    const result = new Compiler().compile({ resolution: new SourceComposer().compose(this.model(module, text), { modules: this.externalModules, packages: [] }) });
    if (!result.value) throw new Error(JSON.stringify(result));
    this.identify(result.value, renames, retire);
  }
  moveSource(module: string, names: string[]): void { this.sourceFile(module, this.sourceText, Object.fromEntries(names.map(name => [name, name]))); }
  associate(name: string, file: string, declaration: { kind: string; name: string; parameters?: string[] }[]): void {
    const result = this.identity.withArtifacts(this.current, [...this.current.baseline.artifacts, { specId: this.subject(this.current, name),
      locator: { outputId: 'kotlin', format: 'kotlin-symbol-1', value: { file, declaration } },
    }]);
    if (!result.value) throw new Error(JSON.stringify(result)); this.current = result.value;
  }
  protected identify(specification: Specification, renames: Readonly<Record<string, string>> = {}, retire: readonly string[] = [], decisions: readonly ({ id: string; to: import('../../src/index.js').NodeId } | { retire: string })[] = []): void {
    const previous = this.current;
    const proposed = this.identity.associate(specification);
    if (!proposed.value) throw new Error(JSON.stringify(proposed));
    const identified = previous ? this.identity.associate(specification, previous.baseline, [...decisions, ...Object.entries(renames).map(([before, after]) => ({
      id: this.subject(previous, before), to: proposed.value!.node(this.subject(proposed.value!, after)),
    })), ...retire.map(name => ({ retire: this.subject(previous, name) }))]) : proposed;
    if (!identified.value) throw new Error(JSON.stringify(identified)); this.current = identified.value;
    if (previous) { const compared = this.identity.compare(previous.baseline, this.current); if (!compared.value) throw new Error(JSON.stringify(compared)); this.diff = compared.value; }
  }
  identifier(module: string, path: string[]): string {
    const found = this.current.baseline.elements.find(item => item.address.module === module && this.subjectPath(this.current, item.id) === path.join('.'));
    if (!found) throw new Error('Missing fixture identity ' + module + ':' + path.join('.')); return found.id;
  }
  private open() {
    const opened = this.outputs.open('kotlin', { directory: 'src/main/kotlin', package: 'store', ...this.options }, this.context, new FileProjectWriter(this.context), { workspaceModules: this.workspaceModules });
    if (opened.value) this.output = opened.value; return opened;
  }
  async plan(): Promise<void> {
    const opened = this.open(); this.planned = opened.value ? await opened.value.plan({ operation: 'create', current: this.current }, await this.context.readSnapshot()) : { problems: opened.problems, deferred: [] };
  }
  async build(): Promise<void> {
    const opened = this.open();
    this.written = opened.value ? await opened.value.create(this.current) : { problems: opened.problems };
    this.files = new Map((await this.context.readSnapshot()).files.map(file => [file.path, Buffer.from(file.bytes).toString('utf8')]));
  }
  async file(path: string, text: string): Promise<void> { await fs.mkdir(dirname(join(this.root, path)), { recursive: true }); await fs.writeFile(join(this.root, path), text); }
  async replace(path: string, before: string, after: string): Promise<void> {
    const text = await fs.readFile(join(this.root, path), 'utf8');
    if (!text.includes(before)) throw new Error('Fixture replacement did not match: ' + before);
    await this.file(path, text.replace(before, after));
  }
  async appendBuild(text: string): Promise<void> { await this.file('build.gradle.kts', await fs.readFile(join(this.root, 'build.gradle.kts'), 'utf8') + '\n' + text); }
  async capturedFiles(): Promise<Map<string, string>> { return new Map((await this.context.readSnapshot()).files.map(file => [file.path, Buffer.from(file.bytes).toString('utf8')])); }
  async update(): Promise<void> {
    const opened = this.open(); this.written = opened.value ? await opened.value.update(this.diff, this.current) : { problems: opened.problems };
    this.files = new Map((await this.context.readSnapshot()).files.map(file => [file.path, Buffer.from(file.bytes).toString('utf8')]));
  }
  async delete(name: string): Promise<void> {
    const opened = this.open(); this.written = opened.value ? await opened.value.delete(this.subject(this.current, name)) : { problems: opened.problems };
    this.files = await this.capturedFiles();
  }
  async duplicateContributionEvidence(): Promise<void> {
    const path = '.expec/kotlin/dependencies.gradle.kts', reportPath = '.expec/kotlin/classpath.json';
    const report = JSON.parse(await fs.readFile(join(this.root, reportPath), 'utf8')) as { inputs: { path: string; version: string }[] };
    report.inputs.unshift({ path, version: createHash('sha256').update(await fs.readFile(join(this.root, path))).digest('hex') });
    await this.file(reportPath, JSON.stringify(report));
  }
  async appendContribution(text: string): Promise<void> {
    const path = '.expec/kotlin/dependencies.gradle.kts';
    await this.file(path, await fs.readFile(join(this.root, path), 'utf8') + '\n' + text + '\n');
  }
  async projectBytes(): Promise<Map<string, Uint8Array>> {
    return new Map((await this.context.readSnapshot()).files.map(file => [file.path, Uint8Array.from(file.bytes)]));
  }
  async search(name: string): Promise<void> { this.searchResult = await this.output.search(this.subject(this.current, name)); }
  async read(name: string): Promise<void> { this.readResult = await this.output.read(this.subject(this.current, name)); }
  private subjectPath(current: IdentifiedSpecification, id: string): string {
    const record = current.baseline.elements.find(record => record.id === id)!;
    return (record.address.owner ? this.subjectPath(current, record.address.owner) + '.' : '') + (record.address.name ?? record.address.kind);
  }
  subject(current: IdentifiedSpecification, name: string): string {
    const subject = current.baseline.elements.find(record => this.subjectPath(current, record.id) === name);
    if (!subject) throw new Error('Missing source subject ' + name); return subject.id;
  }
  protected async native(): Promise<{ java: string; jars: string[]; stdlib: string }> {
    const javaHome = process.env.EXPEC_TEST_JAVA_HOME ?? process.env.JAVA_HOME;
    if (!javaHome || !isAbsolute(javaHome)) throw new Error('Kotlin acceptance requires explicit EXPEC_TEST_JAVA_HOME or JAVA_HOME (JDK21).');
    const libraries = process.env.EXPEC_TEST_KOTLIN_LIB ?? resolve('src/project/kotlin/resources/lib');
    const jars = (await fs.readdir(libraries)).filter(name => name.endsWith('.jar')).map(name => join(libraries, name));
    const stdlib = jars.find(path => /[\\/]kotlin-stdlib-2\.4\.10\.jar$/.test(path));
    if (!stdlib) throw new Error('Build the pinned Kotlin bridge before native acceptance.');
    return { java: join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), jars, stdlib };
  }
  async compile(consumer: string): Promise<void> {
    this.consumer = consumer;
    const input = join(this.directory, 'Consumer.kt'); await fs.writeFile(input, consumer);
    const native = await this.native();
    const report = JSON.parse(await fs.readFile(join(this.root, '.expec/kotlin/classpath.json'), 'utf8'));
    this.compiled = await this.run(native.java, ['-cp', native.jars.join(delimiter), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
      '-no-stdlib', '-no-reflect', '-classpath', report.classPath.main.join(delimiter), '-jvm-target', '21', '-d', join(this.directory, 'classes'),
      ...[...this.files.keys()].filter(path => path.endsWith('.kt') && report.sourceRoots.main.some((root: string) => path.startsWith(root + '/'))).map(path => join(this.root, path)), input]);
  }
  async execute(consumer: string): Promise<void> {
    await this.compile(consumer); if (this.compiled.code !== 0) return;
    const native = await this.native(), report = JSON.parse(await fs.readFile(join(this.root, '.expec/kotlin/classpath.json'), 'utf8'));
    this.execution = await this.run(native.java, ['-cp', [join(this.directory, 'classes'), ...report.runtimeClassPath?.main ?? [native.stdlib]].join(delimiter), 'ConsumerKt']);
  }
  protected async run(command: string, args: string[]) {
    try { return { ...await promisify(execFile)(command, args, { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true }), code: 0 }; }
    catch (error) { const result = error as { code?: number; stdout?: string; stderr?: string }; return { code: typeof result.code === 'number' ? result.code : -1, stdout: result.stdout ?? '', stderr: result.stderr ?? String(error) }; }
  }
  async dispose(): Promise<void> {
    const path = relative(this.temporary, this.directory);
    if (isAbsolute(path) || path.includes(sep) || !path.startsWith('expec-kotlin-') || resolve(this.temporary, path) !== this.directory) throw new Error('Unsafe fixture cleanup.');
    await fs.rm(this.directory, { recursive: true, force: true });
  }
}
