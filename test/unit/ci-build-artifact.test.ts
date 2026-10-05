import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyBuild } from '../../.github/ci/build-artifact.js';

const directories: string[] = [];
async function builtPackage() {
  const root = await mkdtemp(join(tmpdir(), 'expec-ci-artifact-')); directories.push(root);
  await mkdir(join(root, '.local-docs'), { recursive: true });
  await mkdir(join(root, 'dist'));
  const files = { 'dist/index.js': 'export const answer = 42;', '.local-docs/package.tgz': 'test package bytes' };
  for (const [path, bytes] of Object.entries(files)) await writeFile(join(root, path), bytes);
  await writeFile(join(root, '.local-docs/build.json'), JSON.stringify({
    commit: 'abc', platform: 'win32', package: '.local-docs/package.tgz',
    files: Object.fromEntries(Object.entries(files).map(([path, text]) =>
      [path, createHash('sha256').update(text).digest('hex')])),
  }));
  return root;
}
afterEach(async () => { await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe('a test job reuses its own verified build', () => {
  it('receives the captured package without building it again', async () => {
    const root = await builtPackage();
    expect(await verifyBuild(root, 'abc', 'win32')).toBe(join(root, '.local-docs/package.tgz'));
  });
  it('rejects outputs from another source commit', async () => {
    await expect(verifyBuild(await builtPackage(), 'other', 'win32')).rejects.toThrow('source');
  });
  it('rejects outputs from another operating system', async () => {
    await expect(verifyBuild(await builtPackage(), 'abc', 'linux')).rejects.toThrow('platform');
  });
  it('rejects an output changed after the build', async () => {
    const root = await builtPackage(); await writeFile(join(root, 'dist/index.js'), 'incorrect');
    await expect(verifyBuild(root, 'abc', 'win32')).rejects.toThrow('digest');
  });
  it('rejects a captured path outside the checkout', async () => {
    const root = await builtPackage();
    await writeFile(join(root, '.local-docs/build.json'), JSON.stringify({
      commit: 'abc', platform: 'win32', package: '../elsewhere.tgz', files: { '../elsewhere.tgz': '123' },
    }));
    await expect(verifyBuild(root, 'abc', 'win32')).rejects.toThrow('path');
  });
});
