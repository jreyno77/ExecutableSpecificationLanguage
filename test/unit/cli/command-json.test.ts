import { describe, expect, it } from 'vitest';
import { commandJson } from '../../../src/cli/command-json.js';

describe('rendering command JSON for its consumer', () => {
  it('omits repeated private transition bodies but keeps actual effect facts', () => {
    const body = Buffer.alloc(8 * 1024 * 1024, 0x5a);
    const value = { format: 1, command: 'build', status: 'built', exitCode: 0,
      problems: [], deferred: [], obligations: [], stages: [{ name: 'contracts', status: 'applied', outputs: ['typescript'],
        receipt: { outcomes: [{ change: { kind: 'write', path: '.expec/build-transition.json', bytes: body }, state: 'applied',
          before: [{ path: '.expec/build-transition.json', state: 'absent' }],
          after: [{ path: '.expec/build-transition.json', state: 'file', version: 'original-observed-hash', bytes: body }] }] } }] };
    const json = commandJson(value);
    const result = JSON.parse(json);
    expect(Buffer.byteLength(json)).toBeLessThan(1024);
    expect(result.stages[0].receipt.outcomes).toEqual([{ change: { kind: 'write', path: '.expec/build-transition.json' }, state: 'applied',
      before: [{ path: '.expec/build-transition.json', state: 'absent' }],
      after: [{ path: '.expec/build-transition.json', state: 'file', version: 'original-observed-hash' }] }]);
  });

  it('keeps refused pending-save findings and states without echoing its private body', () => {
    const value = { status: 'invalid', exitCode: 1, problems: [{ code: 'write-refused', message: 'Original refusal' }],
      stages: [{ name: 'contracts', status: 'stopped', journal: { outcomes: [{
        change: { kind: 'write', path: '.expec/build-pending.json', bytes: Buffer.from('private intent') }, state: 'not-applied',
        before: [{ path: '.expec/build-pending.json', state: 'absent' }], after: [{ path: '.expec/build-pending.json', state: 'absent' }] }] } }] };
    const result = JSON.parse(commandJson(value));
    expect(result.status).toBe('invalid');
    expect(result.exitCode).toBe(1);
    expect(result.problems).toEqual(value.problems);
    expect(result.stages[0].journal.outcomes[0]).toEqual({ change: { kind: 'write', path: '.expec/build-pending.json' }, state: 'not-applied',
      before: [{ path: '.expec/build-pending.json', state: 'absent' }], after: [{ path: '.expec/build-pending.json', state: 'absent' }] });
  });

  it('keeps ordinary user, ownership and identity bytes in their existing base64 form', () => {
    for (const path of ['src/Book.ts', '.expec/typescript-output.json', '.expec/identity.json', 'expec.json']) {
      const result = JSON.parse(commandJson({ path, state: 'file', version: 'retained-hash', bytes: Buffer.from('literal bytes') }));
      expect(result).toEqual({ path, state: 'file', version: 'retained-hash', bytes: { encoding: 'base64', data: 'bGl0ZXJhbCBieXRlcw==' } });
    }
  });

  it('does not hide a similarly named user file or other non-byte fields', () => {
    const result = JSON.parse(commandJson({ path: 'notes/build-transition.json', bytes: new Uint8Array([1, 2]), detail: 'original detail' }));
    expect(result).toEqual({ path: 'notes/build-transition.json', bytes: { encoding: 'base64', data: 'AQI=' }, detail: 'original detail' });
  });

  it('keeps removal-before facts and cleanup evidence without repeating the private body', () => {
    const value = { stages: [{ name: 'tests', status: 'applied', outputs: ['test-data'], receipt: {
      status: 'applied', problems: [], createdDirectories: ['test'], temporaryPaths: ['.expec/tmp-original'],
      outcomes: [{ change: { kind: 'remove', path: '.expec/build-transition.json' }, state: 'applied',
        before: [{ path: '.expec/build-transition.json', state: 'file', version: 'original-transition-hash', bytes: Buffer.from('private intent') }],
        after: [{ path: '.expec/build-transition.json', state: 'absent' }] }] } }] };
    const result = JSON.parse(commandJson(value));
    expect(result.stages).toEqual([{ name: 'tests', status: 'applied', outputs: ['test-data'], receipt: {
      status: 'applied', problems: [], createdDirectories: ['test'], temporaryPaths: ['.expec/tmp-original'],
      outcomes: [{ change: { kind: 'remove', path: '.expec/build-transition.json' }, state: 'applied',
        before: [{ path: '.expec/build-transition.json', state: 'file', version: 'original-transition-hash' }],
        after: [{ path: '.expec/build-transition.json', state: 'absent' }] }] } }]);
  });

  it('encodes only the visible Buffer and Uint8Array slices for ordinary observations', () => {
    const buffer = Buffer.from([88, 1, 2, 66]).subarray(1, 3);
    const view = new Uint8Array([99, 1, 2, 77]).subarray(1, 3);
    const value = { stages: [{ name: 'contracts', receipt: { outcomes: [{
      change: { kind: 'write', path: '.expec/build-pending.json', bytes: view }, state: 'applied', before: [],
      after: [{ path: 'src/Book.ts', state: 'file', version: 'book-hash', bytes: buffer },
        { path: 'src/View.ts', state: 'file', version: 'view-hash', bytes: view },
        { path: '.expec/build-pending.json', state: 'file', version: 'pending-hash', bytes: buffer }] }] } }] };
    const outcome = JSON.parse(commandJson(value)).stages[0].receipt.outcomes[0];
    expect(outcome).toEqual({ change: { kind: 'write', path: '.expec/build-pending.json' }, state: 'applied', before: [],
      after: [{ path: 'src/Book.ts', state: 'file', version: 'book-hash', bytes: { encoding: 'base64', data: 'AQI=' } },
        { path: 'src/View.ts', state: 'file', version: 'view-hash', bytes: { encoding: 'base64', data: 'AQI=' } },
        { path: '.expec/build-pending.json', state: 'file', version: 'pending-hash' }] });
  });

  it('leaves the whole input report and caller-owned body bytes unchanged', () => {
    const body = Buffer.from('private intent');
    const value = { status: 'built', problems: [], stages: [{ name: 'contracts', status: 'applied', receipt: { outcomes: [{
      change: { kind: 'write', path: '.expec/build-transition.json', bytes: body }, state: 'applied', before: [],
      after: [{ path: '.expec/build-transition.json', state: 'file', version: 'original-hash', bytes: body }] }] } }] };
    const before = structuredClone(value);
    commandJson(value);
    expect(structuredClone(value)).toEqual(before);
    expect(value.stages[0]!.receipt.outcomes[0]!.change.bytes).toBe(body);
    expect(value.stages[0]!.receipt.outcomes[0]!.after[0]!.bytes).toBe(body);
    expect(body.toString()).toBe('private intent');
  });

  it('keeps other byte keys and non-byte fields on an actual private receipt row', () => {
    const value = { stages: [{ name: 'contracts', journal: { outcomes: [{
      change: { kind: 'write', path: '.expec/build-pending.json', bytes: Buffer.from('private intent'), annotation: new Uint8Array([1, 2]), detail: 'original detail' },
      state: 'not-applied', before: [], after: [] }, {
      change: { kind: 'write', path: '.expec/build-transition.json', bytes: 'original non-byte metadata' }, state: 'not-applied', before: [], after: [] }] } }] };
    expect(JSON.parse(commandJson(value)).stages[0].journal.outcomes).toEqual([{
      change: { kind: 'write', path: '.expec/build-pending.json', annotation: { encoding: 'base64', data: 'AQI=' }, detail: 'original detail' },
      state: 'not-applied', before: [], after: [] }, {
      change: { kind: 'write', path: '.expec/build-transition.json', bytes: 'original non-byte metadata' }, state: 'not-applied', before: [], after: [] }]);
  });

  it('retains an ordinary byte receipt at a similarly named private-directory path', () => {
    const value = { stages: [{ name: 'contracts', receipt: { outcomes: [{
      change: { kind: 'write', path: '.expec/build-transition.json.bak', bytes: new Uint8Array([1, 2]) }, state: 'applied', before: [],
      after: [{ path: '.expec/build-transition.json.bak', state: 'file', version: 'backup-hash', bytes: new Uint8Array([1, 2]) }] }] } }] };
    expect(JSON.parse(commandJson(value)).stages[0].receipt.outcomes[0]).toEqual({
      change: { kind: 'write', path: '.expec/build-transition.json.bak', bytes: { encoding: 'base64', data: 'AQI=' } }, state: 'applied', before: [],
      after: [{ path: '.expec/build-transition.json.bak', state: 'file', version: 'backup-hash', bytes: { encoding: 'base64', data: 'AQI=' } }] });
  });

  it('keeps row-shaped diagnostic detail even when the same object occurs in a receipt', () => {
    const observed = { path: '.expec/build-transition.json', state: 'file', version: 'original-hash', bytes: new Uint8Array([1, 2]) };
    const value = { problems: [{ code: 'original-problem', message: 'Original message', detail: observed }], stages: [{
      name: 'contracts', status: 'applied', detail: observed, receipt: { outcomes: [{
        change: { kind: 'write', path: '.expec/build-transition.json', bytes: new Uint8Array([1, 2]) }, state: 'applied', before: [], after: [observed] }] } }] };
    const result = JSON.parse(commandJson(value));
    const detail = { path: '.expec/build-transition.json', state: 'file', version: 'original-hash', bytes: { encoding: 'base64', data: 'AQI=' } };
    expect(result.problems).toEqual([{ code: 'original-problem', message: 'Original message', detail }]);
    expect(result.stages[0].detail).toEqual(detail);
    expect(result.stages[0].receipt.outcomes[0].after).toEqual([{ path: '.expec/build-transition.json', state: 'file', version: 'original-hash' }]);
  });
  it('omits private bodies in configuration and initialization write receipts', () => {
    const row = { change: { kind: 'write', path: '.expec/build-pending.json', bytes: new Uint8Array([1, 2]) },
      state: 'applied', before: [], after: [{ path: '.expec/build-pending.json', state: 'file', version: 'observed-hash', bytes: new Uint8Array([1, 2]) }] };
    const result = JSON.parse(commandJson({ stages: [{ name: 'configuration', write: { status: 'applied', outcomes: [row] } },
      { name: 'initialization', initialization: { status: 'initialized', write: { status: 'applied', outcomes: [row] } } }] }));
    const expected = { status: 'applied', outcomes: [{ change: { kind: 'write', path: '.expec/build-pending.json' }, state: 'applied', before: [],
      after: [{ path: '.expec/build-pending.json', state: 'file', version: 'observed-hash' }] }] };
    expect(result.stages).toEqual([{ name: 'configuration', write: expected },
      { name: 'initialization', initialization: { status: 'initialized', write: expected } }]);
  });

  it('requires the file observation state and string version before omitting a private body', () => {
    const observations = [{ path: '.expec/build-pending.json', state: 'absent', bytes: new Uint8Array([1, 2]) },
      { path: '.expec/build-pending.json', state: 'file', bytes: new Uint8Array([1, 2]) },
      { path: '.expec/build-pending.json', state: 'file', version: 7, bytes: new Uint8Array([1, 2]) }];
    const result = JSON.parse(commandJson({ stages: [{ receipt: { outcomes: [{ before: observations, after: [] }] } }] }));
    expect(result.stages[0].receipt.outcomes[0].before).toEqual([
      { path: '.expec/build-pending.json', state: 'absent', bytes: { encoding: 'base64', data: 'AQI=' } },
      { path: '.expec/build-pending.json', state: 'file', bytes: { encoding: 'base64', data: 'AQI=' } },
      { path: '.expec/build-pending.json', state: 'file', version: 7, bytes: { encoding: 'base64', data: 'AQI=' } },
    ]);
  });

  it('keeps ordinary bodies within actual receipt slots, including private-directory user data', () => {
    for (const path of ['src/Book.ts', '.expec/typescript-output.json', '.expec/identity.json', 'expec.json', '.expec/user-data.json']) {
      const result = JSON.parse(commandJson({ stages: [{ receipt: { outcomes: [{ change: { kind: 'write', path, bytes: Buffer.from('literal bytes') },
        state: 'applied', before: [], after: [{ path, state: 'file', version: 'observed-hash', bytes: Buffer.from('literal bytes') }] }] } }] }));
      expect(result.stages[0].receipt.outcomes[0]).toEqual({ change: { kind: 'write', path, bytes: { encoding: 'base64', data: 'bGl0ZXJhbCBieXRlcw==' } },
        state: 'applied', before: [], after: [{ path, state: 'file', version: 'observed-hash', bytes: { encoding: 'base64', data: 'bGl0ZXJhbCBieXRlcw==' } }] });
    }
  });
});
