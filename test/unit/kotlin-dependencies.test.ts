import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { KotlinDependencies } from '../../src/index.js';
import { KotlinDeliveryDriver } from '../driver/kotlin-delivery.js';

const instances: KotlinDeliveryDriver[] = [];
afterEach(async () => { for (const driver of instances.splice(0)) await driver.dispose(); });
async function fixture() { const driver = new KotlinDeliveryDriver(); instances.push(driver); await driver.initialize(); return driver; }

describe('Kotlin dependency observations', () => {
  it('keeps an empty request effect-free even without a project', async () => {
    const driver = await fixture();
    const root = join(driver.root, 'not-created');
    const dependencies = new KotlinDependencies(root);
    expect(await dependencies.read([])).toEqual({ value: [], packages: [], problems: [], deferred: [] });
    expect(await dependencies.install([])).toEqual({ value: [], packages: [], problems: [], deferred: [] });
    expect(await fs.readdir(driver.root)).toEqual([]);
  });
  it('does not translate a range or arbitrary build tool into a native request', async () => {
    const driver = await fixture(), dependencies = new KotlinDependencies(driver.root);
    const range = await dependencies.install([{ alias: 'books', name: 'maven:example:books', version: '^1.0.0', phases: ['runtime'] }]);
    const tool = await dependencies.install([{ alias: 'tool', name: 'maven:example:tool', version: '1.0.0', phases: ['build'] }]);
    expect(range.value).toBeUndefined(); expect(range.problems.map(problem => problem.code)).toContain('unsupported-native-package');
    expect(tool.value).toBeUndefined(); expect(tool.problems.map(problem => problem.code)).toContain('unsupported-native-package');
    expect(await fs.readdir(driver.root)).toEqual([]);
  });
  it('does not choose between incompatible aliases for one physical package', async () => {
    const driver = await fixture();
    const read = await new KotlinDependencies(driver.root).install([
      { alias: 'first', name: 'maven:example:books', version: '1.0.0', phases: ['runtime'] },
      { alias: 'second', name: 'maven:example:books', version: '2.0.0', phases: ['test'] },
    ]);
    expect(read.value).toBeUndefined(); expect(read.problems.map(problem => problem.code)).toContain('conflicting-package-requirements');
    expect(await fs.readdir(driver.root)).toEqual([]);
  });
  it('rejects malformed construction without discovering files', () => {
    expect(() => new KotlinDependencies('relative')).toThrow(TypeError);
    expect(() => new KotlinDependencies(resolve('unread'), { configFile: '../escape.json' })).toThrow(TypeError);
    expect(() => new KotlinDependencies(resolve('unread'), { unknown: true } as never)).toThrow(TypeError);
  });
  it('does not claim installation when one actual classpath artifact lacks recorded evidence', async () => {
    const driver = await fixture(); await driver.configureNative();
    const path = join(driver.root, '.expec/kotlin/classpath.json');
    const report = JSON.parse(await fs.readFile(path, 'utf8'));
    report.classPath.main.push(resolve('src/kotlin/lib/annotations-23.0.0.jar'));
    report.runtimeClassPath = report.classPath;
    report.artifacts = [{ path: report.classPath.main[0], version: createHash('sha256').update(await fs.readFile(report.classPath.main[0])).digest('hex') }];
    report.packages = [{ name: 'maven:org.jetbrains.kotlin:kotlin-stdlib', version: '2.4.10', phases: ['runtime'] }];
    await fs.writeFile(path, JSON.stringify(report));
    const read = await new KotlinDependencies(driver.root).read([{ alias: 'stdlib', name: 'maven:org.jetbrains.kotlin:kotlin-stdlib', version: '2.4.10', phases: ['runtime'] }]);
    expect(read.value === undefined).toBe(true);
    expect(read.problems.map(problem => problem.code)).toContain('invalid-native-report');
  }, 30_000);
});
