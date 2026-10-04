import { promises as fs } from 'node:fs';
import { delimiter, join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { FileProjectWriter, kotlinAcceptanceOutput } from '../../src/index.js';
import { KotlinDeliveryDriver } from './kotlin-delivery.js';

/** Compiles captured main/test source separately and observes the actual JUnit engine. */
export class KotlinAcceptanceDriver extends KotlinDeliveryDriver {
  private readonly junit = process.env.EXPEC_TEST_JUNIT_CONSOLE;
  private readonly implementations = new Map<string, string>();
  failureContext = '';
  readonly acceptanceOptions: Record<string, unknown> = {};
  private readonly remembered = new Map<string, string>();
  readonly outcomes: { title: string; status: string; failure: string }[] = [];
  async prepare(): Promise<void> {
    if (!this.junit) throw new Error('Supply the actual pinned JUnit 6.1.3 console JAR.');
    await this.initialize(); this.outputs.register(kotlinAcceptanceOutput); await this.configureNative([this.junit]);
    await this.file('src/main/kotlin/Empty.kt', '// An ordinary empty main source set.\n');
  }
  async contracts(): Promise<void> {
    await this.build();
    if (!this.written.artifacts) throw new Error(JSON.stringify(this.written));
    const confirmed = this.identity.withArtifacts(this.current, this.written.artifacts);
    if (!confirmed.value) throw new Error(JSON.stringify(confirmed)); this.current = confirmed.value;
  }
  async implement(name: string, body: string): Promise<void> {
    const previous = this.implementations.get(name) ?? 'throw NotImplementedError("Not implemented: ' + name + '")';
    await this.replace('src/main/kotlin/store/' + name.split('.')[0] + '.kt', previous, body); this.implementations.set(name, body);
  }
  async driver(text: string): Promise<void> { await this.file('src/test/kotlin/store/tests/driver/ShoppingDriver.kt', text); }
  async resourceFixture(setupFailure?: string, cleanupFailure?: string): Promise<void> {
    const file = 'src/test/kotlin/store/tests/dsl/ResourceShopping.kt';
    await this.file(file, 'package store.tests.dsl\nopen class ResourceShopping {\n'
      + '  private var server: java.net.ServerSocket? = null\n  protected lateinit var shopping: Shopping\n'
      + '  @org.junit.jupiter.api.BeforeEach fun connect() {\n'
      + '    server = java.net.ServerSocket(0, 50, java.net.InetAddress.getLoopbackAddress())\n'
      + (setupFailure ? '    error(' + JSON.stringify(setupFailure) + ')\n' : '    shopping = Shopping(store.tests.driver.ShoppingDriver())\n')
      + '  }\n  @org.junit.jupiter.api.AfterEach fun disconnect() {\n'
      + '    server!!.close()\n    println("RESOURCE_CLOSED=" + server!!.isClosed)\n'
      + (cleanupFailure ? '    error(' + JSON.stringify(cleanupFailure) + ')\n' : '') + '  }\n}\n');
    this.selectFixture(file, 'ResourceShopping');
  }
  async addTestMember(text: string): Promise<void> {
    const path = 'src/test/kotlin/store/tests/acceptance/ShoppingAcceptance.kt', source = await fs.readFile(join(this.root, path), 'utf8');
    const end = source.lastIndexOf('}'); if (end < 0) throw new Error('Missing arranged native test class.');
    await this.file(path, source.slice(0, end) + text + '\n' + source.slice(end));
  }
  selectFixture(file: string, name: string): void { this.acceptanceOptions.fixture = { outputId: 'kotlin-acceptance', format: 'kotlin-symbol-1', value: { file, declaration: [{ kind: 'class', name }] } }; }
  async rememberFile(path: string): Promise<void> { this.remembered.set(path, await fs.readFile(join(this.root, path), 'utf8')); }
  async unchangedFile(path: string): Promise<boolean> { return this.remembered.has(path) && this.remembered.get(path) === await fs.readFile(join(this.root, path), 'utf8'); }
  async generate(update = false): Promise<void> {
    const output = this.outputs.open('kotlin-acceptance', { package: 'store.tests', domain: 'shopping', ...this.acceptanceOptions }, this.context, new FileProjectWriter(this.context));
    if (output.value) this.output = output.value;
    const compared = this.identity.compare(this.current.baseline, this.current);
    if (!compared.value) throw new Error(JSON.stringify(compared));
    this.written = output.value ? await (update ? output.value.update(this.diff ?? compared.value, this.current) : output.value.create(this.current)) : { problems: output.problems }; this.files = await this.capturedFiles();
    if (this.written.problems.length) this.failureContext = JSON.stringify({ result: this.written, capture: (await this.context.readSnapshot()).problems });
  }
  async readOperation(name: string): Promise<void> {
    const operation = [...this.current.specification.inspection.query('setup'), ...this.current.specification.inspection.query('action'), ...this.current.specification.inspection.query('observation'), ...this.current.specification.inspection.query('check')].find(item => item.name === name);
    if (!operation) throw new Error('Missing authored operation ' + name);
    this.readResult = await this.output.read(this.current.id(operation.id));
  }
  async readGroup(): Promise<void> {
    const group = [...this.current.specification.inspection.query('examples')]; if (group.length !== 1) throw new Error('Select exactly one arranged group.');
    this.readResult = await this.output.read(this.current.id(group[0]!.id));
  }
  async runTests(concurrent = false): Promise<void> {
    this.files = await this.capturedFiles(); this.outcomes.length = 0;
    const native = await this.native(), report = JSON.parse(this.files.get('.expec/kotlin/classpath.json')!);
    const directory = await fs.mkdtemp(join(this.directory, 'native-tests-')), main = join(directory, 'main'), test = join(directory, 'test'), reports = join(directory, 'reports');
    for (const path of [main, test, reports]) await fs.mkdir(path);
    const compile = (scope: 'main' | 'test', output: string, classpath: string[]) => this.run(native.java, ['-cp', native.jars.join(delimiter), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
      '-no-stdlib', '-no-reflect', '-classpath', classpath.join(delimiter), '-jvm-target', '21', ...scope === 'test' ? ['-Xfriend-paths=' + main] : [], '-d', output,
      ...[...this.files.keys()].filter(path => path.endsWith('.kt') && report.sourceRoots[scope].some((root: string) => path.startsWith(root + '/'))).map(path => join(this.root, path))]);
    this.compiled = await compile('main', main, report.classPath.main); if (this.compiled.code) return;
    this.compiled = await compile('test', test, [main, ...report.classPath.test]); if (this.compiled.code) return;
    this.execution = await this.run(native.java, ['-jar', this.junit!, 'execute', '--class-path', [main, test, ...report.runtimeClassPath.test].join(delimiter),
      '--select-class', 'store.tests.acceptance.ShoppingAcceptance', '--reports-dir', reports, '--disable-banner', '--disable-ansi-colors',
      ...concurrent ? ['--config=junit.jupiter.execution.parallel.enabled=true', '--config=junit.jupiter.execution.parallel.config.strategy=fixed', '--config=junit.jupiter.execution.parallel.config.fixed.parallelism=2', '--config=junit.jupiter.execution.parallel.mode.default=concurrent'] : []]);
    for (const path of await fs.readdir(reports)) if (path.endsWith('.xml')) {
      const document = new DOMParser().parseFromString(await fs.readFile(join(reports, path), 'utf8'), 'text/xml');
      for (const item of Array.from(document.getElementsByTagName('testcase'))) {
        const failures = [...Array.from(item.getElementsByTagName('failure')), ...Array.from(item.getElementsByTagName('error'))];
        this.outcomes.push({ title: item.getAttribute('name') ?? '', status: failures.length ? 'failed' : item.getElementsByTagName('skipped').length ? 'skipped' : 'passed', failure: failures.map(item => item.textContent).join('\n') });
      }
    }
  }
}
