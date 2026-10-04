import { promises as fs, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { Compiler, ConfigurationReader, FileProjectWriter, JavaContext, JavaProject, LangiumModel, LangiumReader, Outputs, ProjectConnector, SourceComposer,
  SpecificationIdentity, javaOutput, type ArtifactAssociation, type IdentifiedSpecification, type OutputWrite, type ProjectContext, type ProjectRead, type ProjectSearch, type ProjectSnapshot } from '../../src/index.js';

export class JavaOutputDriver {
  readonly temporary = realpathSync.native(tmpdir());
  readonly directory = realpathSync.native(mkdtempSync(join(this.temporary, 'expec-java-')));
  readonly root = join(this.directory, 'project');
  ordinary!: ProjectContext;
  context!: JavaContext;
  snapshot!: ProjectSnapshot;
  remembered!: ProjectSnapshot;
  readonly associations: ArtifactAssociation[] = [];
  readResult!: ProjectRead;
  searchResult!: ProjectSearch;
  current!: IdentifiedSpecification;
  sourceText = '';
  contractOptions: Record<string, unknown> | undefined;
  workspaceModules: string[] | undefined;
  readonly libraries: LangiumModel[] = [];
  written!: OutputWrite;
  native = { code: 0, stdout: '', stderr: '' };
  protected nativeOptions: Record<string, unknown> = {};
  catalogJar!: string;
  externalSource!: string;
  async initialize(): Promise<void> {
    await fs.mkdir(this.root);
    for (const path of ['src/main/java', 'src/test/java']) await fs.mkdir(join(this.root, path), { recursive: true });
    const manifest = join(this.directory, 'expec.json');
    const configuration = new ConfigurationReader([]).read({ sourceId: manifest, text: JSON.stringify({
      formatVersion: 1, version: '0.1.0', project: { root: 'project' }, build: { entries: ['main.expec'] },
    }) });
    if (!configuration.value) throw new Error(JSON.stringify(configuration));
    const connected = await new ProjectConnector(manifest, { excludeNames: ['.git', 'node_modules', '.gradle', 'build'] }).connect(configuration.value);
    if (connected.value?.status !== 'connected') throw new Error(JSON.stringify(connected));
    this.ordinary = connected.value.context; this.context = new JavaContext(this.ordinary);
  }
  async file(path: string, text: string): Promise<void> { await fs.mkdir(dirname(join(this.root, path)), { recursive: true }); await fs.writeFile(join(this.root, path), text); }
  async configure(javaHome: string, changes: Record<string, unknown> = {}): Promise<void> {
    await this.file('expec.java.json', JSON.stringify({ format: 1, release: 21, javaHome,
      sourceRoots: { main: ['src/main/java'], test: ['src/test/java'] }, ...changes }));
  }
  async capture(): Promise<void> { this.snapshot = await this.context.readSnapshot(); }
  rememberCapture(): void { this.remembered = structuredClone(this.snapshot); }
  async searchRemembered(id: string): Promise<void> { this.searchResult = await new JavaProject({ outputId: 'java' }, this.associations).search(id, this.remembered); }
  async readRemembered(id: string): Promise<void> { this.readResult = await new JavaProject({ outputId: 'java' }, this.associations).read(id, this.remembered); }
  async nativeProject(): Promise<void> {
    const javaHome = process.env.JAVA_HOME;
    if (!javaHome) throw new Error('Java native acceptance requires an explicit JAVA_HOME for JDK 21.');
    await this.configure(javaHome, this.nativeOptions);
    await this.file('settings.gradle', "rootProject.name = 'java-consumer'\n");
    await this.file('build.gradle', await fs.readFile(fileURLToPath(new URL('../resources/java-project/build.gradle', import.meta.url)), 'utf8'));
    for (const path of ['gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.jar', 'gradle/wrapper/gradle-wrapper.properties']) {
      await fs.mkdir(dirname(join(this.root, path)), { recursive: true });
      await fs.copyFile(fileURLToPath(new URL('../../src/java/wrapper/' + path, import.meta.url)), join(this.root, path));
    }
    await this.file('.expec/java/dependencies.gradle', '// No fixture dependencies.\n');
    const gradle = process.env.EXPEC_TEST_GRADLE ?? fileURLToPath(new URL('../../src/java-native/' + (process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), import.meta.url));
    // cross-spawn is the production package's existing portable native command boundary.
    const { default: spawn } = await import('cross-spawn');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(gradle, ['--no-daemon', '-p', this.root, 'captureClasspaths', '--write-locks'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout!.on('data', value => output += String(value)); child.stderr!.on('data', value => output += String(value));
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Native fixture acquisition exceeded 60 seconds.')); }, 60_000);
      child.once('error', reject); child.once('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(output)); });
    });
    const path = join(this.root, '.expec/java/classpath.json'), report = JSON.parse(await fs.readFile(path, 'utf8'));
    report.inputs = await Promise.all(['expec.java.json', 'settings.gradle', 'build.gradle', 'gradlew', 'gradlew.bat',
      'gradle/wrapper/gradle-wrapper.jar', 'gradle/wrapper/gradle-wrapper.properties', '.expec/java/dependencies.gradle', 'gradle.lockfile']
      .map(async path => ({ path, version: createHash('sha256').update(await fs.readFile(join(this.root, path))).digest('hex') })));
    await fs.writeFile(path, JSON.stringify(report)); await this.capture();
  }
  externalSourceText(): Promise<string> { return fs.readFile(this.externalSource, 'utf8'); }
  async upstreamEvidence(conflict = false): Promise<void> {
    const path = join(this.directory, 'Unselected.java'); await fs.writeFile(path, 'unavailable unselected native source');
    const evidence = conflict ? { uri: pathToFileURL(await fs.realpath(join(process.env.JAVA_HOME!, 'release'))).href, version: 'a'.repeat(64) }
      : { uri: pathToFileURL(path).href, version: createHash('sha256').update(await fs.readFile(path)).digest('hex') }, project = this.ordinary;
    this.context = new JavaContext({ root: project.root, readSnapshot: async () => ({ ...await project.readSnapshot(), nativeInputs: [evidence] }) });
  }
  async nativeSource(path: string, text: string): Promise<void> {
    const directory = join(this.directory, 'external-source'); this.externalSource = join(directory, path);
    await fs.mkdir(dirname(this.externalSource), { recursive: true }); await fs.writeFile(this.externalSource, text);
    this.nativeOptions = { sourcePath: [directory] };
  }
  async nativeCatalog(source: string): Promise<void> {
    const folder = join(this.directory, 'catalog'), classes = join(folder, 'classes'), file = join(folder, 'Book.java');
    await fs.mkdir(classes, { recursive: true }); await fs.writeFile(file, 'package catalog; ' + source);
    const bin = join(process.env.JAVA_HOME!, 'bin');
    await this.execute(join(bin, process.platform === 'win32' ? 'javac.exe' : 'javac'), ['-proc:none', '--release', '21', '-d', classes, file]);
    if (this.native.code) throw new Error(this.native.stderr);
    this.catalogJar = join(folder, 'catalog.jar');
    await this.execute(join(bin, process.platform === 'win32' ? 'jar.exe' : 'jar'), ['--create', '--file', this.catalogJar, '-C', classes, '.']);
    if (this.native.code) throw new Error(this.native.stderr);
    this.nativeOptions = { classPath: { main: [this.catalogJar], test: [] } };
  }
  mapType(specId: string, file: string, type: string): void { this.associations.push({ specId, locator: { outputId: 'java', format: 'java-symbol-1', value: { file, type } } }); }
  mapMethod(specId: string, file: string, type: string, name: string, parameters: string[]): void {
    this.associations.push({ specId, locator: { outputId: 'java', format: 'java-symbol-1', value: { file, type, member: { kind: 'method', name, parameters, static: false } } } });
  }
  mapParameter(specId: string, file: string, type: string, name: string, parameters: string[], parameter: number): void {
    this.associations.push({ specId, locator: { outputId: 'java', format: 'java-symbol-1', value: { file, type, member: { kind: 'method', name, parameters, static: false }, parameter } } });
  }
  mapConstructor(specId: string, file: string, type: string, parameters: string[]): void {
    this.associations.push({ specId, locator: { outputId: 'java', format: 'java-symbol-1', value: { file, type, member: { kind: 'constructor', parameters } } } });
  }
  protected output() {
    const outputs = new Outputs(); outputs.register(javaOutput);
    const opened = outputs.open('java', this.contractOptions!, this.context, new FileProjectWriter(this.context), this.workspaceModules ? { workspaceModules: this.workspaceModules } : undefined);
    if (!opened.value) throw new Error(JSON.stringify(opened)); return opened.value;
  }
  private subject(name: string): string { return this.current?.baseline.elements.find(item => item.address.name === name)?.id ?? name; }
  async read(id: string): Promise<void> { await this.capture(); this.readResult = this.contractOptions ? await this.output().read(this.subject(id)) : await new JavaProject({ outputId: 'java' }, this.associations).read(id, this.snapshot); }
  async search(id: string): Promise<void> { await this.capture(); this.searchResult = this.contractOptions ? await this.output().search(this.subject(id)) : await new JavaProject({ outputId: 'java' }, this.associations).search(id, this.snapshot); }
  library(locator: string, text: string): void {
    const parsed = new LangiumReader().read({ sourceId: locator + '.expec', text });
    if (parsed.status !== 'accepted') throw new Error(JSON.stringify(parsed));
    this.libraries.push(new LangiumModel(locator, parsed.document));
  }
  source(text: string): void {
    this.sourceText = text;
    const parsed = new LangiumReader().read({ sourceId: 'main.expec', text });
    if (parsed.status !== 'accepted') throw new Error(JSON.stringify(parsed));
    const compiled = new Compiler().compile({ resolution: new SourceComposer().compose(new LangiumModel('main', parsed.document), { modules: this.libraries, packages: [] }) });
    if (!compiled.value) throw new Error(JSON.stringify(compiled));
    let next = 0;
    const current = new SpecificationIdentity(() => 'java-example-' + ++next).associate(compiled.value);
    if (!current.value) throw new Error(JSON.stringify(current)); this.current = current.value;
  }
  async create(options: Record<string, unknown>): Promise<void> {
    this.contractOptions = options;
    const outputs = new Outputs(); outputs.register(javaOutput);
    const opened = outputs.open('java', options, this.context, new FileProjectWriter(this.context), this.workspaceModules ? { workspaceModules: this.workspaceModules } : undefined);
    this.written = opened.value ? await opened.value.create(this.current) : { problems: opened.problems };
    await this.capture();
  }
  async writtenFiles(): Promise<string[]> { return (await this.ordinary.readSnapshot()).files.filter(file => file.path.endsWith('.java') || file.path.startsWith('.expec/outputs/')).map(file => file.path); }
  async javac(text: string): Promise<void> {
    const javaHome = process.env.JAVA_HOME!;
    const source = join(this.directory, 'Consumer.java'); await fs.writeFile(source, text);
    const classes = join(this.directory, 'classes'); await fs.mkdir(classes, { recursive: true });
    await this.execute(join(javaHome, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac'), ['-proc:none', '--release', '21', '-encoding', 'UTF-8', '-d', classes,
      ...this.snapshot.files.filter(file => file.path.endsWith('.java')).map(file => join(this.root, file.path)), source]);
  }
  async runJava(body: string, packageName?: string): Promise<void> {
    await this.javac((packageName ? 'package ' + packageName + '; ' : '') + 'public class Consumer { public static void main(String[] args) throws Exception { ' + body + ' } }');
    if (this.native.code === 0) await this.execute(join(process.env.JAVA_HOME!, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), ['-cp', join(this.directory, 'classes'), packageName ? packageName + '.Consumer' : 'Consumer']);
  }
  private async execute(command: string, args: string[]): Promise<void> {
    try { const result = await promisify(execFile)(command, args, { windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }); this.native = { code: 0, stdout: result.stdout, stderr: result.stderr }; }
    catch (error) { const result = error as { code?: number; stdout?: string; stderr?: string }; this.native = { code: result.code ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? String(error) }; }
  }
  async dispose(): Promise<void> {
    const path = relative(this.temporary, this.directory);
    if (isAbsolute(path) || path.includes(sep) || !path.startsWith('expec-java-')) throw new Error('Unexpected Java fixture root.');
    await fs.rm(this.directory, { recursive: true, force: true });
  }
}

