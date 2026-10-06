import { it, expect, onTestFinished, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import * as native from '../../../../src/project/connection/native-process.js';
import { NativePackageDriver } from '../../../driver/project/dependencies/native-packages.js';

async function readWithQuery(change: (items: Record<string, unknown>[]) => unknown, code = 0, opaquePath?: string) {
  const driver = new NativePackageDriver(); await driver.initialize(); onTestFinished(() => driver.dispose());
  await driver.seed('example-storage', '2.1.0', '^2');
  driver.require('storage', 'npm:example-storage', '^2', ['runtime']);
  const actual = native.runNative;
  vi.spyOn(native, 'runNative').mockImplementation(async (command, args, cwd) => {
    const result = await actual(command, args, cwd);
    if (args[0] === 'ls' && opaquePath !== undefined) {
      const data = JSON.parse(result.stdout);
      for (const item of Object.values(data.dependencies ?? {}) as Record<string, unknown>[]) item.path = opaquePath;
      return { ...result, stdout: JSON.stringify(data) };
    }
    return args[0] === 'query' ? { ...result, code, stdout: JSON.stringify(change(JSON.parse(result.stdout))) } : result;
  });
  await driver.read(); expect(driver.after).toEqual(driver.before); return driver.result;
}
function refused(result: Awaited<ReturnType<typeof readWithQuery>>, code: string) {
  expect(result.value).toBeUndefined(); expect(result.problems).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
}

it('refuses missing native location correspondence instead of inventing an installed path', async () => {
  refused(await readWithQuery(() => []), 'invalid-native-output');
}, 30_000);

it('refuses two locations that collapse to the same opaque native path', async () => {
  refused(await readWithQuery(items => [...items, { ...items[0], location: 'node_modules/another' }]), 'invalid-native-output');
}, 30_000);

it('refuses a query location that escapes the selected project', async () => {
  refused(await readWithQuery(items => items.map(item => ({ ...item, location: '../outside' }))), 'unsupported-package-location');
}, 30_000);

it('refuses an absolute query location even when its opaque path matches', async () => {
  refused(await readWithQuery(items => items.map(item => ({ ...item, location: item.path }))), 'unsupported-package-location');
}, 30_000);

it('retains native query failure despite usable partial location output', async () => {
  refused(await readWithQuery(items => items, 1), 'native-package-read-failed');
}, 30_000);

it('retains actual package versions when native location evidence contradicts them', async () => {
  const result = await readWithQuery(items => items.map(item => ({ ...item, version: '9.0.0' })));
  refused(result, 'invalid-native-output');
  expect(result.packages).toEqual([{ name: 'npm:example-storage', requested: '^2', selected: '2.1.0', installed: '2.1.0' }]);
}, 30_000);

it('refuses a native location row with no version evidence', async () => {
  refused(await readWithQuery(items => items.map(item => ({ ...item, version: undefined }))), 'invalid-native-output');
}, 30_000);

it('refuses empty opaque paths even when both native views repeat them', async () => {
  refused(await readWithQuery(items => items.map(item => ({ ...item, path: '' })), 0, ''), 'invalid-native-output');
}, 30_000);

it('refuses an individually linked package whose real target is inside the project', async () => {
  const driver = new NativePackageDriver(); await driver.initialize(); onTestFinished(() => driver.dispose());
  await driver.seed('example-storage', '2.1.0', '^2'); driver.require('storage', 'npm:example-storage', '^2', ['runtime']);
  const link = join(driver.root, 'node_modules/example-storage'), target = join(driver.root, 'linked-storage');
  await fs.rename(link, target); await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  const paths = ['package.json', 'package-lock.json', 'linked-storage/package.json'];
  const before = await Promise.all(paths.map(path => fs.readFile(join(driver.root, path))));
  const linkTarget = await fs.readlink(link), result = await driver.client.read(driver.requirements);
  expect(result.value).toBeUndefined();
  expect(result.problems.some(problem => ['invalid-native-output', 'unsupported-package-location', 'unsupported-change'].includes(problem.code))).toBe(true);
  expect(await Promise.all(paths.map(path => fs.readFile(join(driver.root, path))))).toEqual(before);
  expect((await fs.lstat(link)).isSymbolicLink()).toBe(true); expect(await fs.readlink(link)).toBe(linkTarget);
}, 30_000);
