import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Compiler, Outputs, SpecificationIdentity, contractListOutput, structureListOutput,
  type IdentifiedSpecification, type IdentityDecision, type OutputPlan, type ProjectSnapshot, type Specification } from '../../src/index.js';
const bytes = (text: string) => Buffer.from(text);
const file = (path: string, content: Uint8Array) => ({ path, bytes: content, version: createHash('sha256').update(content).digest('hex') });
const empty: ProjectSnapshot = { root: { path: '/fixture', identity: 'fixture' }, complete: true, files: [], excludeNames: ['.git', 'node_modules'], excluded: [], problems: [] };
function fixture(id = 'contract-list') {
  let next = 0, snapshot = empty;
  const identity = new SpecificationIdentity(() => 'subject-' + ++next), outputs = new Outputs();
  outputs.register(contractListOutput); outputs.register(structureListOutput);
  const output = outputs.open(id, { directory: 'docs' }, { root: empty.root, readSnapshot: async () => snapshot }, { apply: async () => { throw new Error('Pure plans do not apply files'); } }).value!;
  function current(text: string, before?: IdentifiedSpecification, decisions: (spec: Specification) => IdentityDecision[] = () => []): IdentifiedSpecification {
    const checked = new Compiler().compile({ locator: 'source', source: { sourceId: 'source.expec', text }, dependencies: { modules: [], packages: [] } });
    if (!checked.value) throw new Error(JSON.stringify(checked));
    const result = identity.associate(checked.value, before?.baseline, decisions(checked.value));
    if (!result.value) throw new Error(JSON.stringify(result)); return result.value;
  }
  function materialize(plan: OutputPlan): void {
    const files = new Map(snapshot.files.map(item => [item.path, item]));
    for (const change of plan.changes) {
      if (change.kind === 'write') files.set(change.path, file(change.path, change.bytes));
      else if (change.kind === 'remove') files.delete(change.path);
      else throw new Error('This fixture expects write/remove plans');
    }
    snapshot = { ...snapshot, files: [...files.values()] };
  }
  return { output, current, identity, materialize, get snapshot() { return snapshot; },
    edit(path: string, text: string) { snapshot = { ...snapshot, files: [...snapshot.files.filter(item => item.path !== path), file(path, bytes(text))] }; },
    remove(path: string) { snapshot = { ...snapshot, files: snapshot.files.filter(item => item.path !== path) }; } };
}
describe('whole-file output reconciliation', () => {
  it('refuses a complete-looking snapshot whose bytes disagree with its recorded version', async () => {
    const caller = fixture(), current = caller.current('concept Store {}');
    const snapshot = { ...empty, files: [{ ...file('notes.txt', bytes('old')), bytes: bytes('new') }] };
    const result = await caller.output.plan({ operation: 'create', current }, snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('invalid-project-snapshot');
  });
  it('refuses a destination whose parent is an existing file before planning changes', async () => {
    const caller = fixture(), current = caller.current('concept Store {}'); caller.edit('docs', 'handwritten');
    const result = await caller.output.plan({ operation: 'create', current }, caller.snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('output-conflict');
  });
  it('keeps a lost recorded file distinct from an absent new representation', async () => {
    const caller = fixture(), current = caller.current('concept Store {}');
    caller.materialize((await caller.output.plan({ operation: 'create', current }, caller.snapshot)).value!); caller.remove('docs/Store.md');
    expect((await caller.output.plan({ operation: 'create', current }, caller.snapshot)).problems.map(problem => problem.code)).toContain('output-conflict');
  });
  it('rejects unsupported private state versions', async () => {
    const caller = fixture(), current = caller.current('concept Store {}');
    caller.materialize((await caller.output.plan({ operation: 'create', current }, caller.snapshot)).value!);
    const state = caller.snapshot.files.find(item => item.path.startsWith('.expec/outputs/'))!, value = JSON.parse(Buffer.from(state.bytes).toString());
    value.format = 99; caller.edit(state.path, JSON.stringify(value));
    expect((await caller.output.plan({ operation: 'create', current }, caller.snapshot)).problems.map(problem => problem.code)).toContain('invalid-output-state');
  });
  it('rewrites an owned incoming link in the same rename plan', async () => {
    const caller = fixture(), first = caller.current('concept Store {}\nconcept Launcher { depends on Store }');
    caller.materialize((await caller.output.plan({ operation: 'create', current: first }, caller.snapshot)).value!);
    const store = first.baseline.elements.find(record => record.address.name === 'Store')!;
    const current = caller.current('concept Game {}\nconcept Launcher { depends on Game }', first, specification => [{ id: store.id, to: [...specification.inspection.query('concept')].find(item => item.name === 'Game')!.id }]);
    const result = await caller.output.plan({ operation: 'update', current, diff: caller.identity.compare(first.baseline, current).value! }, caller.snapshot);
    expect(result.problems).toEqual([]); expect(result.value?.changes.filter(change => change.kind === 'write').map(change => change.path)).toContain('docs/Launcher.md');
    caller.materialize(result.value!); expect((await caller.output.search(store.id)).incoming.uses).toHaveLength(1);
  });
  it('protects a reference to a descendant when its whole document is deleted', async () => {
    const caller = fixture(), current = caller.current('concept Store {\npublic save\ncapability save() returns Nothing\n}');
    caller.materialize((await caller.output.plan({ operation: 'create', current }, caller.snapshot)).value!);
    const save = current.baseline.elements.find(record => record.address.name === 'save')!.id;
    caller.edit('notes.md', `[save](docs/Store.md#expec-${Buffer.from(save).toString('hex')})`);
    const result = await caller.output.plan({ operation: 'delete', id: current.baseline.elements[0]!.id }, caller.snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems.some(problem => JSON.stringify(problem.at).includes('notes.md'))).toBe(true);
  });
  it('removes two mutually dependent owned documents in one coherent plan', async () => {
    const caller = fixture(), first = caller.current('concept A { depends on B }\nconcept B { depends on A }');
    caller.materialize((await caller.output.plan({ operation: 'create', current: first }, caller.snapshot)).value!);
    const current = caller.current('', first, () => first.baseline.elements.map(record => ({ retire: record.id })));
    const result = await caller.output.plan({ operation: 'update', current, diff: caller.identity.compare(first.baseline, current).value! }, caller.snapshot);
    expect(result.problems).toEqual([]); expect(result.value?.changes.filter(change => change.kind === 'remove').map(change => change.path).sort()).toEqual(['docs/A.md', 'docs/B.md']);
  });
  it('keeps later reads independent from caller mutation of earlier bytes', async () => {
    const caller = fixture(), current = caller.current('concept Store {}');
    caller.materialize((await caller.output.plan({ operation: 'create', current }, caller.snapshot)).value!);
    const id = current.baseline.elements[0]!.id, first = await caller.output.read(id), original = Buffer.from(first.artifacts[0]!.file.bytes);
    first.artifacts[0]!.file.bytes.fill(0);
    expect(Buffer.from((await caller.output.read(id)).artifacts[0]!.file.bytes)).toEqual(original);
  });
  it('rejects a contradictory diff without rewriting owned files', async () => {
    const caller = fixture(), current = caller.current('concept Store {}'), diff = caller.identity.compare(undefined, current).value!;
    const result = await caller.output.plan({ operation: 'update', current, diff: { ...diff, changes: diff.changes.map(change => ({ ...change, kinds: ['remove'] })) } }, caller.snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems[0]!.code).toBe('inconsistent-diff');
  });
  it('encodes opaque identities without allowing marker injection', async () => {
    const caller = fixture(), basic = caller.current('concept Store {}');
    const identity = new SpecificationIdentity(() => 'subject-->[escape]☃'), current = identity.associate(basic.specification).value!;
    caller.materialize((await caller.output.plan({ operation: 'create', current }, caller.snapshot)).value!);
    const result = await caller.output.search(current.baseline.elements[0]!.id);
    expect(result.problems).toEqual([]); expect(result.definitions).toHaveLength(1); expect(result.incoming.coverage.complete).toBe(true);
  });
  it('reports an excluded destination at planning rather than reading during registration', async () => {
    const caller = fixture(), current = caller.current('concept Store {}');
    const result = await caller.output.plan({ operation: 'create', current }, { ...caller.snapshot, excludeNames: ['docs'] });
    expect(result.value).toBeUndefined(); expect(result.problems[0]!.code).toBe('output-conflict');
  });
  it('leaves an unknown identifier explicitly unmapped', async () => {
    const caller = fixture();
    expect((await caller.output.read('unknown')).problems[0]!.code).toBe('output-not-found');
    expect((await caller.output.plan({ operation: 'delete', id: 'unknown' }, caller.snapshot)).problems[0]!.code).toBe('output-not-found');
  });
  it('rejects changed state records that assign two definitions to one identity', async () => {
    const caller = fixture(), current = caller.current('concept Store {}');
    caller.materialize((await caller.output.plan({ operation: 'create', current }, caller.snapshot)).value!);
    const state = caller.snapshot.files.find(item => item.path.startsWith('.expec/outputs/'))!, value = JSON.parse(Buffer.from(state.bytes).toString());
    value.documents[0].subjects.push(value.documents[0].subjects[0]); caller.edit(state.path, JSON.stringify(value));
    expect((await caller.output.plan({ operation: 'create', current }, caller.snapshot)).problems[0]!.code).toBe('invalid-output-state');
  });
  it('does not interpret a different stored render format as empty output', async () => {
    const caller = fixture(), current = caller.current('concept Store {}');
    caller.materialize((await caller.output.plan({ operation: 'create', current }, caller.snapshot)).value!);
    const state = caller.snapshot.files.find(item => item.path.startsWith('.expec/outputs/'))!, value = JSON.parse(Buffer.from(state.bytes).toString());
    value.renderFormat = 2; caller.edit(state.path, JSON.stringify(value));
    expect((await caller.output.plan({ operation: 'create', current }, caller.snapshot)).problems[0]!.code).toBe('output-options-changed');
  });
});

describe('structural document scope', () => {
  it('ignores another registered instance rather than declaring its document malformed', async () => {
    const caller = fixture('structure-list'), current = caller.current('concept Store {}');
    caller.materialize((await caller.output.plan({ operation: 'create', current }, caller.snapshot)).value!);
    caller.edit('another.structure.json', JSON.stringify({ format: 'expec-structure-1', outputId: 'other-output', declaration: { kind: 'concept', name: 'Other', references: [], members: [] } }));
    const result = await caller.output.search(current.baseline.elements[0]!.id);
    expect(result.problems).toEqual([]); expect(result.incoming.coverage.complete).toBe(true);
  });
  it('resolves structural path references from the project root', async () => {
    const caller = fixture('structure-list'), current = caller.current('concept Store {}');
    caller.materialize((await caller.output.plan({ operation: 'create', current }, caller.snapshot)).value!);
    caller.edit('notes/caller.structure.json', JSON.stringify({ format: 'expec-structure-1', outputId: 'structure-list', declaration: { kind: 'component', name: 'Caller', references: [{ role: 'use', path: 'docs/Store.structure.json' }], members: [] } }));
    const result = await caller.output.search(current.baseline.elements[0]!.id);
    expect(result.incoming.uses).toHaveLength(1); expect(result.incoming.coverage.complete).toBe(true);
  });
  it('distinguishes two project-only consumers in one JSON document', async () => {
    const caller = fixture('structure-list'), current = caller.current('concept Store {}');
    caller.materialize((await caller.output.plan({ operation: 'create', current }, caller.snapshot)).value!);
    const id = current.baseline.elements[0]!.id;
    caller.edit('notes/callers.structure.json', JSON.stringify({ format: 'expec-structure-1', outputId: 'structure-list', declaration: { kind: 'group', name: 'Callers', references: [], members: ['First', 'Second'].map(name => ({ kind: 'component', name, members: [], references: [{ role: 'use', specId: id }] })) } }));
    const result = await caller.output.search(id);
    expect(result.incoming.uses.map(use => use.target.id)).toEqual(['notes/callers.structure.json#/declaration/members/0', 'notes/callers.structure.json#/declaration/members/1']);
  });
  it('keeps an unmodeled nested consumer distinct from its specified parent', async () => {
    const caller = fixture('structure-list'), current = caller.current('concept Store {}\nconcept Group {}');
    caller.materialize((await caller.output.plan({ operation: 'create', current }, caller.snapshot)).value!);
    const store = current.baseline.elements.find(record => record.address.name === 'Store')!.id, group = current.baseline.elements.find(record => record.address.name === 'Group')!.id;
    caller.edit('docs/Group.structure.json', JSON.stringify({ format: 'expec-structure-1', outputId: 'structure-list', declaration: {
      specId: group, kind: 'component', name: 'Group', references: [], members: [{ kind: 'component', name: 'Unmodeled', members: [], references: [{ role: 'use', specId: store }] }],
    } }));
    const result = await caller.output.search(store);
    expect(result.incoming.uses.map(use => use.target)).toEqual([{ kind: 'project', id: 'docs/Group.structure.json#/declaration/members/0' }]);
    expect((await caller.output.search(group)).outgoing.uses).toHaveLength(1);
  });
});
