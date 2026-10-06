import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BuildContext } from '../../../src/cli/cli-context.js';
import { hash } from '../../../src/project/connection/project-files.js';
import type { ProjectSnapshot } from '../../../src/project/connection/project-connection.js';

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
