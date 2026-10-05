import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ConnectedBuildDriver } from './connected-build.js';

/** Ordinary CLI processes, a real Maven fixture, and actual project implementation. */
export class JavaCliDriver extends ConnectedBuildDriver {
  readonly javaHome = process.env.EXPEC_TEST_JAVA_HOME ?? process.env.JAVA_HOME!;
  lock!: Buffer;
  buildText = '';
  nativeCalls: string[][] = [];
  async initializeJava(): Promise<void> { await this.initialize(false); }
  async cli(command: string, extra: string[] = []): Promise<void> {
    await this.run([command, '--config', 'spec/expec.json', '--json', ...extra], '', undefined, 240_000);
    if (command === 'init' && this.result.code === 0) this.manifest = JSON.parse(await fs.readFile(this.path('spec/expec.json'), 'utf8'));
  }
  init(javaHome = this.javaHome): Promise<void> { return this.cli('init', ['--root', '../project', '--target', 'java', '--java-home', javaHome, '--yes']); }
  async source(text: string): Promise<void> { await this.write('spec/main.expec', text); }
  async sourceLibrary(name: string, text: string): Promise<void> {
    await this.write('libraries/' + name + '/package.json', JSON.stringify({ name, version: '1.0.0', expec: { entry: './index.expec' } }));
    await this.write('libraries/' + name + '/index.expec', text);
    this.manifest.libraries = [{ module: name, version: '1.0.0', source: '../libraries/' + name }]; await this.saveManifest();
  }
  async requireCatalog(version = '1.0.0'): Promise<void> {
    const packages = (this.manifest.packages ?? []) as { alias: string; name: string; version: string; phases: string[] }[];
    this.manifest.packages = [...packages.filter(item => item.alias !== 'books'), { alias: 'books', name: 'maven:example.books:catalog', version, phases: ['runtime'] }];
    await this.saveManifest();
  }
  async localCatalog(): Promise<void> {
    const build = this.path('project/build.gradle');
    this.buildText = (await fs.readFile(build, 'utf8')).replace('mavenCentral()', "maven { url = uri('repository') }; mavenCentral()");
    await fs.writeFile(build, this.buildText);
    for (const [name, version, className] of [['titles', '1.2.0', 'Titles'], ['catalog', '1.0.0', 'Catalog']]) {
      const directory = this.path('project/repository/example/books/' + name + '/' + version), source = this.path('project/.gradle/' + className + '.java'), classes = this.path('project/.gradle/fixture-' + name);
      await fs.mkdir(dirname(source), { recursive: true }); await fs.mkdir(classes, { recursive: true }); await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(source, 'package example.books; public class ' + className + ' { public static String title() { return "Dune"; } }');
      const native = (tool: string) => join(this.javaHome, 'bin', tool + (process.platform === 'win32' ? '.exe' : ''));
      await promisify(execFile)(native('javac'), ['--release', '21', '-d', classes, source], { timeout: 30_000, windowsHide: true });
      await promisify(execFile)(native('jar'), ['--create', '--file', join(directory, name + '-' + version + '.jar'), '-C', classes, '.'], { timeout: 30_000, windowsHide: true });
      await fs.writeFile(join(directory, name + '-' + version + '.pom'), '<project><modelVersion>4.0.0</modelVersion><groupId>example.books</groupId><artifactId>' + name + '</artifactId><version>' + version + '</version>'
        + (name === 'catalog' ? '<dependencies><dependency><groupId>example.books</groupId><artifactId>titles</artifactId><version>1.2.0</version></dependency></dependencies>' : '') + '</project>');
    }
  }
  async implementBasket(copies: number): Promise<void> {
    await this.write('project/src/test/java/generated/tests/driver/ShoppingDriver.java', `package generated.tests.driver;
public class ShoppingDriver {
  private final java.util.Set<String> catalog=new java.util.HashSet<>();
  private final java.util.Map<String,Double> basket=new java.util.HashMap<>();
  public void available(String title) { catalog.add(title); }
  public void add(String title) { if(!catalog.contains(title)) throw new IllegalStateException("Unavailable book"); basket.merge(title,${copies}.0,Double::sum); }
  public double quantity(String title) { double actual=basket.getOrDefault(title,0.0); System.out.println("BASKET:"+title+":"+actual); return actual; }
}
`);
  }
  async removeGeneratedCall(call: string): Promise<void> {
    const files = await this.filesUnder('project/src/test/java/generated/tests/acceptance');
    const found = files.filter(file => file.text.includes(call));
    if (found.length !== 1) throw Error('Select exactly one actual generated call: ' + call);
    await fs.writeFile(found[0]!.path, found[0]!.text.replace(call, ''));
  }
  async testObservingNativeProcesses(): Promise<void> {
    const log = this.path('native-calls.jsonl'), observer = this.path('native-observer.mjs');
    await fs.writeFile(log, '');
    await fs.writeFile(observer, 'import process from "node:child_process"; import {appendFileSync} from "node:fs"; import {syncBuiltinESMExports} from "node:module"; '
      + 'const spawn=process.spawn; process.spawn=(command,args,...rest)=>{appendFileSync(' + JSON.stringify(log)
      + ',JSON.stringify([String(command),...args])+"\\n"); return spawn(command,args,...rest);}; syncBuiltinESMExports();');
    const args = ['--import', pathToFileURL(observer).href, fileURLToPath(new URL('../../dist/cli-entry.js', import.meta.url)), 'test', '--config', 'spec/expec.json', '--json'];
    try {
      const result = await promisify(execFile)(process.execPath, args, { cwd: this.directory, timeout: 240_000, maxBuffer: 4 * 1024 * 1024 });
      this.result = { ...result, code: 0 };
    } catch (error) {
      const result = error as { code: number; stdout: string; stderr: string };
      if (typeof result.code !== 'number') throw error;
      this.result = result;
    }
    if (!this.result.stdout.trim()) throw Error(this.result.stderr || 'The observed CLI returned no JSON.');
    this.report = JSON.parse(this.result.stdout);
    this.nativeCalls = (await fs.readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
}
