import { SpecificationIdentity, type SpecDiff, type IdentityDecision, type Check, type OutputPlan } from '../../src/index.js';
import { JavaOutputDriver } from './java-output.js';

/** Explicit authored correspondence and native code; all edits go through the public Java output. */
export class JavaPreservationDriver extends JavaOutputDriver {
  private next = 0;
  private readonly identity = new SpecificationIdentity(() => 'java-preserved-' + ++this.next);
  diff!: SpecDiff;
  plan!: Check<OutputPlan>;
  private id(name: string): string {
    const records = this.current.baseline.elements.filter(record => record.address.name === name);
    if (records.length !== 1) throw new Error('Name must identify exactly one authored fixture declaration: ' + name);
    return records[0]!.id;
  }
  mapOwner(file: string, type: string): void {
    this.mapType(this.id(type.split('.').at(-1)!), file, type);
    const current = this.identity.withArtifacts(this.current, this.associations);
    if (!current.value) throw new Error(JSON.stringify(current)); this.current = current.value;
  }
  mapStore(file: string, type: string, method: string, parameters: string[]): void {
    this.mapType(this.id(type.split('.').at(-1)!), file, type); this.mapMethod(this.id(method), file, type, method, parameters);
    const current = this.identity.withArtifacts(this.current, this.associations);
    if (!current.value) throw new Error(JSON.stringify(current)); this.current = current.value;
  }
  mapStoreGame(file: string): void {
    this.mapType(this.id('StoreGame'), file, 'store.StoreGame');
    for (const [authored, native, parameters] of [
      ['startup', 'startup', ['store.SystemConfig']], ['save', 'save', ['store.PlayerStateSnapshot']],
      ['delete', 'delete', []], ['new', 'newGame', []], ['shutDown', 'shutDown', []],
    ] as const) this.mapMethod(this.id(authored), file, 'store.StoreGame', native, [...parameters]);
    const current = this.identity.withArtifacts(this.current, this.associations);
    if (!current.value) throw new Error(JSON.stringify(current)); this.current = current.value;
  }
  confirm(): void {
    if (!this.written.artifacts) return;
    const current = this.identity.withArtifacts(this.current, this.written.artifacts);
    if (!current.value) throw new Error(JSON.stringify(current)); this.current = current.value;
  }
  revise(text: string, rename?: [string, string], retire: string[] = []): void {
    const before = this.current, oldId = rename ? this.id(rename[0]) : undefined, retired = retire.map(name => ({ retire: this.id(name) }));
    super.source(text);
    const decisions: IdentityDecision[] = rename ? [{ id: oldId!, to: this.current.node(this.id(rename[1])) }] : [];
    const after = this.identity.associate(this.current.specification, before.baseline, [...decisions, ...retired]);
    if (!after.value) throw new Error(JSON.stringify(after));
    const diff = this.identity.compare(before.baseline, after.value);
    if (!diff.value) throw new Error(JSON.stringify(diff)); this.current = after.value; this.diff = diff.value;
  }
  async planUpdate(): Promise<void> { await this.capture(); this.plan = await this.output().plan({ operation: 'update', diff: this.diff, current: this.current }, this.snapshot); }
  async remove(name: string): Promise<void> { this.written = await this.output().delete(this.id(name)); await this.capture(); }
  async update(): Promise<void> {
    this.written = await this.output().update(this.diff, this.current); this.confirm(); await this.capture();
  }
}
