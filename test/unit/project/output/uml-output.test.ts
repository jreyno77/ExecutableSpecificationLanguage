import { describe, expect, it, vi } from 'vitest';
import { D2 } from '@d2lang/d2';
import { createHash } from 'node:crypto';
import { Compiler, SpecificationIdentity, umlOutput, type IdentifiedSpecification, type OutputAdapter, type OutputPlan, type ProjectSnapshot, type SpecDiff } from '../../../../src/index.js';

class DiagramPlan {
  readonly output: OutputAdapter;
  private serial = 0;
  readonly identity = new SpecificationIdentity(() => 'unit-' + ++this.serial);
  current!: IdentifiedSpecification;
  diff!: SpecDiff;
  readonly files = new Map<string, Uint8Array>();
  constructor(views = ['structure']) { this.output = umlOutput.open({ directory: 'design', views }); }
  specify(text: string, retire: string[] = []): void {
    const read = new Compiler().compile({ locator: 'game', source: { sourceId: 'game.expec', text }, dependencies: { modules: [], packages: [] } });
    if (!read.value) throw Error(JSON.stringify(read));
    const next = this.identity.associate(read.value, this.current?.baseline, retire.map(name => ({ retire: this.id(name) })));
    if (!next.value) throw Error(JSON.stringify(next)); this.diff = this.identity.compare(this.current?.baseline, next.value).value!; this.current = next.value;
  }
  id(name: string): string { const record = this.current.baseline.elements.find(record => record.address.name === name); if (!record) throw Error(name); return record.id; }
  snapshot(): ProjectSnapshot { return { root: { path: '/captured-project', identity: 'captured' }, complete: true, problems: [], excluded: [], excludeNames: [],
    files: [...this.files].map(([path, bytes]) => ({ path, bytes, version: createHash('sha256').update(bytes).digest('hex') })) }; }
  text(path = 'design/structure.d2'): string { return Buffer.from(this.files.get(path)!).toString(); }
  write(path: string, text: string): void { this.files.set(path, Buffer.from(text)); }
  apply(plan: OutputPlan): void { for (const change of plan.changes) { if (change.kind === 'write') this.files.set(change.path, change.bytes); else if (change.kind === 'remove') this.files.delete(change.path); else throw Error('Unexpected diagram move'); } }
  async create(): Promise<void> { const result = await this.output.plan({ operation: 'create', current: this.current }, this.snapshot()); expect(result.problems).toEqual([]); this.apply(result.value!); }
  async change(operation: 'insert' | 'update') { return this.output.plan({ operation, current: this.current, diff: this.diff }, this.snapshot()); }
}

describe('diagram planning boundaries', { timeout: 30_000 }, () => {
  it('inserts the fields of a genuinely new top-level record with that record', async () => {
    const plan = new DiagramPlan(); plan.specify('concept Store {}'); await plan.create();
    plan.specify('concept Store {}\ntype Book { title: Text }');
    const result = await plan.change('insert'); expect(result.problems).toEqual([]); expect(result.value?.artifacts.some(artifact => artifact.specId === plan.id('title'))).toBe(true);
  });
  it('requires update when adding a field to an already rendered record', async () => {
    const plan = new DiagramPlan(); plan.specify('type Book {}'); await plan.create(); plan.specify('type Book { title: Text }');
    expect((await plan.change('insert')).problems.map(problem => problem.code)).toContain('not-addition-only');
  });
  it('does not conceal a skipped contract update behind a later empty host diff', async () => {
    const plan = new DiagramPlan(); plan.specify('concept Store {}'); await plan.create();
    plan.specify('concept Store { public save\ncapability save() returns Nothing }');
    plan.diff = plan.identity.compare(plan.current.baseline, plan.current).value!;
    expect((await plan.change('insert')).problems.map(problem => problem.code)).toContain('not-addition-only');
  });
  it('does not adopt copied generated regions after losing ownership state', async () => {
    const plan = new DiagramPlan(); plan.specify('concept Store {}'); await plan.create(); plan.files.delete('.expec/outputs/756d6c.json');
    const result = await plan.change('update'); expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('output-conflict');
  });
  it('rejects duplicate state keys rather than accepting the final JSON value', async () => {
    const plan = new DiagramPlan(); plan.specify('concept Store {}'); await plan.create();
    const path = '.expec/outputs/756d6c.json'; plan.write(path, plan.text(path).replace('{', '{"format":1,'));
    expect((await plan.change('update')).problems.map(problem => problem.code)).toContain('invalid-output-state');
  });
  it('preserves notes when an update removes one complete interaction', async () => {
    const plan = new DiagramPlan(['interactions']), service = 'concept Service { public ping\ncapability ping() returns Nothing }\n';
    const interaction = (title: string) => 'interaction "' + title + '"() { participant a: Service\nparticipant b: Service\nmessage a -> b.ping() }';
    plan.specify(service + interaction('first') + '\n' + interaction('second')); await plan.create();
    const path = [...plan.files.keys()].find(path => path.endsWith('.d2') && plan.text(path).includes('first'))!;
    plan.write(path, plan.text(path) + '\n# Keep this operational note.\n'); plan.specify(service + interaction('second'), ['first']);
    const result = await plan.change('update'); expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('handwritten-document-content');
  });
  it('removes an owned outgoing dependency with its deleted structural subject', async () => {
    const plan = new DiagramPlan(); plan.specify('concept Storage {}\nconcept Store { depends on Storage }'); await plan.create();
    const result = await plan.output.plan({ operation: 'delete', id: plan.id('Store') }, plan.snapshot()); expect(result.problems).toEqual([]); plan.apply(result.value!);
    const search = await plan.output.search(plan.id('Storage'), plan.snapshot()); expect(search.definitions).toHaveLength(1); expect(search.incoming.uses).toEqual([]);
  });
  it('retains the legend and notes after deleting the final structural declaration', async () => {
    const plan = new DiagramPlan(); plan.specify('concept Store {}'); await plan.create(); plan.write('design/structure.d2', plan.text() + '\n# Design notes.\n');
    const result = await plan.output.plan({ operation: 'delete', id: plan.id('Store') }, plan.snapshot()); expect(result.problems).toEqual([]); plan.apply(result.value!);
    expect(plan.text()).toContain('Declared contracts:'); expect(plan.text()).toContain('# Design notes.'); expect((await plan.output.search(plan.id('Store'), plan.snapshot())).definitions).toEqual([]);
  });
  it('documents a local type by its enclosing qualified name and local meaning', async () => {
    const plan = new DiagramPlan(); plan.specify('concept Store { local type Cache { size: Number } }'); await plan.create();
    expect(plan.text()).toContain('Store.Cache'); expect(plan.text()).toContain('local');
  });
  it('gives a represented parameter a containing-signature locator rather than a fictitious token range', async () => {
    const plan = new DiagramPlan(); plan.specify('concept Store { public save\ncapability save(title: Text) returns Nothing }');
    const result = await plan.output.plan({ operation: 'create', current: plan.current }, plan.snapshot()); expect(result.problems).toEqual([]);
    expect(result.value?.artifacts.filter(artifact => artifact.specId === plan.id('title')).map(artifact => artifact.locator.format)).toContain('d2-signature');
  });
  it('reports native rendering failure without yielding a source-only plan', async () => {
    const plan = new DiagramPlan(); plan.specify('concept Store {}');
    const render = vi.spyOn(D2.prototype, 'render').mockRejectedValue(new Error('Native renderer failed'));
    try { const result = await plan.output.plan({ operation: 'create', current: plan.current }, plan.snapshot()); expect(result.value === undefined).toBe(true); expect(result.problems.map(problem => problem.code)).toContain('native-render-failed'); }
    finally { render.mockRestore(); }
  });
  it('does not treat an empty native rendering as a delivered SVG', async () => {
    const plan = new DiagramPlan(); plan.specify('concept Store {}');
    const render = vi.spyOn(D2.prototype, 'render').mockResolvedValue('');
    try { const result = await plan.output.plan({ operation: 'create', current: plan.current }, plan.snapshot()); expect(result.value === undefined).toBe(true); expect(result.problems.map(problem => problem.code)).toContain('native-render-failed'); }
    finally { render.mockRestore(); }
  });
  it('refuses a handwritten override before deleting the generated subject it changes', async () => {
    const plan = new DiagramPlan(); plan.specify('concept Store {}'); await plan.create();
    const definition = (await plan.output.search(plan.id('Store'), plan.snapshot())).definitions[0]!;
    const key = (definition.value as { key: string }).key; plan.write('design/structure.d2', plan.text() + '\n' + key + ': Different\n');
    const result = await plan.output.plan({ operation: 'delete', id: plan.id('Store') }, plan.snapshot());
    expect(result.value === undefined).toBe(true); expect(result.problems.map(problem => problem.code)).toContain('handwritten-diagram-conflict');
  });
  it('removes owned promise annotations with their deleted contract', async () => {
    const plan = new DiagramPlan(); plan.specify('concept Store { public save\ncapability save() returns Nothing { promises "Keeps player data" } }'); await plan.create();
    const result = await plan.output.plan({ operation: 'delete', id: plan.id('Store') }, plan.snapshot()); expect(result.problems).toEqual([]); plan.apply(result.value!);
    expect(plan.text()).not.toContain('Keeps player data'); expect(plan.text()).toContain('Declared contracts:');
  });
});
