import { it, expect, vi } from 'vitest';
import { promises as fs, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { OutputsDriver } from '../driver/outputs.js';

it('cleans an output fixture created through a temporary-directory alias without deleting its neighbor', async () => {
  const temporary = realpathSync.native(tmpdir());
  const container = realpathSync.native(mkdtempSync(join(temporary, 'expec-output-cleanup-')));
  const actual = join(container, 'actual'), alias = join(container, 'alias');
  try {
    await fs.mkdir(actual);
    await fs.symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
    for (const name of ['TMPDIR', 'TEMP', 'TMP']) vi.stubEnv(name, alias);
    const fixture = new OutputsDriver();
    await fs.writeFile(join(actual, 'neighbor.txt'), 'keep');
    await fs.writeFile(join(fixture.directory, 'generated.txt'), 'fixture');

    await fixture.dispose();

    await expect(fs.stat(fixture.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(join(actual, 'neighbor.txt'), 'utf8')).toBe('keep');
  } finally {
    vi.unstubAllEnvs();
    const name = relative(temporary, container);
    if (isAbsolute(name) || name.includes(sep) || !name.startsWith('expec-output-cleanup-')) throw new Error('Unsafe cleanup fixture');
    await fs.rm(container, { recursive: true, force: true });
  }
});
