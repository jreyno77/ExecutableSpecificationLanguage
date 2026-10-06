import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { KotlinDeliveryDriver } from '../../../driver/project/kotlin/kotlin-delivery.js';
import { FileProjectWriter, KotlinContext, KotlinProject, ProjectConnector } from '../../../../src/index.js';

const instances: KotlinDeliveryDriver[] = [];
afterEach(async () => { for (const driver of instances.splice(0)) await driver.dispose(); });
async function captureFixture() {
  const driver = new KotlinDeliveryDriver(); instances.push(driver); await driver.initialize();
  const javaHome = process.env.EXPEC_TEST_JAVA_HOME ?? process.env.JAVA_HOME;
  if (!javaHome) throw new Error('Supply the actual JDK21 path for native context examples.');
  const sourceRoots = { main: ['src/main/kotlin'], test: ['src/test/kotlin'] };
  await driver.file('expec.kotlin.json', JSON.stringify({ javaHome, sourceRoots }));
  await driver.file('build.gradle.kts', 'plugins { kotlin("jvm") version "2.4.10" }\n');
  await driver.file('settings.gradle.kts', 'rootProject.name = "native-context-example"\n');
  const library = resolve('src/project/kotlin/resources/lib/kotlin-stdlib-2.4.10.jar');
  const report = { format: 1, kotlin: '2.4.10', gradle: '9.1.0', jvmTarget: '21', javaHome, sourceRoots,
    classPath: { main: [library], test: [library] }, packages: [],
    inputs: (await driver.context.readSnapshot()).files.map(file => ({ path: file.path, version: file.version })) };
  await driver.file('.expec/kotlin/classpath.json', JSON.stringify(report));
  return { driver, context: new KotlinContext(driver.context), library };
}

describe('captured Kotlin prerequisites', () => {
  it('identifies a pruned selected configuration instead of asking for installation', async () => {
    const { driver } = await captureFixture();
    await driver.file('build/expec.kotlin.json', JSON.stringify({ javaHome: process.env.EXPEC_TEST_JAVA_HOME,
      sourceRoots: { main: ['src/main/kotlin'], test: ['src/test/kotlin'] } }));
    const snapshot = await new KotlinContext(driver.context, { configFile: 'build/expec.kotlin.json' }).readSnapshot();
    expect(snapshot.complete).toBe(false);
    expect(snapshot.problems).toContainEqual(expect.objectContaining({ code: 'excluded-kotlin-input', message: expect.stringContaining('build/expec.kotlin.json') }));
    expect(snapshot.problems.map(problem => problem.code)).not.toContain('native-inputs-unavailable');
  }, 30_000);

  it('captures actual JDK and classpath bytes as guarded evidence', async () => {
    const { context, library } = await captureFixture();
    const snapshot = await context.readSnapshot();
    expect(snapshot.problems).toEqual([]);
    expect(snapshot.complete).toBe(true);
    const bytes = await fs.readFile(library);
    expect(snapshot.nativeInputs).toBeDefined();
    expect(snapshot.nativeInputs).toContainEqual({ uri: pathToFileURL(await fs.realpath(library)).href, version: createHash('sha256').update(bytes).digest('hex') });
  }, 30_000);

  it('does not trust a classpath report after the actual native build changes', async () => {
    const { context, driver } = await captureFixture();
    await driver.file('build.gradle.kts', '// authored change\n');
    const snapshot = await context.readSnapshot();
    expect(snapshot.complete).toBe(false);
    expect(snapshot.problems.map(problem => problem.code)).toContain('native-configuration-stale');
  }, 30_000);

  it('does not interpret a pruned source package as an empty source set', async () => {
    const { context, driver } = await captureFixture();
    await driver.file('src/main/kotlin/store/build/Hidden.kt', 'package store.build\nclass Hidden');
    const snapshot = await context.readSnapshot();
    expect(snapshot.complete).toBe(false);
    expect(snapshot.problems).toContainEqual(expect.objectContaining({ code: 'excluded-kotlin-input', message: expect.stringContaining('src/main/kotlin/store/build') }));
  }, 30_000);

  it('respects a supplied context which captures additional cache files', async () => {
    const { driver } = await captureFixture();
    await driver.file('.gradle/work/record.bin', 'Captured by the caller policy.');
    const connected = await new ProjectConnector(driver.manifest, { excludeNames: ['.git'] }).connect(driver.configuration);
    expect(connected.value?.status).toBe('connected');
    if (connected.value?.status !== 'connected') throw Error(JSON.stringify(connected));
    const snapshot = await new KotlinContext(connected.value.context).readSnapshot();
    expect(snapshot.complete).toBe(true); expect(snapshot.problems).toEqual([]);
    expect(snapshot.excludeNames).toEqual(['.git']);
    const captured = snapshot.files.find(file => file.path === '.gradle/work/record.bin');
    expect(captured).toBeDefined(); expect(Buffer.from(captured!.bytes).toString('utf8')).toBe('Captured by the caller policy.');
  }, 30_000);

  it('queries supplied source bytes without revisiting the live source directories', async () => {
    const { context, driver } = await captureFixture();
    await driver.file('src/main/kotlin/store/Book.kt', 'package store\nclass Book');
    const captured = await context.readSnapshot();
    expect(captured.problems).toEqual([]);
    const root = join(driver.root, 'src/main/kotlin');
    await fs.rename(root, join(driver.root, 'src/main/retained'));
    await fs.writeFile(root, 'The live project has changed since this capture.');
    const result = await new KotlinProject({ outputId: 'kotlin' }, [{ specId: 'book', locator: { outputId: 'kotlin', format: 'kotlin-symbol-1',
      value: { file: 'src/main/kotlin/store/Book.kt', declaration: [{ kind: 'class', name: 'Book' }] } } }]).search('book', captured);
    expect(result.problems).toEqual([]);
    expect(result.incoming.coverage.complete).toBe(true);
    expect(result.definitions[0]?.value).toEqual({ file: 'src/main/kotlin/store/Book.kt', start: 20, end: 24, role: 'definition' });
  }, 60_000);
});


describe('Kotlin capture composes upstream native evidence', () => {
  it('keeps an independent real native input in the writer capture', async () => {
    const { driver } = await captureFixture(), supplied = driver.context;
    const artifact = join(driver.directory, 'independent.bin'); await fs.writeFile(artifact, 'first');
    const context = new KotlinContext({ root: supplied.root, readSnapshot: async () => ({ ...await supplied.readSnapshot(), nativeInputs: [{
      uri: pathToFileURL(artifact).href, version: createHash('sha256').update(await fs.readFile(artifact)).digest('hex'),
    }] }) });
    const captured = await context.readSnapshot();
    expect(captured.problems).toEqual([]);
    expect(captured.nativeInputs).toContainEqual({ uri: pathToFileURL(artifact).href, version: createHash('sha256').update('first').digest('hex') });
    await fs.writeFile(artifact, 'second');
    const receipt = await new FileProjectWriter(context).apply({ basedOn: captured, changes: [{ kind: 'write', path: 'result.txt', bytes: Buffer.from('written') }] });
    expect(receipt.status).toBe('stopped');
    expect(receipt.problems.map(problem => problem.code)).toContain('stale-project');
    await expect(fs.readFile(join(driver.root, 'result.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 60_000);

  it('queries Kotlin while retaining unrelated upstream inputs without treating them as Kotlin sources', async () => {
    const { driver, context } = await captureFixture();
    await driver.file('src/main/kotlin/store/Book.kt', 'package store\nclass Book');
    const artifact = join(driver.directory, 'independent.bin'); await fs.writeFile(artifact, 'upstream native input');
    const captured = await context.readSnapshot();
    const result = await new KotlinProject({ outputId: 'kotlin' }, [{ specId: 'book', locator: { outputId: 'kotlin', format: 'kotlin-symbol-1',
      value: { file: 'src/main/kotlin/store/Book.kt', declaration: [{ kind: 'class', name: 'Book' }] } } }]).search('book', { ...captured,
        nativeInputs: [...captured.nativeInputs!, { uri: pathToFileURL(artifact).href, version: createHash('sha256').update(await fs.readFile(artifact)).digest('hex') }],
      });
    expect(result.problems).toEqual([]);
    expect(result.incoming.coverage.complete).toBe(true);
    expect(result.definitions[0]?.value).toEqual({ file: 'src/main/kotlin/store/Book.kt', start: 20, end: 24, role: 'definition' });
    expect(result.incoming.coverage.scope.map(item => item.value)).toEqual([{ file: 'src/main/kotlin/store/Book.kt' }]);
  }, 60_000);

  it('refuses conflicting versions of one native prerequisite', async () => {
    const { driver, library } = await captureFixture(), supplied = driver.context;
    const context = new KotlinContext({ root: supplied.root, readSnapshot: async () => ({ ...await supplied.readSnapshot(),
      nativeInputs: [{ uri: pathToFileURL(library).href, version: '0'.repeat(64) }],
    }) });
    const captured = await context.readSnapshot();
    expect(captured.complete).toBe(false);
    expect(captured.problems.map(problem => problem.code)).toContain('native-input-conflict');
  }, 30_000);

  it('does not replace malformed upstream evidence with an apparently complete Kotlin capture', async () => {
    const { driver } = await captureFixture(), supplied = driver.context;
    const context = new KotlinContext({ root: supplied.root, readSnapshot: async () => ({ ...await supplied.readSnapshot(),
      nativeInputs: [{ uri: 'relative.jar', version: '0'.repeat(64) }],
    }) });
    const captured = await context.readSnapshot();
    expect(captured.complete).toBe(false);
    expect(captured.problems.map(problem => problem.code)).toContain('native-inputs-unavailable');
  }, 30_000);
});
