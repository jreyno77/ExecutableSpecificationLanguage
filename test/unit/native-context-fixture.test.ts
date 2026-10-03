import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { NativeContextDriver } from '../driver/typescript-context.js';

it('cleans its actual fixture when the host temporary path uses an alias', async () => {
  const parent = await fs.realpath(tmpdir()), root = await fs.mkdtemp(join(parent, 'expec-native-fixture-'));
  try {
    const target = join(root, 'actual'), alias = join(root, 'alias');
    await fs.mkdir(target); await fs.symlink(target, alias, 'junction');
    await fs.writeFile(join(root, 'keep.txt'), 'Outside the driver fixture.');
    vi.stubEnv('TMP', alias); vi.stubEnv('TEMP', alias); vi.stubEnv('TMPDIR', alias);
    const driver = new NativeContextDriver(), owned = driver.directory;
    expect(dirname(owned)).toBe(await fs.realpath(target));
    await driver.dispose();
    await expect(fs.access(owned)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(join(root, 'keep.txt'), 'utf8')).toBe('Outside the driver fixture.');
  } finally {
    vi.unstubAllEnvs();
    if (dirname(root) !== parent || !basename(root).startsWith('expec-native-fixture-') || await fs.realpath(root) !== root) throw Error('Unsafe fixture cleanup.');
    await fs.rm(root, { recursive: true, force: true });
  }
});
