import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../../src/compiler/compiler.js';
import type { CheckedManifest } from '../../../src/cli/cli-check.js';
import { currentTestIdentity, identityBytes, transitionPath } from '../../../src/cli/cli-identity.js';
import { readTransition, retainTransition, transitionChange } from '../../../src/cli/cli-transition.js';
import { ConfigurationReader } from '../../../src/project/connection/configuration.js';
import type { ProjectSnapshot } from '../../../src/project/connection/project-connection.js';
import { SpecificationIdentity } from '../../../src/model/specification-identity.js';
import { hash } from '../../../src/project/connection/project-files.js';

function pending() {
  const sourceId = 'file:///spec/main.expec', compiler = new Compiler();
  const beforeText = 'function save(source: Text) returns Nothing', afterText = 'function save(document: Text) returns Nothing';
  const compile = (text: string) => { const result = compiler.compile({ locator: sourceId, source: { sourceId, text }, dependencies: { modules: [], packages: [] } });
    expect(result.syntax).toEqual([]); expect(result.problems).toEqual([]); expect(result.value).toBeDefined(); return result.value!; };
  let next = 0; const identity = new SpecificationIdentity(() => 'subject-' + next++), before = identity.associate(compile(beforeText)).value!;
  const changed = compile(afterText), parameter = [...changed.inspection.query('parameter')][0]!;
  const id = before.baseline.elements.find(item => item.address.name === 'source')!.id;
  const candidate = identity.associate(changed, before.baseline, [{ id, to: parameter.id }]).value!;
  const text = JSON.stringify({ formatVersion: 1, version: '1.0.0', build: { entries: ['main.expec'] }, outputs: [{ id: 'typescript' }, { id: 'acceptance' }] });
  const configuration = new ConfigurationReader(['typescript', 'acceptance'].map(id => ({ id, validate: () => [] }))).read({ sourceId: 'file:///spec/expec.json', text }).value!;
  const checked: CheckedManifest = { manifest: '/spec/expec.json', text, configuration, specification: changed, problems: [], syntax: [], deferred: [],
    captures: [{ source: { sourceId, text: afterText }, version: hash(Buffer.from(afterText)) }] };
  const file = (path: string, text: string | Uint8Array) => { const bytes = Buffer.from(text); return { path, bytes, version: hash(bytes) }; };
  const snapshot: ProjectSnapshot = { root: { path: '/project', identity: 'owned-project' }, complete: true, problems: [], excluded: ['node_modules'], excludeNames: ['node_modules'],
    files: [], readOnlyFiles: [file('node_modules/types/index.d.ts', 'export interface Native {}')] };
  const tests = new Set(['acceptance']), retained = retainTransition(checked, snapshot, tests, before.baseline, candidate);
  const completion = transitionChange(retained, 'contracts'); expect(completion.kind).toBe('write');
  const bytes = (completion as { bytes: Uint8Array }).bytes;
  const confirmed: ProjectSnapshot = { ...snapshot, files: [file('.expec/identity.json', identityBytes(checked, snapshot.root, candidate.baseline)), file(transitionPath, bytes)] };
  return { checked, candidate, before, id, snapshot: confirmed, tests, file,
    read(snapshot = confirmed, input = checked) { return readTransition(input, snapshot, tests); },
    changeRecord(change: (record: any) => void) { const record = JSON.parse(Buffer.from(bytes).toString()); change(record);
      return { ...confirmed, files: confirmed.files.map(item => item.path === transitionPath ? file(transitionPath, JSON.stringify(record)) : item) }; } };
}

describe('retained CLI output transition', () => {
  it('keeps the actual old name and durable ID for the remaining test stage', () => {
    const project = pending(), result = project.read();
    expect(result.problems).toEqual([]); expect(result.value?.remaining).toEqual(['tests']);
    expect(result.value?.before?.elements.find(item => item.id === project.id)?.address.name).toBe('source');
    expect(result.value?.candidate.elements.find(item => item.id === project.id)?.address.name).toBe('document');
  });
  it('permits a handwritten body repair before fresh stage validation', () => {
    const project = pending();
    const result = project.read({ ...project.snapshot, files: [...project.snapshot.files, project.file('src/save.ts', 'export function save(document: string) { void document; }')] });
    expect(result.problems).toEqual([]); expect(result.value?.remaining).toEqual(['tests']);
  });
  it('refuses a different source capture even when only its comment changed', () => {
    const project = pending(), checked = { ...project.checked, captures: [{ ...project.checked.captures[0]!, version: hash(Buffer.from('// changed')) }] };
    expect(project.read(project.snapshot, checked).problems).toMatchObject([{ code: 'recovery-conflict' }]);
  });
  it('refuses different output settings', () => {
    const project = pending(), checked = { ...project.checked, text: project.checked.text!.replace('typescript', 'markdown') };
    expect(project.read(project.snapshot, checked).problems).toMatchObject([{ code: 'recovery-conflict' }]);
  });
  it('refuses the same files at a different project identity', () => {
    const project = pending();
    expect(project.read({ ...project.snapshot, root: { ...project.snapshot.root, identity: 'another-project' } }).problems).toMatchObject([{ code: 'recovery-conflict' }]);
  });
  it('refuses changed captured dependency declarations', () => {
    const project = pending();
    expect(project.read({ ...project.snapshot, readOnlyFiles: [project.file('node_modules/types/index.d.ts', 'export interface Changed {}')] }).problems).toMatchObject([{ code: 'recovery-conflict' }]);
  });
  it('refuses an invalid retained baseline instead of guessing identities', () => {
    const project = pending();
    expect(project.read(project.changeRecord(record => { record.before.elements[0].id = ''; })).problems).toMatchObject([{ code: 'recovery-conflict' }]);
  });
  it('refuses unknown record fields and repeated completed stages', () => {
    const project = pending();
    expect(project.read(project.changeRecord(record => { record.reset = true; })).problems).toMatchObject([{ code: 'recovery-conflict' }]);
    expect(project.read(project.changeRecord(record => { record.remaining = ['tests', 'contracts']; })).problems).toMatchObject([{ code: 'recovery-conflict' }]);
  });
  it('requires the identity confirmation for the completed contract stage', () => {
    const project = pending();
    expect(project.read({ ...project.snapshot, files: project.snapshot.files.map(item => item.path === '.expec/identity.json'
      ? project.file(item.path, identityBytes(project.checked, project.snapshot.root, project.before.baseline)) : item) }).problems).toMatchObject([{ code: 'recovery-conflict' }]);
  });
  it('blocks native execution while any output still needs the transition', () => {
    const project = pending(), result = currentTestIdentity(project.checked, project.snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems).toMatchObject([{ code: 'generation-required' }]);
  });
  it('compiles the authored recovery examples without claiming to execute their unbound helpers', () => {
    const text = readFileSync(new URL('../../resources/pilot/connected-output-transitions.expec', import.meta.url), 'utf8');
    const sourceId = 'file:///connected-output-transitions.expec';
    const result = new Compiler().compile({ locator: sourceId, source: { sourceId, text }, dependencies: { modules: [], packages: [] } });
    expect(result.syntax).toEqual([]); expect(result.problems).toEqual([]); expect(result.deferred).toEqual([]);
    expect([...result.value!.inspection.query('scenario')]).toHaveLength(4);
  });
});

function corrected(project: ReturnType<typeof pending>) {
  const sourceId = project.checked.captures[0]!.source.sourceId, text = 'function save(payload: Text) returns Nothing';
  const compiled = new Compiler().compile({ locator: sourceId, source: { sourceId, text }, dependencies: { modules: [], packages: [] } });
  if (!compiled.value) throw Error(JSON.stringify(compiled));
  const checked = { ...project.checked, specification: compiled.value, captures: [{ source: { sourceId, text }, version: hash(Buffer.from(text)) }] };
  const parameter = [...compiled.value.inspection.query('parameter')][0]!;
  const correction = { replan: true as const, decisions: [{ id: project.id, to: parameter.id }] };
  return { checked, read: (snapshot = project.snapshot, input: CheckedManifest = checked) => readTransition(input, snapshot, project.tests, correction) };
}

describe('explicit source-only transition supersession', () => {
  it('keeps original test source and the actually confirmed document contract as distinct bases', () => {
    const project = pending(), result = corrected(project).read();
    expect(result.problems).toEqual([]); expect(result.value?.record.format).toBe(2);
    expect(result.value?.remaining).toEqual(['contracts', 'tests']);
    expect(result.value?.before?.elements.find(record => record.id === project.id)?.address.name).toBe('source');
    expect(result.value?.contractBefore?.elements.find(record => record.id === project.id)?.address.name).toBe('document');
    expect(result.value?.candidate.elements.find(record => record.id === project.id)?.address.name).toBe('payload');
  });
  it('still requires exact manifest text when new source intent is requested', () => {
    const project = pending(), correction = corrected(project);
    expect(correction.read(project.snapshot, { ...correction.checked, text: correction.checked.text + '\n' }).problems).toMatchObject([{ code: 'recovery-conflict' }]);
  });
  it('still requires the original connected project identity', () => {
    const project = pending();
    expect(corrected(project).read({ ...project.snapshot, root: { ...project.snapshot.root, identity: 'other-project' } }).problems).toMatchObject([{ code: 'recovery-conflict' }]);
  });
  it('still requires exact native declaration evidence', () => {
    const project = pending();
    expect(corrected(project).read({ ...project.snapshot, readOnlyFiles: [project.file('node_modules/types/index.d.ts', 'export interface Changed {}')] }).problems).toMatchObject([{ code: 'recovery-conflict' }]);
  });
  it('still requires the original exclusion policy', () => {
    const project = pending();
    expect(corrected(project).read({ ...project.snapshot, excludeNames: [...project.snapshot.excludeNames, 'notes'] }).problems).toMatchObject([{ code: 'recovery-conflict' }]);
  });
  it('still requires the original package input evidence', () => {
    const project = pending(), correction = corrected(project);
    expect(correction.read(project.snapshot, { ...correction.checked, packageInputs: [{ uri: 'file:///project/package.json', version: 'a'.repeat(64) }] }).problems).toMatchObject([{ code: 'recovery-conflict' }]);
  });
  it('does not turn unknown retained input fields into default evidence', () => {
    const project = pending();
    const changed = project.changeRecord(record => { const facts = JSON.parse(record.inputs); facts.reset = true; record.inputs = JSON.stringify(facts); });
    expect(corrected(project).read(changed).problems).toMatchObject([{ code: 'recovery-conflict' }]);
  });
  it('does not replace malformed retained input JSON with an empty environment', () => {
    const project = pending();
    expect(corrected(project).read(project.changeRecord(record => { record.inputs = '{'; })).problems).toMatchObject([{ code: 'recovery-conflict' }]);
  });
  it('does not accept duplicated captured-source facts', () => {
    const project = pending();
    const changed = project.changeRecord(record => { const facts = JSON.parse(record.inputs); facts.captures.push(facts.captures[0]); record.inputs = JSON.stringify(facts); });
    expect(corrected(project).read(changed).problems).toMatchObject([{ code: 'recovery-conflict' }]);
  });
  it('requires the real confirmed candidate before accepting revised intent', () => {
    const project = pending();
    const changed = { ...project.snapshot, files: project.snapshot.files.filter(file => file.path !== '.expec/identity.json') };
    expect(corrected(project).read(changed).problems).toMatchObject([{ code: 'recovery-conflict' }]);
  });
  it('validates format-two pre-contract confirmation against the confirmed contract basis', () => {
    const project = pending(), correction = corrected(project), replanned = correction.read();
    expect(replanned.problems).toEqual([]); expect(replanned.value).toBeDefined();
    const change = transitionChange(replanned.value!);
    if (change.kind !== 'write') throw Error('Both selected stages must retain a transition');
    const snapshot = { ...project.snapshot, files: project.snapshot.files.map(file => file.path === transitionPath ? project.file(transitionPath, change.bytes) : file) };
    expect(readTransition(correction.checked, snapshot, project.tests).problems).toEqual([]);
    const premature = { ...snapshot, files: snapshot.files.map(file => file.path === '.expec/identity.json'
      ? project.file(file.path, identityBytes(correction.checked, snapshot.root, replanned.value!.candidate)) : file) };
    expect(readTransition(correction.checked, premature, project.tests).problems).toMatchObject([{ code: 'recovery-conflict' }]);
  });
  it('validates format-two post-contract confirmation against its new candidate', () => {
    const project = pending(), correction = corrected(project), replanned = correction.read();
    expect(replanned.problems).toEqual([]); expect(replanned.value).toBeDefined();
    const change = transitionChange(replanned.value!, 'contracts');
    if (change.kind !== 'write') throw Error('The test stage must remain');
    const snapshot = { ...project.snapshot, files: project.snapshot.files.map(file => file.path === transitionPath ? project.file(transitionPath, change.bytes)
      : file.path === '.expec/identity.json' ? project.file(file.path, identityBytes(correction.checked, project.snapshot.root, replanned.value!.candidate)) : file) };
    const read = readTransition(correction.checked, snapshot, project.tests);
    expect(read.problems).toEqual([]); expect(read.value?.remaining).toEqual(['tests']);
    expect(read.value?.before?.elements.find(record => record.id === project.id)?.address.name).toBe('source');
  });
  it('rejects a malformed format-two contract baseline', () => {
    const project = pending(), correction = corrected(project), replanned = correction.read();
    expect(replanned.value).toBeDefined();
    const record = { ...replanned.value!.record, contractBefore: { invalid: true } };
    const snapshot = { ...project.snapshot, files: project.snapshot.files.map(file => file.path === transitionPath ? project.file(transitionPath, JSON.stringify(record)) : file) };
    expect(readTransition(correction.checked, snapshot, project.tests).problems).toMatchObject([{ code: 'recovery-conflict' }]);
  });
});
