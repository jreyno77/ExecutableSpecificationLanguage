import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { javaInputs } from '../../src/java-inputs.js';
import { hash } from '../../src/project-files.js';
import { JavaContext, type ProjectSnapshot } from '../../src/index.js';
import { pathToFileURL } from 'node:url';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
async function nativeFixture() {
  const directory = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-java-inputs-')); directories.push(directory);
  for (const child of ['bin', 'lib', 'conf', 'main', 'test']) await fs.mkdir(join(directory, child));
  await fs.writeFile(join(directory, 'release'), 'JAVA_VERSION="21.0.1"\n');
  await fs.writeFile(join(directory, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), 'native-launcher');
  await fs.writeFile(join(directory, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac'), 'native-compiler');
  await fs.writeFile(join(directory, 'lib', 'modules'), 'native-module-image');
  await fs.writeFile(join(directory, 'conf', 'security.properties'), 'captured-configuration');
  const config = { format: 1, release: 21, javaHome: directory, sourceRoots: { main: ['main'], test: ['test'] } };
  const file = (path: string, value: unknown) => { const bytes = Buffer.from(JSON.stringify(value)); return { path, bytes, version: hash(bytes) }; };
  const configuration = file('expec.java.json', config);
  const build = ['settings.gradle', 'build.gradle', 'gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.jar',
    'gradle/wrapper/gradle-wrapper.properties', '.expec/java/dependencies.gradle', 'gradle.lockfile'].map(path => file(path, 'native acquisition fixture'));
  const inputs = [configuration, ...build];
  const snapshot: ProjectSnapshot = { root: { path: directory, identity: 'native-fixture' }, complete: true, problems: [], excludeNames: [], excluded: [], files: [...inputs,
    file('.expec/java/classpath.json', { format: 1, release: 21, javaHome: directory, sourceRoots: config.sourceRoots,
      classPath: { main: { compile: [], runtime: [] }, test: { compile: [], runtime: [] } }, packages: [], inputs: inputs.map(({ path, version }) => ({ path, version })) })] };
  return { directory, snapshot };
}
function afterRead(path: string, action: () => Promise<void>) {
  const read = fs.readFile.bind(fs); let done = false;
  vi.spyOn(fs, 'readFile').mockImplementation((async (input, options) => {
    const bytes = await read(input, options as never);
    if (!done && String(input) === path) { done = true; await action(); }
    return bytes;
  }) as typeof fs.readFile);
}
describe('capturing actual selected Java inputs', () => {
  it('refuses a selected toolchain with no native launcher or compiler', async () => {
    const p = await nativeFixture(); await fs.rm(join(p.directory, 'bin'), { recursive: true }); await fs.mkdir(join(p.directory, 'bin'));
    const captured = await javaInputs(p.snapshot, 'expec.java.json');
    expect(captured.problems.map(problem => problem.code)).toContain('native-toolchain-unavailable');
  });
  it('detects an earlier selected file changing before capture completes', async () => {
    const p = await nativeFixture();
    afterRead(join(p.directory, 'conf', 'security.properties'), () => fs.writeFile(join(p.directory, 'release'), 'JAVA_VERSION="21.0.2"\n'));
    const captured = await javaInputs(p.snapshot, 'expec.java.json');
    expect(captured.problems.map(problem => problem.code)).toContain('native-input-changed');
  });
  it('detects replacement of an already enumerated directory with identical entries', async () => {
    const p = await nativeFixture();
    afterRead(join(p.directory, 'conf', 'security.properties'), async () => {
      await fs.rename(join(p.directory, 'bin'), join(p.directory, 'old-bin'));
      await fs.cp(join(p.directory, 'old-bin'), join(p.directory, 'bin'), { recursive: true });
    });
    const captured = await javaInputs(p.snapshot, 'expec.java.json');
    expect(captured.problems.map(problem => problem.code)).toContain('native-input-changed');
  });
  it('refuses an actual directory link cycle without unbounded traversal', async () => {
    const p = await nativeFixture(); await fs.symlink(join(p.directory, 'conf'), join(p.directory, 'conf', 'again'), 'junction');
    const realpath = fs.realpath.bind(fs); let traversals = 0;
    vi.spyOn(fs, 'realpath').mockImplementation((async (path, options) => {
      if (String(path).endsWith('again') && ++traversals > 4) throw new Error('Test traversal bound reached.');
      return realpath(path, options as never);
    }) as typeof fs.realpath);
    const captured = await javaInputs(p.snapshot, 'expec.java.json');
    expect(captured.problems.some(problem => problem.code === 'native-toolchain-unavailable' && /cycle/i.test(problem.message))).toBe(true);
    expect(traversals).toBeLessThanOrEqual(2);
  });
});


describe('Java contexts compose existing native evidence', () => {
  it('retains a real upstream input without making it a selected Java source', async () => {
    const p = await nativeFixture(), path = join(p.directory, 'upstream.txt'); await fs.writeFile(path, 'upstream native input');
    const evidence = { uri: pathToFileURL(path).href, version: hash(await fs.readFile(path)) };
    const source = { ...p.snapshot, nativeInputs: [evidence] };
    const captured = await new JavaContext({ root: source.root, readSnapshot: async () => structuredClone(source) }).readSnapshot();
    expect(captured.problems).toEqual([]); expect(captured.nativeInputs).toContainEqual(evidence);
    expect(captured.files.map(file => file.path)).not.toContain('upstream.txt'); expect(source.nativeInputs).toEqual([evidence]);
  });
  it('refuses contradictory upstream evidence for a selected native file', async () => {
    const p = await nativeFixture();
    const source = { ...p.snapshot, nativeInputs: [{ uri: pathToFileURL(join(p.directory, 'release')).href, version: 'a'.repeat(64) }] };
    const captured = await new JavaContext({ root: source.root, readSnapshot: async () => structuredClone(source) }).readSnapshot();
    expect(captured.complete).toBe(false); expect(captured.problems.map(problem => problem.code)).toContain('native-input-changed');
  });
});


it('permits two selected paths to the same ordinary target without mistaking them for a cycle', async () => {
  const p = await nativeFixture(); await fs.symlink(join(p.directory, 'lib'), join(p.directory, 'conf', 'library'), 'junction');
  const captured = await javaInputs(p.snapshot, 'expec.java.json');
  expect(captured.problems).toEqual([]);
  expect(captured.nativeInputs.filter(input => input.uri === pathToFileURL(join(p.directory, 'lib', 'modules')).href)).toHaveLength(1);
});


it('requires reinstallation after a previously absent native Gradle properties input appears', async () => {
  const p = await nativeFixture(), bytes = Buffer.from('org.gradle.java.installations.auto-detect=false');
  const snapshot = { ...p.snapshot, files: [...p.snapshot.files, { path: 'gradle.properties', bytes, version: hash(bytes) }] };
  const captured = await javaInputs(snapshot, 'expec.java.json');
  expect(captured.problems.some(problem => problem.code === 'install-required' && problem.message.includes('gradle.properties'))).toBe(true);
});

it('refuses an unprofiled alternative native build script', async () => {
  const p = await nativeFixture(), bytes = Buffer.from('plugins { java }');
  const snapshot = { ...p.snapshot, files: [...p.snapshot.files, { path: 'build.gradle.kts', bytes, version: hash(bytes) }] };
  const captured = await javaInputs(snapshot, 'expec.java.json');
  expect(captured.problems.some(problem => problem.code === 'unsupported-native-build' && problem.message.includes('build.gradle.kts'))).toBe(true);
});

it('will not trust a native report that omits the actual selected wrapper input', async () => {
  const p = await nativeFixture();
  const files = p.snapshot.files.map(file => {
    if (file.path !== '.expec/java/classpath.json') return file;
    const report = JSON.parse(Buffer.from(file.bytes).toString('utf8'));
    report.inputs = report.inputs.filter((input: { path: string }) => input.path !== 'gradle/wrapper/gradle-wrapper.jar');
    const bytes = Buffer.from(JSON.stringify(report)); return { ...file, bytes, version: hash(bytes) };
  });
  const captured = await javaInputs({ ...p.snapshot, files }, 'expec.java.json');
  expect(captured.problems.some(problem => problem.code === 'install-required' && problem.message.includes('gradle/wrapper/gradle-wrapper.jar'))).toBe(true);
});
