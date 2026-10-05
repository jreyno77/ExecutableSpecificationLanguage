import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Compiler } from '../../src/compiler.js';
import { currentTestIdentity, identityBytes, readDecisions, readIdentity } from '../../src/cli-identity.js';
import type { CheckedManifest } from '../../src/cli-check.js';
import { SpecificationIdentity } from '../../src/specification-identity.js';
import type { ProjectSnapshot } from '../../src/project-connection.js';

const roots: { path: string; parent: string }[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (dirname(await realpath(root.path)) !== root.parent) throw Error('Unexpected identity fixture cleanup.');
    await rm(root.path, { recursive: true, force: true });
  }
});
async function author(text: string) {
  const parent = await realpath(tmpdir()), path = await realpath(await mkdtemp(join(parent, 'expec-cli-identity-')));
  roots.push({ path, parent });
  const sourceId = pathToFileURL(join(path, 'main.expec')).href;
  const result = new Compiler().compile({ locator: sourceId, source: { sourceId, text }, dependencies: { modules: [], packages: [] } });
  expect(result.syntax).toEqual([]); expect(result.problems).toEqual([]); expect(result.value).toBeDefined();
  const checked: CheckedManifest = { manifest: join(path, 'expec.json'), specification: result.value!, captures: [], problems: [], syntax: [], deferred: [] };
  const filename = join(path, 'changes.json');
  return { checked, filename, async decide(value: unknown) { await writeFile(filename, typeof value === 'string' ? value : JSON.stringify(value)); return readDecisions(filename, checked); } };
}

describe('explicit CLI identity correspondence', () => {
  it('retains an unchanged confirmed declaration before native execution', async () => {
    const authored = await author('concept Book {}'), identity = new SpecificationIdentity(() => 'retained-book');
    const baseline = identity.associate(authored.checked.specification!).value!.baseline;
    const root = { path: '/project', identity: 'captured-root' };
    const snapshot: ProjectSnapshot = { root, complete: true, problems: [], excluded: [], excludeNames: [],
      files: [{ path: '.expec/identity.json', bytes: identityBytes(authored.checked, root, baseline), version: 'a'.repeat(64) }] };
    const current = currentTestIdentity(authored.checked, snapshot);
    expect(current.problems).toEqual([]);
    const book = [...authored.checked.specification!.inspection.query('concept')][0]!;
    expect(current.value!.id(book.id)).toBe('retained-book');
  });
  it('refuses a pending build even when no native runner has been selected', async () => {
    const authored = await author('concept Book {}');
    const snapshot: ProjectSnapshot = { root: { path: '/project', identity: 'captured-root' }, complete: true, problems: [], excluded: [], excludeNames: [],
      files: [{ path: '.expec/build-pending.json', bytes: new TextEncoder().encode('{}'), version: 'a'.repeat(64) }] };
    const current = currentTestIdentity(authored.checked, snapshot);
    expect(current.value).toBeUndefined();
    expect(current.problems).toMatchObject([{ code: 'generation-required', message: 'Complete the pending build before executing tests.' }]);
  });
  it('requires a confirmed build instead of inventing test identities', async () => {
    const authored = await author('concept Book {}');
    const current = currentTestIdentity(authored.checked, { root: { path: '/project', identity: 'captured-root' }, complete: true, problems: [], excluded: [], excludeNames: [], files: [] });
    expect(current.value).toBeUndefined();
    expect(current.problems).toMatchObject([{ code: 'generation-required', message: 'Build the current specification before executing its tests.' }]);
  });
  it('refuses changed checked source against the prior confirmed identity', async () => {
    const authored = await author('concept Book {}'), baseline = new SpecificationIdentity(() => 'retained-book').associate(authored.checked.specification!).value!.baseline;
    const root = { path: '/project', identity: 'captured-root' }, bytes = identityBytes(authored.checked, root, baseline);
    const sourceId = authored.checked.specification!.entry;
    authored.checked.specification = new Compiler().compile({ locator: sourceId, source: { sourceId, text: 'concept Book {}\nconcept Publisher {}' }, dependencies: { modules: [], packages: [] } }).value!;
    expect(authored.checked.specification).toBeDefined();
    const current = currentTestIdentity(authored.checked, { root, complete: true, problems: [], excluded: [], excludeNames: [],
      files: [{ path: '.expec/identity.json', bytes, version: 'a'.repeat(64) }] });
    expect(current.value).toBeUndefined();
    expect(current.problems).toMatchObject([{ code: 'generation-required', message: 'Current source differs from its confirmed generated specification.' }]);
  });
  it('reports corrupt UTF8 identity bytes without substituting new history or throwing', async () => {
    const authored = await author('concept Book {}');
    const snapshot = { root: { path: '/project', identity: 'captured-root' }, complete: true, problems: [], excluded: [], excludeNames: [],
      files: [{ path: '.expec/identity.json', bytes: new Uint8Array([0xff]), version: 'a'.repeat(64) }] };
    const read = readIdentity(snapshot, authored.checked);
    expect(read.value).toBeUndefined(); expect(read.problems.map(problem => problem.code)).toEqual(['identity-baseline']);
  });
  it('selects an actual declaration after an astral character using scalar columns', async () => {
    const authored = await author('type `📚` { name: Text }');
    const read = await authored.decide({ format: 1, matches: [{ id: 'original-title', to: { source: 'main.expec', line: 1, column: 12 } }], retire: [] });
    expect(read.problems).toEqual([]);
    const field = [...authored.checked.specification!.inspection.query('field')][0]!;
    expect(read.value!.decisions).toEqual([{ id: 'original-title', to: field.id }]);
    expect(read.value!.inputs).toEqual([{ uri: pathToFileURL(authored.filename).href, version: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    expect(JSON.parse(await readFile(authored.filename, 'utf8')).matches[0].to.column).toBe(12);
  });
  it('refuses the corresponding UTF16 column rather than guessing a nearby field', async () => {
    const authored = await author('type `📚` { name: Text }');
    const read = await authored.decide({ format: 1, matches: [{ id: 'original-title', to: { source: 'main.expec', line: 1, column: 13 } }], retire: [] });
    expect(read.value).toBeUndefined(); expect(read.problems.map(problem => problem.code)).toEqual(['invalid-decisions']);
  });
  it('does not select a name token in place of the declaration start', async () => {
    const authored = await author('function save() returns Nothing');
    const read = await authored.decide({ format: 1, matches: [{ id: 'save', to: { source: 'main.expec', line: 1, column: 10 } }], retire: [] });
    expect(read.value).toBeUndefined(); expect(read.problems.map(problem => problem.code)).toEqual(['invalid-decisions']);
  });
  it('does not accept coordinates in a file absent from the checked inspection', async () => {
    const authored = await author('function save() returns Nothing');
    const read = await authored.decide({ format: 1, matches: [{ id: 'save', to: { source: 'other.expec', line: 1, column: 1 } }], retire: [] });
    expect(read.value).toBeUndefined(); expect(read.problems.map(problem => problem.code)).toEqual(['invalid-decisions']);
  });
  it('rejects duplicate JSON keys before selecting a declaration', async () => {
    const authored = await author('function save() returns Nothing');
    const read = await authored.decide('{"format":1,"format":1,"matches":[],"retire":[]}');
    expect(read.value).toBeUndefined(); expect(read.problems.map(problem => problem.code)).toEqual(['duplicate-key']);
  });
  it('rejects unknown decision fields instead of silently discarding them', async () => {
    const authored = await author('function save() returns Nothing');
    const read = await authored.decide({ format: 1, matches: [], retire: [], guessNames: true });
    expect(read.value).toBeUndefined(); expect(read.problems.map(problem => problem.code)).toEqual(['invalid-decisions']);
  });
});
