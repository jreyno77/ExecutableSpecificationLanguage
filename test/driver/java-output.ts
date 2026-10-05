import { promises as fs, appendFileSync, writeFileSync, mkdtempSync, realpathSync } from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { vi } from 'vitest';
import { tmpdir } from 'node:os';
import { dirname, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { Compiler, ConfigurationReader, FileProjectWriter, JavaContext, JavaProject, LangiumModel, LangiumReader, Outputs, ProjectConnector, SourceComposer,
  SpecificationIdentity, reconcileRelationships, javaOutput, type Reconciliation, type ArtifactAssociation, type IdentifiedSpecification, type OutputWrite, type ProjectChanges, type ProjectContext, type ProjectRead, type ProjectSearch, type ProjectSnapshot } from '../../src/index.js';

const acquisitionInputs = ['expec.java.json', 'settings.gradle', 'build.gradle', 'gradlew', 'gradlew.bat',
  'gradle/wrapper/gradle-wrapper.jar', 'gradle/wrapper/gradle-wrapper.properties', '.expec/java/dependencies.gradle', 'gradle.lockfile'];
const preparedProfiles = new Map<string, Promise<readonly { path: string; bytes: Buffer; mode: number }[]>>();

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
  compared!: Reconciliation;
  current!: IdentifiedSpecification;
  sourceText = '';
  contractOptions: Record<string, unknown> | undefined;
  workspaceModules: string[] | undefined;
  readonly libraries: LangiumModel[] = [];
  written!: OutputWrite;
  planned!: import('../../src/index.js').Check<import('../../src/index.js').OutputPlan>;
  native = { code: 0, stdout: '', stderr: '' };
  protected nativeOptions: Record<string, unknown> = {};
  catalogJar!: string;
  externalSource!: string;
  queryProcess = { started: false, answered: false, closed: false, interrupted: false, scratch: '', changed: false, mutationError: '', output: '' };
  nativeWriteChange: 'before' | 'after-first' | undefined;
  nativeWriteChanged = false;
  externalWriteText: string | undefined;
  readonly executionCanaries: string[] = [];
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
  async readCaptured(id: string): Promise<void> { this.readResult = await new JavaProject({ outputId: 'java' }, this.associations).read(id, this.snapshot); }
  replaceCapturedSource(path: string, text: string): void {
    const source = this.snapshot.files.find(file => file.path === path);
    if (!source) throw new Error('No captured source: ' + path);
    Object.assign(source, { bytes: Buffer.from(text) });
  }
  async searchWhileCatalogChanges(id: string, interrupt = false): Promise<void> {
    await this.capture();
    const spawn = childProcess.spawn, trace = this.queryProcess;
    const observation = vi.spyOn(childProcess, 'spawn').mockImplementation(((...args: Parameters<typeof spawn>) => {
      const child = Reflect.apply(spawn, childProcess, args);
      if (Array.isArray(args[1]) && args[1].includes('ExpecJava')) {
        trace.started = true; trace.scratch = String(args[1].at(-1));
        if (interrupt) child.once('spawn', () => { trace.interrupted = child.kill(); });
        child.stdout!.on('data', data => { trace.output += String(data); });
        if (!interrupt) child.stdout!.once('data', () => {
          trace.answered = true;
          try { appendFileSync(this.catalogJar, '\nchanged-during-query\n'); trace.changed = true; }
          catch (error) { trace.mutationError = String(error); }
        });
        child.once('close', () => { trace.closed = true; });
      }
      return child;
    }) as typeof spawn);
    syncBuiltinESMExports();
    try { this.searchResult = await new JavaProject({ outputId: 'java' }, this.associations).search(id, this.snapshot); }
    finally { observation.mockRestore(); syncBuiltinESMExports(); }
  }
  async nativeProject(build = '', javaHome = process.env.JAVA_HOME): Promise<void> {
    if (!javaHome) throw new Error('Java native acceptance requires an explicit JAVA_HOME for JDK 21.');
    const junit = process.env.EXPEC_TEST_JUNIT_CONSOLE, options = JSON.stringify(this.nativeOptions);
    const reusable = !build && javaHome === process.env.JAVA_HOME && (Object.keys(this.nativeOptions).length === 0
      || junit && options === JSON.stringify({ classPath: { main: [], test: [junit] } }));
    if (reusable) {
      const key = JSON.stringify([javaHome, options]);
      let prepared = preparedProfiles.get(key);
      if (!prepared) {
        prepared = this.prepareProfile(javaHome).catch(error => { preparedProfiles.delete(key); throw error; });
        preparedProfiles.set(key, prepared);
      }
      for (const file of await prepared) {
        await fs.mkdir(dirname(join(this.root, file.path)), { recursive: true });
        await fs.writeFile(join(this.root, file.path), Buffer.from(file.bytes));
        await fs.chmod(join(this.root, file.path), file.mode);
      }
    } else await this.acquireNativeProject(build, javaHome);
    await this.capture();
  }
  private async prepareProfile(javaHome: string): Promise<readonly { path: string; bytes: Buffer; mode: number }[]> {
    const prepared = new JavaOutputDriver();
    try {
      prepared.nativeOptions = structuredClone(this.nativeOptions);
      await fs.mkdir(prepared.root);
      await prepared.acquireNativeProject('', javaHome);
      const files = await Promise.all([...acquisitionInputs, '.expec/java/classpath.json']
        .map(async path => ({ path, bytes: await fs.readFile(join(prepared.root, path)), mode: (await fs.stat(join(prepared.root, path))).mode })));
      const report = JSON.parse(files.at(-1)!.bytes.toString('utf8'));
      if (report.javaHome !== javaHome || report.release !== 21
        || JSON.stringify(report.sourceRoots) !== JSON.stringify({ main: ['src/main/java'], test: ['src/test/java'] })
        || JSON.stringify(report.classPath) !== JSON.stringify({ main: { compile: [], runtime: [] }, test: { compile: [], runtime: [] } })
        || JSON.stringify(report.packages) !== '[]'
        || JSON.stringify(report.inputs.map((input: { path: string }) => input.path)) !== JSON.stringify(acquisitionInputs)
        || JSON.stringify(report).includes(JSON.stringify(prepared.root).slice(1, -1)))
        throw new Error('Reusable Java preparation must contain only relative fixture inputs and no acquired dependencies.');
      return files;
    } finally { await prepared.dispose(); }
  }
  private async acquireNativeProject(build: string, javaHome: string): Promise<void> {
    await this.configure(javaHome, this.nativeOptions);
    await this.file('settings.gradle', "rootProject.name = 'java-consumer'\n");
    await this.file('build.gradle', await fs.readFile(fileURLToPath(new URL('../resources/java-project/build.gradle', import.meta.url)), 'utf8') + build);
    for (const path of ['gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.jar', 'gradle/wrapper/gradle-wrapper.properties']) {
      await fs.mkdir(dirname(join(this.root, path)), { recursive: true });
      await fs.copyFile(fileURLToPath(new URL('../../src/project/java/resources/wrapper/' + path, import.meta.url)), join(this.root, path));
    }
    await this.file('.expec/java/dependencies.gradle', '// No fixture dependencies.\n');
    const gradle = process.env.EXPEC_TEST_GRADLE ?? fileURLToPath(new URL('../../src/project/java/native/' + (process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), import.meta.url));
    // cross-spawn is the production package's existing portable native command boundary.
    const { default: spawn } = await import('cross-spawn');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(gradle, ['--no-daemon', '-p', this.root, 'captureClasspaths', '--write-locks'], { env: { ...process.env, JAVA_HOME: javaHome }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout!.on('data', value => output += String(value)); child.stderr!.on('data', value => output += String(value));
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Native fixture acquisition exceeded 60 seconds.')); }, 60_000);
      child.once('error', reject); child.once('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(output)); });
    });
    const path = join(this.root, '.expec/java/classpath.json'), report = JSON.parse(await fs.readFile(path, 'utf8'));
    report.inputs = await Promise.all(acquisitionInputs
      .map(async path => ({ path, version: createHash('sha256').update(await fs.readFile(join(this.root, path))).digest('hex') })));
    await fs.writeFile(path, JSON.stringify(report));
  }
  async inspectionCanaries(): Promise<void> {
    const marker = (name: string) => join(this.directory, name + '.executed');
    const staticMarker = marker('static'), processorMarker = marker('processor'), buildMarker = marker('build');
    this.executionCanaries.push(staticMarker, processorMarker, buildMarker);
    const write = (path: string) => 'java.nio.file.Files.writeString(java.nio.file.Path.of(' + JSON.stringify(path) + '), "executed");';
    await this.nativeCatalog('public class Book { public String title; static { try { ' + write(staticMarker)
      + ' } catch (Exception e) { throw new RuntimeException(e); } } public static void main(String[] args) {} }');
    const bin = join(process.env.JAVA_HOME!, 'bin'), suffix = process.platform === 'win32' ? '.exe' : '';
    const classes = join(this.directory, 'catalog/classes'), processor = join(this.directory, 'InspectionProcessor.java');
    await fs.writeFile(processor, 'package catalog; @javax.annotation.processing.SupportedAnnotationTypes("*") '
      + '@javax.annotation.processing.SupportedSourceVersion(javax.lang.model.SourceVersion.RELEASE_21) '
      + 'public class InspectionProcessor extends javax.annotation.processing.AbstractProcessor { '
      + 'public boolean process(java.util.Set<? extends javax.lang.model.element.TypeElement> annotations, javax.annotation.processing.RoundEnvironment round) {'
      + 'try { ' + write(processorMarker) + ' } catch (Exception e) { throw new RuntimeException(e); } return false; } }');
    await this.execute(join(bin, 'javac' + suffix), ['-proc:none', '--release', '21', '-d', classes, processor]);
    if (this.native.code) throw new Error(this.native.stderr);
    const services = join(classes, 'META-INF/services'); await fs.mkdir(services, { recursive: true });
    await fs.writeFile(join(services, 'javax.annotation.processing.Processor'), 'catalog.InspectionProcessor\n');
    await this.execute(join(bin, 'jar' + suffix), ['--update', '--file', this.catalogJar, '-C', classes, '.']);
    if (this.native.code) throw new Error(this.native.stderr);
    await this.execute(join(bin, 'java' + suffix), ['-cp', this.catalogJar, 'catalog.Book']);
    if (this.native.code || await fs.readFile(staticMarker, 'utf8') !== 'executed') throw new Error('Static initialization canary did not execute.');
    await this.execute(join(bin, 'javac' + suffix), ['--release', '21', '-processorpath', this.catalogJar,
      '-processor', 'catalog.InspectionProcessor', '-d', classes, join(this.directory, 'catalog/Book.java')]);
    if (this.native.code || await fs.readFile(processorMarker, 'utf8') !== 'executed') throw new Error('Annotation processor canary did not execute.');
    await this.nativeProject('\nnew File(' + JSON.stringify(buildMarker.replaceAll('\\', '/')) + ').text = "executed"\n');
    if (await fs.readFile(buildMarker, 'utf8') !== 'executed') throw new Error('Native build canary did not execute during explicit setup.');
    for (const path of this.executionCanaries) await fs.unlink(path);
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
  mapAuthoredType(name: string, file: string, type: string): void { this.mapType(this.subject(name), file, type); }
  reconcile(names: string[]): void {
    const result = reconcileRelationships(this.current, names.map(name => this.subject(name)), this.searchResult.outgoing);
    if (!result.value) throw new Error(JSON.stringify(result)); this.compared = result.value;
  }
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
  async search(id: string): Promise<void> { await this.capture(); this.searchResult = this.contractOptions ? await this.output().search(this.subject(id)) : await new JavaProject({ outputId: 'java' }, this.associations).search(this.subject(id), this.snapshot); }
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
  async planContracts(options: Record<string, unknown>): Promise<void> {
    const outputs = new Outputs(); outputs.register(javaOutput);
    const opened = outputs.open('java', options, this.context, new FileProjectWriter(this.context));
    if (!opened.value) throw new Error(JSON.stringify(opened));
    await this.capture(); this.planned = await opened.value.plan({ operation: 'create', current: this.current }, this.snapshot);
  }
  async create(options: Record<string, unknown>): Promise<void> {
    this.contractOptions = options;
    const outputs = new Outputs(); outputs.register(javaOutput);
    const writer = this.nativeWriteChange ? { apply: (plan: ProjectChanges) => this.applyWhileCatalogChanges(plan) } : new FileProjectWriter(this.context);
    const opened = outputs.open('java', options, this.context, writer, this.workspaceModules ? { workspaceModules: this.workspaceModules } : undefined);
    this.written = opened.value ? await opened.value.create(this.current) : { problems: opened.problems };
    if (!this.written.problems.length) await this.capture();
  }
  private async applyWhileCatalogChanges(plan: ProjectChanges) {
    const context = this.context, first = plan.changes[0];
    if (first?.kind !== 'write') throw new Error('The native guard example needs a concrete first write.');
    const change = () => {
      if (this.externalWriteText !== undefined) writeFileSync(this.externalSource, this.externalWriteText);
      else appendFileSync(this.catalogJar, '\nchanged-during-apply\n');
      this.nativeWriteChanged = true;
    };
    if (this.nativeWriteChange === 'before') change();
    return new FileProjectWriter({ root: context.root, readSnapshot: async () => {
      if (!this.nativeWriteChanged) {
        const actual = await fs.readFile(join(this.root, first.path)).catch(error => {
          if (error.code === 'ENOENT') return undefined; throw error;
        });
        if (actual?.equals(Buffer.from(first.bytes))) change();
      }
      return context.readSnapshot();
    } }).apply(plan);
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

