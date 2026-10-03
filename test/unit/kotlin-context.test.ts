import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { KotlinDeliveryDriver } from '../driver/kotlin-delivery.js';
import { KotlinContext } from '../../src/index.js';

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
  const library = resolve('src/kotlin/lib/kotlin-stdlib-2.4.10.jar');
  const report = { format: 1, kotlin: '2.4.10', gradle: '9.1.0', jvmTarget: '21', javaHome, sourceRoots,
    classPath: { main: [library], test: [library] }, packages: [],
    inputs: (await driver.context.readSnapshot()).files.map(file => ({ path: file.path, version: file.version })) };
  await driver.file('.expec/kotlin/classpath.json', JSON.stringify(report));
  return { driver, context: new KotlinContext(driver.context), library };
}

describe('captured Kotlin prerequisites', () => {
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
});
