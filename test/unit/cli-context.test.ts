import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BuildContext } from '../../src/cli-context.js';
import { hash } from '../../src/project-files.js';
import type { ProjectSnapshot } from '../../src/project-connection.js';

const roots: { path: string; parent: string }[] = [];
afterEach(async () => { for (const { path, parent } of roots.splice(0)) {
  if (dirname(await fs.realpath(path)) !== parent) throw Error('Unexpected context fixture cleanup.');
  await fs.rm(path, { recursive: true, force: true });
} });
async function input() {
  const parent = await fs.realpath(tmpdir()), path = await fs.realpath(await fs.mkdtemp(join(parent, 'expec-cli-context-')));
  roots.push({ path, parent });
  const manifest = join(path, 'expec.json'), text = '{}'; await fs.writeFile(manifest, text);
  const snapshot: ProjectSnapshot = { root: { path, identity: 'unit-context' }, complete: true, problems: [], files: [], excluded: [], excludeNames: ['node_modules'] };
  const checked = { manifest, text, captures: [], problems: [], syntax: [], deferred: [] };
  const project = { root: snapshot.root, readSnapshot: async () => structuredClone(snapshot) };
  return { context: new BuildContext(project, checked, []), snapshot, fingerprint: { uri: pathToFileURL(manifest).href, version: hash(Buffer.from(text)) } };
}

describe('composing captured build evidence', () => {
  it('does not promote an incomplete underlying capture to complete', async () => {
    const value = await input(); Object.assign(value.snapshot, { complete: false });
    expect((await value.context.readSnapshot()).complete).toBe(false);
  });
  it('coalesces identical native evidence retained across one stage', async () => {
    const value = await input(); Object.assign(value.snapshot, { nativeInputs: [value.fingerprint] });
    const result = await value.context.during(value.snapshot).readSnapshot();
    expect(result.complete).toBe(true); expect(result.nativeInputs).toEqual([value.fingerprint]);
  });
  it('refuses conflicting versions of the same actual input', async () => {
    const value = await input(); Object.assign(value.snapshot, { nativeInputs: [{ ...value.fingerprint, version: 'a'.repeat(64) }] });
    const result = await value.context.readSnapshot();
    expect(result.complete).toBe(false); expect(result.problems.map(problem => problem.code)).toContain('stale-build-input');
  });
});

describe('fresh native build evidence reads the actual files', () => {
  it('refuses same-length changed bytes instead of trusting a retained digest', async () => {
    const value = await input(), path = join(value.snapshot.root.path, 'library.txt');
    await fs.writeFile(path, 'one');
    Object.assign(value.snapshot, { nativeInputs: [{ uri: pathToFileURL(path).href, version: hash(Buffer.from('one')) }] });
    await fs.writeFile(path, 'two');
    const result = await value.context.readSnapshot();
    expect(result.complete).toBe(false);
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'stale-build-input', message: expect.stringContaining(pathToFileURL(path).href) }));
  });
  it('refuses a same-content file substituted during its actual read', async () => {
    const value = await input(), path = join(value.snapshot.root.path, 'library.txt'), replacement = join(value.snapshot.root.path, 'replacement.txt');
    await fs.writeFile(path, 'one'); await fs.writeFile(replacement, 'one');
    Object.assign(value.snapshot, { nativeInputs: [{ uri: pathToFileURL(path).href, version: hash(Buffer.from('one')) }] });
    const read = fs.readFile.bind(fs); let changed = false;
    const replace = vi.spyOn(fs, 'readFile').mockImplementation(async (...args: Parameters<typeof fs.readFile>) => {
      const bytes = await read(...args);
      if (!changed && String(args[0]) === path) { changed = true; await fs.unlink(path); await fs.rename(replacement, path); }
      return bytes;
    });
    try {
      const result = await value.context.readSnapshot(); expect(changed).toBe(true); expect(result.complete).toBe(false);
      expect(result.problems).toContainEqual(expect.objectContaining({ code: 'stale-build-input', message: expect.stringContaining(pathToFileURL(path).href) }));
    } finally { replace.mockRestore(); }
  });
  it('retains every changed input in supplied order when several files disagree', async () => {
    const value = await input(), inputs = [];
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const path = join(value.snapshot.root.path, name + '.txt'); await fs.writeFile(path, 'one');
      inputs.push({ uri: pathToFileURL(path).href, version: hash(Buffer.from('one')) });
    }
    Object.assign(value.snapshot, { nativeInputs: inputs });
    for (const name of ['b', 'e']) await fs.writeFile(join(value.snapshot.root.path, name + '.txt'), 'two');
    const result = await value.context.readSnapshot(); expect(result.complete).toBe(false);
    expect(result.problems.map(problem => problem.message)).toEqual([expect.stringContaining(inputs[1]!.uri), expect.stringContaining(inputs[4]!.uri)]);
  });
});
