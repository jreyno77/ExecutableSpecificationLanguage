import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { expect, it, onTestFinished } from 'vitest';
import { packageLocation } from '../../driver/package/installed-package.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'expec-package-location-'));
  onTestFinished(async () => {
    const name = relative(resolve(tmpdir()), resolve(root));
    if (isAbsolute(name) || name.includes(sep) || !name.startsWith('expec-package-location-')) throw new Error('Unexpected fixture directory');
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function entry(directory: string) {
  const file = join(directory, 'dist', 'index.js');
  await mkdir(join(directory, 'dist'), { recursive: true });
  await writeFile(file, 'export const installed = true;');
  return file;
}

it('recognizes an installed package through an alias of its consumer directory', async () => {
  const root = await fixture(), consumer = join(root, 'consumer'), alias = join(root, 'consumer-alias');
  const installed = await entry(join(consumer, 'node_modules', 'executable-specification-language'));
  await symlink(consumer, alias, 'junction');

  const location = await packageLocation(alias, join(alias, 'node_modules', 'executable-specification-language', 'dist', 'index.js'));

  expect(location.insidePackage).toBe(true);
  expect(location.real).toBe(await realpath(installed));
  expect(location.real).toBe(location.expected);
});

it('rejects a package link that resolves into a checkout instead of the consumer installation', async () => {
  const root = await fixture(), consumer = join(root, 'consumer'), checkout = join(root, 'checkout');
  await entry(checkout);
  await mkdir(join(consumer, 'node_modules'), { recursive: true });
  const linked = join(consumer, 'node_modules', 'executable-specification-language');
  await symlink(checkout, linked, 'junction');

  const location = await packageLocation(consumer, join(linked, 'dist', 'index.js'));

  expect(location.insidePackage && location.real === location.expected).toBe(false);
});
