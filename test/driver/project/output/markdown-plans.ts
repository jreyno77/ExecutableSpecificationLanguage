import { createHash } from 'node:crypto';
import { Compiler, Outputs, SpecificationIdentity, markdownOutput, type IdentifiedSpecification, type OutputPlan,
  type ProjectSnapshot, type SpecDiff } from '../../../../src/index.js';

const file = (path: string, bytes: Uint8Array) => ({ path, bytes, version: createHash('sha256').update(bytes).digest('hex') });
/** A supplied-snapshot consumer of pure plans; writer behavior is covered by the real project driver. */
export class MarkdownPlans {
  private count = 0;
  readonly identity = new SpecificationIdentity(() => 'plan-' + ++this.count);
  snapshot: ProjectSnapshot = { root: { path: '/fixture', identity: 'fixture' }, complete: true, files: [], excludeNames: ['.git', 'node_modules'], excluded: [], problems: [] };
  readonly registry = new Outputs();
  readonly output;
  current!: IdentifiedSpecification;
  diff!: SpecDiff;
  constructor(directory = 'docs') {
    this.registry.register(markdownOutput);
    this.output = this.registry.open('markdown', { directory }, { root: this.snapshot.root, readSnapshot: async () => this.snapshot },
      { apply: async () => { throw new Error('Pure plan example must not invoke a writer'); } }).value!;
  }
  source(text: string, retire: string[] = []): void {
    const checked = new Compiler().compile({ locator: 'fixture.expec', source: { sourceId: 'fixture.expec', text }, dependencies: { modules: [], packages: [] } });
    if (!checked.value) throw new Error('Invalid unit source: ' + JSON.stringify(checked));
    const prior = this.current, result = this.identity.associate(checked.value, prior?.baseline, retire.map(name => ({ retire: this.id(name) })));
    if (!result.value) throw new Error('Invalid unit identity: ' + JSON.stringify(result));
    this.current = result.value; this.diff = this.identity.compare(prior?.baseline, this.current).value!;
  }
  id(name: string): string { return this.current.baseline.elements.find(record => record.address.name === name)!.id; }
  plan(operation: 'create' | 'update' | 'insert' = 'create') {
    return this.output.plan(operation === 'create' ? { operation, current: this.current } : { operation, current: this.current, diff: this.diff }, this.snapshot);
  }
  async create(): Promise<OutputPlan> {
    const result = await this.plan();
    if (!result.value) throw new Error('Initial fixture plan failed: ' + JSON.stringify(result)); this.apply(result.value); return result.value;
  }
  apply(plan: OutputPlan): void {
    const files = new Map(this.snapshot.files.map(file => [file.path, file]));
    for (const change of plan.changes) {
      if (change.kind === 'remove') files.delete(change.path);
      else if (change.kind === 'write') files.set(change.path, file(change.path, change.bytes));
      else { const old = files.get(change.from)!; files.delete(change.from); files.set(change.to, file(change.to, change.bytes ?? old.bytes)); }
    }
    this.snapshot = { ...this.snapshot, files: [...files.values()] };
  }
  bytes(path: string): Uint8Array { return this.snapshot.files.find(file => file.path === path)!.bytes; }
  text(path: string): string { return Buffer.from(this.bytes(path)).toString('utf8'); }
  edit(path: string, text: string | Uint8Array): void {
    const bytes = typeof text === 'string' ? Buffer.from(text) : text;
    this.snapshot = { ...this.snapshot, files: [...this.snapshot.files.filter(file => file.path !== path), file(path, bytes)] };
  }
  remove(path: string): void { this.snapshot = { ...this.snapshot, files: this.snapshot.files.filter(file => file.path !== path) }; }
  statePath(): string { return '.expec/outputs/' + Buffer.from('markdown').toString('hex') + '.json'; }
}
