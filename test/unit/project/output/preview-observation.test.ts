import { promises as fs } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { PreviewDriver } from '../../../driver/project/output/preview.js';

it('detects a target read and same-byte rewrite even when the complete tree remains equal', async () => {
  const fixture = new PreviewDriver('type Book { title: Text }');
  await fixture.arrangeFiles({ 'draft/types/Book.ts': '// handwritten implementation\n' });
  try {
    await fixture.observation.during(async () => {
      const path = join(fixture.root, 'draft/types/Book.ts');
      const bytes = await fs.readFile(path);
      await fs.writeFile(path, bytes);
      const file = await fs.open(path, 'r'); await file.close();
    });
    expect(await fixture.tree()).toEqual(fixture.originalFiles);
    expect(fixture.observation.accesses).toEqual([
      { operation: 'readFile', path: 'draft/types/Book.ts' },
      { operation: 'writeFile', path: 'draft/types/Book.ts' },
      { operation: 'open', path: 'draft/types/Book.ts' },
    ]);
  } finally { await fixture.dispose(); }
});

it('removes its owned directory when arranging files fails partway through', async () => {
  const fixture = new PreviewDriver('type Book { title: Text }');
  try {
    await expect(fixture.arrangeFiles({ blocked: 'a file', 'blocked/child.ts': 'cannot be created' })).rejects.toThrow();
    await fixture.dispose();
    await expect(fs.stat(fixture.root)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    if (dirname(fixture.root) !== resolve(tmpdir()) || !basename(fixture.root).startsWith('expec-preview-')) throw new Error('Unexpected fixture directory.');
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
