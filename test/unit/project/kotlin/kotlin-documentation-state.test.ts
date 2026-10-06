import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { kotlinState, kotlinStatePath } from '../../../../src/project/kotlin/kotlin-output-state.js';
import type { ProjectSnapshot } from '../../../../src/project/connection/project-connection.js';

function snapshot(documentation?: string[], adopted = true): ProjectSnapshot {
  const generated = 'package store\nfun save(): String = "Dune"\n';
  const state = { format: 1, options: '{"package":"store","adoptExisting":true}', subjects: ['save'], deleted: [], mappings: [],
    files: [{ id: 'save', path: 'src/main/kotlin/store/save.kt', generated, hash: createHash('sha256').update(generated).digest('hex'), adopted,
      ...(documentation ? { documentation } : {}), artifacts: [{ specId: 'save', locator: { outputId: 'kotlin', format: 'kotlin-symbol-1',
        value: { file: 'src/main/kotlin/store/save.kt', declaration: [{ kind: 'function', name: 'save', parameters: [] }] } } }] }] };
  const bytes = Buffer.from(JSON.stringify(state));
  return { root: { path: 'project', identity: 'root' }, complete: true, problems: [], excludeNames: [], excluded: [],
    files: [{ path: kotlinStatePath, bytes, version: createHash('sha256').update(bytes).digest('hex') }] };
}
it('retains one explicit generated-documentation identity in its adopted file', () => {
  const read = kotlinState(snapshot(['save']));
  expect(read.problems).toEqual([]);
  expect(read.value?.files[0]?.documentation).toEqual(['save']);
});
it('does not infer documentation ownership in an older adopted baseline', () => {
  const read = kotlinState(snapshot());
  expect(read.problems).toEqual([]);
  expect(read.value?.files[0]?.documentation).toBeUndefined();
});
it('refuses duplicate documentation ownership identities', () => {
  expect(kotlinState(snapshot(['save', 'save'])).problems.map(item => item.code)).toEqual(['invalid-output-state']);
});
it('refuses documentation ownership absent from the same file associations', () => {
  expect(kotlinState(snapshot(['other'])).problems.map(item => item.code)).toEqual(['invalid-output-state']);
});
it('does not accept adopted documentation metadata on a wholly generated file', () => {
  expect(kotlinState(snapshot(['save'], false)).problems.map(item => item.code)).toEqual(['invalid-output-state']);
});

