import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { PackageDriver } from '../../driver/package/installed-package.js';

async function suppliedArchive() {
  const directory = await mkdtemp(join(tmpdir(), 'expec-supplied-package-'));
  const archive = join(directory, 'tested-package.tgz');
  const bytes = Buffer.from('The caller owns these verified package bytes.\n');
  await writeFile(archive, bytes);
  onTestFinished(async () => {
    const name = relative(resolve(tmpdir()), resolve(directory));
    if (isAbsolute(name) || name.includes(sep) || !name.startsWith('expec-supplied-package-'))
      throw new Error('Unexpected supplied archive fixture directory');
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, archive, bytes };
}

beforeEach(() => {
  vi.stubEnv('EXPEC_TEST_PACKAGE', undefined);
  vi.stubEnv('npm_execpath', undefined);
});
afterEach(async () => {
  try { await PackageDriver.finish(); }
  finally { vi.unstubAllEnvs(); }
});

describe('package consumers use their supplied archive', () => {
  it('selects the exact supplied file without requiring a package manager', async () => {
    const { archive } = await suppliedArchive();

    await PackageDriver.prepare(archive);

    expect(PackageDriver.packedArtifact).toBe(archive);
  });

  it('uses the archive supplied by the workflow environment', async () => {
    const { archive } = await suppliedArchive();
    vi.stubEnv('EXPEC_TEST_PACKAGE', archive);

    await PackageDriver.prepare();

    expect(PackageDriver.packedArtifact).toBe(archive);
  });

  it('uses an explicit archive instead of the environment selection', async () => {
    const { directory, archive } = await suppliedArchive();
    vi.stubEnv('EXPEC_TEST_PACKAGE', join(directory, 'unused-archive.tgz'));

    await PackageDriver.prepare(archive);

    expect(PackageDriver.packedArtifact).toBe(archive);
  });

  it('preserves the caller archive through cleanup and another preparation', async () => {
    const { archive, bytes } = await suppliedArchive();
    await PackageDriver.prepare(archive);

    await PackageDriver.finish();
    await PackageDriver.finish();
    expect(await readFile(archive)).toEqual(bytes);

    await PackageDriver.prepare(archive);
    expect(PackageDriver.packedArtifact).toBe(archive);
    await PackageDriver.finish();
    expect(await readFile(archive)).toEqual(bytes);
  });

  it('rejects a relative archive instead of packing a replacement', async () => {
    await expect(PackageDriver.prepare('tested-package.tgz')).rejects.toThrow('absolute');
  });

  it('rejects an empty supplied path instead of packing a replacement', async () => {
    await expect(PackageDriver.prepare('')).rejects.toThrow('absolute');
  });

  it('rejects a missing supplied file instead of packing a replacement', async () => {
    const { directory } = await suppliedArchive();
    const missing = join(directory, 'missing-package.tgz');

    await expect(PackageDriver.prepare(missing)).rejects.toThrow(missing);
  });

  it('rejects a supplied directory instead of packing a replacement', async () => {
    const { directory } = await suppliedArchive();

    await expect(PackageDriver.prepare(directory)).rejects.toThrow('regular file');
  });
});
