import { describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PythonCliDriver } from '../driver/python-cli.js';

async function tree(check: (driver: PythonCliDriver, root: string) => Promise<void>): Promise<void> {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'expec-python-observer-'))), created = await lstat(root);
  const driver = new PythonCliDriver(); driver.directory = join(root, 'fixture');
  await mkdir(join(driver.directory, 'project/.venv'), { recursive: true });
  await mkdir(join(root, 'first')); await mkdir(join(root, 'second'));
  await writeFile(join(root, 'first/native.txt'), 'same'); await writeFile(join(root, 'second/native.txt'), 'same');
  try { await check(driver, root); }
  finally {
    const current = await lstat(root);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== created.dev || current.ino !== created.ino
      || await realpath(root) !== root || dirname(root) !== parent) throw Error('Fixture cleanup root changed.');
    await rm(root, { recursive: true });
  }
}

describe('Python unchanged-tree observations', () => {
  it('records a native environment link without traversing its external target', async () => {
    await tree(async (driver, root) => {
      await writeFile(driver.path('project/settings.txt'), 'retained');
      await symlink(join(root, 'first'), driver.path('project/.venv/lib64'), process.platform === 'win32' ? 'junction' : 'dir');
      const before = await driver.captureNativeFiles();
      expect(Object.keys(before)).toContain('project/settings.txt');
      expect(Object.keys(before)).toContain('project/.venv/lib64');
      expect(Object.keys(before).some(path => path.endsWith('native.txt'))).toBe(false);
      expect(await driver.captureNativeFiles()).toEqual(before);
      await writeFile(driver.path('project/settings.txt'), 'modified');
      expect(await driver.captureNativeFiles()).not.toEqual(before);
    });
  });
  it('detects a changed native link destination even when both targets have the same bytes', async () => {
    await tree(async (driver, root) => {
      const link = driver.path('project/.venv/lib64'), type = process.platform === 'win32' ? 'junction' : 'dir';
      await symlink(join(root, 'first'), link, type);
      const before = await driver.captureNativeFiles();
      await unlink(link); await symlink(join(root, 'second'), link, type);
      const after = await driver.captureNativeFiles();
      expect(Object.keys(after)).toEqual(Object.keys(before));
      expect(after['project/.venv/lib64']).not.toBe(before['project/.venv/lib64']);
      expect(after).not.toEqual(before);
    });
  });
});
