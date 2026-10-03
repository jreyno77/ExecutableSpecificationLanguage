import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Outputs, ProjectOutput, type OutputAdapter, type OutputPlan, type ProjectSnapshot, type IdentifiedSpecification } from '../../src/index.js';
const basedOn: ProjectSnapshot = { root: { path: '/project', identity: 'test' }, complete: true, files: [], excludeNames: [], excluded: [], problems: [] };
const current = {} as IdentifiedSpecification;
const scope = [{ outputId: 'custom', format: 'fixture', value: 'all fixture files' }];
function adapter(plan: unknown): OutputAdapter {
  return { id: 'custom', plan: async () => plan as never,
    read: async () => ({ artifacts: [], coverage: { scope, complete: true, limitations: [] }, problems: [] }),
    search: async subject => ({ definitions: [], incoming: { subject, direction: 'incoming', coverage: { scope, complete: true, limitations: [] }, uses: [], unresolved: [] },
      outgoing: { subject, direction: 'outgoing', coverage: { scope, complete: true, limitations: [] }, uses: [], unresolved: [] }, problems: [] }) };
}
function workflow(target: OutputAdapter) {
  let writes = 0, reads = 0;
  const output = new ProjectOutput(target, { root: basedOn.root, readSnapshot: async () => { reads++; return basedOn; } },
    { apply: async () => { writes++; return { root: basedOn.root, status: 'unchanged', outcomes: [], problems: [], createdDirectories: [], temporaryPaths: [] }; } });
  return { output, reads: () => reads, writes: () => writes };
}
const value: OutputPlan = { outputId: 'custom', basedOn, changes: [], artifacts: [] };
const issue = { code: 'unsupported', message: 'No mapping', at: { kind: 'dependency', path: ['custom'] }, related: [] };
describe('the output workflow checks its replaceable collaborators', () => {
  it('captures once and retains the actual applied receipt', async () => {
    const caller = workflow(adapter({ value, problems: [], deferred: [] }));
    expect(await caller.output.create(current)).toMatchObject({ receipt: { status: 'unchanged' }, artifacts: [], problems: [] });
    expect(caller.reads()).toBe(1); expect(caller.writes()).toBe(1);
  });
  it('planning does not read or write the live project', async () => {
    const caller = workflow(adapter({ value, problems: [], deferred: [] }));
    expect((await caller.output.plan({ operation: 'create', current }, basedOn)).value).toEqual(value);
    expect(caller.reads()).toBe(0); expect(caller.writes()).toBe(0);
  });
  it('preserves the reason a target refuses to plan', async () => {
    const caller = workflow(adapter({ problems: [issue], deferred: [] }));
    expect(await caller.output.create(current)).toEqual({ problems: [issue] }); expect(caller.writes()).toBe(0);
  });
  const invalid = [
    ['a successful value with findings', { value, problems: [issue], deferred: [] }],
    ['an empty refusal', { problems: [], deferred: [] }],
    ['a deferred-only refusal', { problems: [], deferred: [{ reason: 'missing' }] }],
    ['a foreign output namespace', { value: { ...value, outputId: 'other' }, problems: [], deferred: [] }],
    ['an adapter-rebased snapshot', { value: { ...value, basedOn: { ...basedOn, root: { ...basedOn.root, identity: 'other' } } }, problems: [], deferred: [] }],
    ['overlapping endpoints', { value: { ...value, changes: [{ kind: 'write', path: 'file', bytes: new Uint8Array() }, { kind: 'remove', path: 'file' }] }, problems: [], deferred: [] }],
    ['traversal outside the project', { value: { ...value, changes: [{ kind: 'remove', path: '../outside' }] }, problems: [], deferred: [] }],
    ['duplicate association locators', { value: { ...value, artifacts: [1, 2].map(id => ({ specId: 'id-' + id, locator: scope[0] })) }, problems: [], deferred: [] }],
  ] as const;
  for (const [name, result] of invalid) it('rejects ' + name + ' before writing', async () => {
    const caller = workflow(adapter(result)); await expect(caller.output.create(current)).rejects.toBeInstanceOf(TypeError); expect(caller.writes()).toBe(0);
  });
  it('rejects fabricated read bytes', async () => {
    const target = adapter({ value, problems: [], deferred: [] });
    target.read = async () => ({ artifacts: [{ at: scope[0]!, file: { path: 'missing', bytes: Buffer.from('fiction'), version: createHash('sha256').update('fiction').digest('hex') } }], coverage: { scope, complete: true, limitations: [] }, problems: [] });
    await expect(workflow(target).output.read('id')).rejects.toBeInstanceOf(TypeError);
  });
  it('rejects contradictory complete search coverage', async () => {
    const target = adapter({ value, problems: [], deferred: [] }), original = target.search;
    target.search = async (id, snapshot) => { const result = await original(id, snapshot); return { ...result, incoming: { ...result.incoming,
      unresolved: [{ at: scope[0]!, reason: 'unresolved' }] } }; };
    await expect(workflow(target).output.search('id')).rejects.toBeInstanceOf(TypeError);
  });
  it('rejects duplicate registrations rather than replacing one', () => {
    const outputs = new Outputs(), registration = { id: 'custom', validate: () => [], open: () => adapter({ value, problems: [], deferred: [] }) };
    outputs.register(registration); expect(() => outputs.register(registration)).toThrow(TypeError);
  });
  it('captures options and preserves a registration receiver', async () => {
    const outputs = new Outputs(), options = JSON.parse('{"directory":"docs","__proto__":{"safe":true}}');
    let captured: unknown;
    outputs.register({ id: 'custom', validate() { expect(this.id).toBe('custom'); return []; }, open(settings) { expect(this.id).toBe('custom'); captured = settings; return adapter({ value, problems: [], deferred: [] }); } });
    const check = outputs.open('custom', options, { root: basedOn.root, readSnapshot: async () => basedOn }, { apply: async () => { throw new Error('Unexpected effect'); } });
    expect(check.value).toBeDefined(); options.directory = 'changed'; options.__proto__.safe = false;
    expect(captured).toEqual(JSON.parse('{"directory":"docs","__proto__":{"safe":true}}'));
  });
  it('rejects a successful adapter plan over incomplete input before writing', async () => {
    const snapshot = { ...basedOn, complete: false }, target = adapter({ value: { ...value, basedOn: snapshot }, problems: [], deferred: [] });
    const caller = workflow(target);
    await expect(caller.output.plan({ operation: 'create', current }, snapshot)).rejects.toBeInstanceOf(TypeError); expect(caller.writes()).toBe(0);
  });
  it('rejects a foreign association namespace', async () => {
    const caller = workflow(adapter({ value: { ...value, artifacts: [{ specId: 'id', locator: { ...scope[0]!, outputId: 'other' } }] }, problems: [], deferred: [] }));
    await expect(caller.output.create(current)).rejects.toBeInstanceOf(TypeError); expect(caller.writes()).toBe(0);
  });
  it('keeps a stopped writer receipt and does not confirm artifact associations', async () => {
    const receipt = { root: basedOn.root, status: 'stopped' as const, outcomes: [], problems: [{ ...issue, at: { kind: 'dependency' as const, path: ['write'] } }], createdDirectories: ['docs'], temporaryPaths: ['.expec/write.lock'] };
    const output = new ProjectOutput(adapter({ value, problems: [], deferred: [] }), { root: basedOn.root, readSnapshot: async () => basedOn }, { apply: async () => receipt });
    expect(await output.create(current)).toEqual({ receipt, problems: receipt.problems });
  });
  it('propagates unexpected writer errors without inventing an effects-free receipt', async () => {
    const failure = new Error('Unknown native boundary failure');
    const output = new ProjectOutput(adapter({ value, problems: [], deferred: [] }), { root: basedOn.root, readSnapshot: async () => basedOn }, { apply: async () => { throw failure; } });
    await expect(output.create(current)).rejects.toBe(failure);
  });
  it('rejects unexplained incomplete search coverage', async () => {
    const target = adapter({ value, problems: [], deferred: [] }), original = target.search;
    target.search = async (id, snapshot) => { const result = await original(id, snapshot); return { ...result, incoming: {
      ...result.incoming, coverage: { ...result.incoming.coverage, complete: false },
    } }; };
    await expect(workflow(target).output.search('id')).rejects.toBeInstanceOf(TypeError);
  });
  it('retains captured project failures when a reader reports only its target limitation', async () => {
    const problem = { code: 'read-failed', message: 'Cannot read notes.md', at: { kind: 'dependency' as const, path: ['notes.md'] }, related: [] };
    const snapshot = { ...basedOn, complete: false, problems: [problem] }, target = adapter({ value, problems: [], deferred: [] });
    target.read = async () => ({ artifacts: [], coverage: { scope, complete: false, limitations: ['Some project files are unavailable.'] }, problems: [] });
    const output = new ProjectOutput(target, { root: basedOn.root, readSnapshot: async () => snapshot }, { apply: async () => { throw new Error('Read must not write'); } });
    expect((await output.read('id')).problems).toContainEqual(problem);
  });
});
