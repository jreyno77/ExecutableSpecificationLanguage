import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { FileProjectWriter, type SpecDiff } from '../../src/index.js';
import type { Diagnostic } from '../../src/checking.js';
import { PythonProjectDriver } from './python-project.js';

/** Native implementation setup surrounds actual identity transitions and preserving output calls. */
export class PythonPreservationDriver extends PythonProjectDriver {
  diff!: SpecDiff;
  readonly captureProblems: Diagnostic[] = [];
  override async installFixture(): Promise<void> {
    await super.installFixture(); const actual = this.context;
    this.context = { root: actual.root, readSnapshot: async () => { const snapshot = await actual.readSnapshot(); this.captureProblems.push(...snapshot.problems); return snapshot; } };
  }
  async generate(): Promise<void> { await this.build(); this.remember(); }
  private remember(): void {
    if (!this.written.artifacts) return;
    const identified = this.identity.withArtifacts(this.current, this.written.artifacts);
    if (!identified.value) throw new Error(JSON.stringify(identified)); this.current = identified.value;
  }
  change(text: string): void {
    const before = this.current.baseline, identified = this.identity.associate(this.compile(text), before);
    if (!identified.value) throw new Error(JSON.stringify(identified)); this.current = identified.value;
    const diff = this.identity.compare(before, this.current); if (!diff.value) throw new Error(JSON.stringify(diff)); this.diff = diff.value;
  }
  async update(): Promise<void> {
    const opened = this.outputs.open('python', { module: 'store.contracts' }, this.context, new FileProjectWriter(this.context));
    this.written = opened.value ? await opened.value.update(this.diff, this.current) : { problems: opened.problems }; this.remember();
  }
  async implementSave(body: string): Promise<void> {
    const path = 'src/store/contracts.py', text = await this.text(path), stub = 'raise NotImplementedError("Not implemented: StoreGame.save")';
    if (text.split(stub).length !== 2) throw new Error('Expected one generated save stub for this fixture.');
    await this.file(path, text.replace(stub, body));
  }
  text(path: string): Promise<string> { return fs.readFile(join(this.root, path), 'utf8'); }
  async run(text: string): Promise<void> { await this.file('consumer.py', text); await this.runConsumer(); }
}
