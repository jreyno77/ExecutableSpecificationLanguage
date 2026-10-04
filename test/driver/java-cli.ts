import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ConnectedBuildDriver } from './connected-build.js';

/** Ordinary CLI processes, a real Maven fixture, and actual project implementation. */
export class JavaCliDriver extends ConnectedBuildDriver {
  readonly javaHome = process.env.EXPEC_TEST_JAVA_HOME ?? process.env.JAVA_HOME!;
  lock!: Buffer;
  buildText = '';
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
}
