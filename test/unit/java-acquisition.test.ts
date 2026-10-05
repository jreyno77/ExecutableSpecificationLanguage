import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { ConfigurationReader, type Configuration } from '../../src/project/connection/configuration.js';
import { javaStarter, javaContribution } from '../../src/project/java/java-initialization.js';
import { installJava, readJavaPackages } from '../../src/project/java/java-acquisition.js';

const execute = promisify(execFile), temporary: string[] = [], jdk = process.env.JAVA_HOME!;
const native = (name: string) => join(jdk, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
function configuration(version = '1.0.0', phases: ('runtime' | 'test' | 'build')[] = ['runtime']): Configuration {
  const result = new ConfigurationReader([]).read({ sourceId: 'expec.json', text: JSON.stringify({ formatVersion: 1,
    version: '0.1.0', project: { root: '.' }, build: { entries: ['store.expec'] },
    packages: [{ alias: 'books', name: 'maven:example.books:catalog', version, phases }] }) });
  if (!result.value) throw Error(JSON.stringify(result.problems));
  return result.value;
}
async function file(root: string, path: string, value: string | Uint8Array): Promise<void> {
  await fs.mkdir(dirname(join(root, path)), { recursive: true }); await fs.writeFile(join(root, path), value);
}
async function fixture(): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-java-acquire-'))); temporary.push(root);
  const starter = await javaStarter(configuration(), '.', jdk);
  if (!starter.value) throw Error(JSON.stringify(starter.problems));
  for (const change of starter.value.changes) if (change.kind === 'write') await file(root, change.path, change.bytes);
  await file(root, 'build.gradle', "plugins { id 'java' }\nrepositories { maven { url = uri('repository') } }\njava { toolchain { languageVersion = JavaLanguageVersion.of(21) } }\ndependencyLocking { lockAllConfigurations() }\napply from: '.expec/java/dependencies.gradle'\ntasks.withType(JavaCompile).configureEach { options.release = 21 }\n");
  await publish(root, 'titles', '1.2.0'); await publish(root, 'catalog', '1.0.0', 'titles'); await publish(root, 'catalog', '2.0.0', 'titles');
  return root;
}
async function publish(root: string, name: string, version: string, dependency?: string): Promise<void> {
  const output = 'repository/example/books/' + name + '/' + version, classes = join(root, '.gradle/fixture-' + name);
  const className = name === 'catalog' ? 'Catalog' : 'Titles', source = '.gradle/' + className + '.java';
  await file(root, source, 'package example.books; public class ' + className + ' { public static String value() { return "' + version + '"; } }');
  await fs.mkdir(classes, { recursive: true });
  await execute(native('javac'), ['--release', '21', '-d', classes, join(root, source)]);
  await fs.mkdir(join(root, output), { recursive: true });
  await execute(native('jar'), ['--create', '--file', join(root, output, name + '-' + version + '.jar'), '-C', classes, '.']);
  await file(root, output + '/' + name + '-' + version + '.pom', '<project><modelVersion>4.0.0</modelVersion><groupId>example.books</groupId><artifactId>' + name + '</artifactId><version>' + version + '</version>' + (dependency ? '<dependencies><dependency><groupId>example.books</groupId><artifactId>' + dependency + '</artifactId><version>1.2.0</version></dependency></dependencies>' : '') + '</project>');
}
afterEach(async () => {
  const parent = await fs.realpath(tmpdir());
  for (const root of temporary.splice(0)) {
    if (!root.startsWith(parent + sep) || !root.slice(parent.length + 1).startsWith('expec-java-acquire-') || dirname(root) !== parent) throw Error('Unsafe cleanup root');
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe('acquiring actual Java dependency selections', { timeout: 120_000 }, () => {
  it('resolves the requested catalog and its real transitive artifact and keeps its native lock on repeat', async () => {
    const root = await fixture(), manifest = join(root, 'expec.json'), before = await fs.readFile(join(root, 'build.gradle'));
    const installed = await installJava(configuration(), manifest);
    expect(installed.problems).toEqual([]);
    expect(installed.packages).toEqual([{ name: 'maven:example.books:catalog', requested: '1.0.0', selected: '1.0.0', installed: '1.0.0' }]);
    const report = JSON.parse(await fs.readFile(join(root, '.expec/java/classpath.json'), 'utf8'));
    expect(report.packages).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'maven:example.books:titles', version: '1.2.0' })]));
    expect(report.classPath.main.compile.some((path: string) => path.endsWith('titles-1.2.0.jar'))).toBe(true);
    const lock = await fs.readFile(join(root, 'gradle.lockfile'));
    expect((await installJava(configuration(), manifest)).problems).toEqual([]);
    expect(await fs.readFile(join(root, 'gradle.lockfile'))).toEqual(lock);
    expect(await fs.readFile(join(root, 'build.gradle'))).toEqual(before);
    await file(root, 'src/main/java/Store.java', 'class Store { int quantity() { return 2; } }');
    expect((await readJavaPackages(configuration(), manifest)).packages).toEqual(installed.packages);
    expect((await readJavaPackages(configuration(), manifest)).problems).toEqual([]);
  });
  it('lets native lock update select an explicitly changed exact version', async () => {
    const root = await fixture(), manifest = join(root, 'expec.json');
    expect((await installJava(configuration(), manifest)).problems).toEqual([]);
    const updated = await installJava(configuration('2.0.0'), manifest);
    expect(updated.problems).toEqual([]);
    expect(updated.packages).toEqual([{ name: 'maven:example.books:catalog', requested: '2.0.0', selected: '2.0.0', installed: '2.0.0' }]);
    expect(await fs.readFile(join(root, 'gradle.lockfile'), 'utf8')).toContain('example.books:catalog:2.0.0=');
  });
  it('keeps failed acquisition effects visible and refuses the old report as proof', async () => {
    const root = await fixture(), manifest = join(root, 'expec.json');
    expect((await installJava(configuration(), manifest)).problems).toEqual([]);
    const failed = await installJava(configuration('3.0.0'), manifest);
    expect(failed.value).toBeUndefined(); expect(failed.problems.map(problem => problem.code)).toContain('package-install-failed');
    expect(failed.effects).toEqual(expect.arrayContaining([expect.objectContaining({ path: javaContribution, state: 'file' })]));
    expect((await readJavaPackages(configuration('3.0.0'), manifest)).problems.map(problem => problem.code)).toContain('install-required');
  });
  it('requires installation when an authored phase changes without a version change', async () => {
    const root = await fixture(), manifest = join(root, 'expec.json');
    expect((await installJava(configuration(), manifest)).problems).toEqual([]);
    const read = await readJavaPackages(configuration('1.0.0', ['test']), manifest);
    expect(read.value).toBeUndefined(); expect(read.problems.map(problem => problem.code)).toContain('install-required');
  });
  it('reconciles a phase move through native lock writing', async () => {
    const root = await fixture(), manifest = join(root, 'expec.json');
    expect((await installJava(configuration(), manifest)).problems).toEqual([]);
    const changed = await installJava(configuration('1.0.0', ['test']), manifest);
    expect(changed.problems, JSON.stringify(changed.problems)).toEqual([]);
    const report = JSON.parse(await fs.readFile(join(root, '.expec/java/classpath.json'), 'utf8'));
    expect(report.classPath.main.compile).toEqual([]);
    expect(changed.packages[0]?.installed).toBe('1.0.0');
  });
  it('does not report an edited artifact as installed merely because its filename and version remain', async () => {
    const root = await fixture(), manifest = join(root, 'expec.json');
    expect((await installJava(configuration(), manifest)).problems).toEqual([]);
    const report = JSON.parse(await fs.readFile(join(root, '.expec/java/classpath.json'), 'utf8'));
    const artifact = report.packages.find((p: {name: string}) => p.name === 'maven:example.books:catalog').path;
    expect(artifact.startsWith(root + sep)).toBe(true);
    await fs.appendFile(artifact, 'changed');
    const read = await readJavaPackages(configuration(), manifest);
    expect(read.value).toBeUndefined(); expect(read.problems.map(problem => problem.code)).toContain('install-required');
    expect(read.packages[0]?.installed).toBeUndefined();
  });
  it('reports an actually applied unsupported script without hiding native configuration effects', async () => {
    const root = await fixture(), manifest = join(root, 'expec.json');
    await file(root, 'extra.gradle', "file('native-effect.txt').text = 'executed'\n");
    await fs.appendFile(join(root, 'build.gradle'), "apply from: 'extra.gradle'\n");
    const installed = await installJava(configuration(), manifest);
    expect(installed.value).toBeUndefined(); expect(installed.problems.map(problem => problem.code)).toContain('package-install-failed');
    expect(await fs.readFile(join(root, 'native-effect.txt'), 'utf8')).toBe('executed');
    expect(installed.effects.some(effect => effect.path === javaContribution)).toBe(true);
    expect((await readJavaPackages(configuration(), manifest)).problems.map(problem => problem.code)).toContain('install-required');
  });
  it('keeps test-only dependencies out of the actual main classpath', async () => {
    const root = await fixture(), manifest = join(root, 'expec.json');
    const installed = await installJava(configuration('1.0.0', ['test']), manifest);
    expect(installed.problems).toEqual([]);
    const report = JSON.parse(await fs.readFile(join(root, '.expec/java/classpath.json'), 'utf8'));
    expect(report.classPath.main.compile).toEqual([]);
    expect(report.classPath.test.compile.some((path: string) => path.endsWith('catalog-1.0.0.jar'))).toBe(true);
  });
  it('uses a supported runtime requirement even when its alias is also available during build', async () => {
    const root = await fixture(), installed = await installJava(configuration('1.0.0', ['build', 'runtime']), join(root, 'expec.json'));
    expect(installed.problems).toEqual([]);
    expect(installed.packages).toEqual([{ name: 'maven:example.books:catalog', requested: '1.0.0', selected: '1.0.0', installed: '1.0.0' }]);
  });
  it('reports a missing selected JDK before writing the dependency contribution', async () => {
    const root = await fixture(), previous = await fs.readFile(join(root, javaContribution));
    const config = JSON.parse(await fs.readFile(join(root, 'expec.java.json'), 'utf8'));
    config.javaHome = join(root, 'missing-jdk'); await file(root, 'expec.java.json', JSON.stringify(config));
    const result = await installJava(configuration(), join(root, 'expec.json'));
    expect(result.problems.map(problem => problem.code)).toContain('native-toolchain-unavailable');
    expect(result.effects).toEqual([]); expect(await fs.readFile(join(root, javaContribution))).toEqual(previous);
  });
  it('preserves a handwritten dependency contribution without claiming ownership from its marker', async () => {
    const root = await fixture(), text = '// .expec Java dependencies, format 1\n// Handwritten work\n';
    await file(root, javaContribution, text);
    const result = await installJava(configuration(), join(root, 'expec.json'));
    expect(result.problems.map(problem => problem.code)).toContain('native-contribution-conflict');
    expect(result.effects).toEqual([]); expect(await fs.readFile(join(root, javaContribution), 'utf8')).toBe(text);
  });
  it('refuses duplicate keys in the actual installed report', async () => {
    const root = await fixture(), manifest = join(root, 'expec.json');
    expect((await installJava(configuration(), manifest)).problems).toEqual([]);
    const report = await fs.readFile(join(root, '.expec/java/classpath.json'), 'utf8');
    await file(root, '.expec/java/classpath.json', report.replace('"format": 1,', '"format": 1, "format": 1,'));
    const read = await readJavaPackages(configuration(), manifest);
    expect(read.value).toBeUndefined(); expect(read.problems.map(problem => problem.code)).toContain('install-required');
  });
  it('refuses unsupported build-only dependencies without altering the owned contribution', async () => {
    const root = await fixture(), previous = await fs.readFile(join(root, javaContribution));
    const result = await installJava(configuration('1.0.0', ['build']), join(root, 'expec.json'));
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('unsupported-package-phase');
    expect(result.effects).toEqual([]); expect(await fs.readFile(join(root, javaContribution))).toEqual(previous);
  });
});
