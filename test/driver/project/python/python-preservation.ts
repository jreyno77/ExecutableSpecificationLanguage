import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { FileProjectWriter, type SpecDiff } from '../../../../src/index.js';
import type { Diagnostic } from '../../../../src/compiler/checking.js';
import { PythonProjectDriver } from './python-project.js';

/** Native implementation setup surrounds actual identity transitions and preserving output calls. */
export class PythonPreservationDriver extends PythonProjectDriver {
  diff!: SpecDiff;
  readonly captureProblems: Diagnostic[] = [];
  private module = 'store.contracts';
  override async installFixture(): Promise<void> {
    await super.installFixture(); const actual = this.context;
    this.context = { root: actual.root, readSnapshot: async () => { const snapshot = await actual.readSnapshot(); this.captureProblems.push(...snapshot.problems); return snapshot; } };
  }
  async generate(options: Record<string, unknown> = {}): Promise<void> { await this.build(options); this.remember(); }
  private remember(): void {
    if (!this.written.artifacts) return;
    const identified = this.identity.withArtifacts(this.current, this.written.artifacts);
    if (!identified.value) throw new Error(JSON.stringify(identified)); this.current = identified.value;
  }
  change(text: string): void {
    this.sourceText = text;
    const before = this.current.baseline, identified = this.identity.associate(this.compile(text), before);
    if (!identified.value) throw new Error(JSON.stringify(identified)); this.current = identified.value;
    const diff = this.identity.compare(before, this.current); if (!diff.value) throw new Error(JSON.stringify(diff)); this.diff = diff.value;
  }
  renameCapability(from: string, to: string, text: string): void {
    const before = this.current.baseline, specification = this.compile(text);
    const prior = [...this.current.specification.inspection.query('capability')].find(item => item.name === from);
    const next = [...specification.inspection.query('capability')].find(item => item.name === to);
    if (!prior || !next) throw new Error('Expected the explicitly named capability in both fixture versions.');
    const identified = this.identity.associate(specification, before, [{ id: this.current.id(prior.id), to: next.id }]);
    if (!identified.value) throw new Error(JSON.stringify(identified)); this.current = identified.value;
    const diff = this.identity.compare(before, this.current); if (!diff.value) throw new Error(JSON.stringify(diff)); this.diff = diff.value;
  }
  retireCapability(name: string, text: string): void {
    const before = this.current.baseline, prior = [...this.current.specification.inspection.query('capability')].find(item => item.name === name);
    if (!prior) throw new Error('Expected the explicitly named capability to retire.');
    const identified = this.identity.associate(this.compile(text), before, [{ retire: this.current.id(prior.id) }]);
    if (!identified.value) throw new Error(JSON.stringify(identified)); this.current = identified.value;
    const diff = this.identity.compare(before, this.current); if (!diff.value) throw new Error(JSON.stringify(diff)); this.diff = diff.value;
  }
  async update(): Promise<void> {
    const opened = this.outputs.open('python', { module: this.module }, this.context, new FileProjectWriter(this.context));
    this.written = opened.value ? await opened.value.update(this.diff, this.current) : { problems: opened.problems }; this.remember();
  }
  relocate(module: string): void {
    this.module = module;
    const diff = this.identity.compare(this.current.baseline, this.current);
    if (!diff.value) throw new Error(JSON.stringify(diff)); this.diff = diff.value;
  }
  async implementSave(body: string): Promise<void> {
    const path = 'src/store/contracts.py', text = await this.text(path), stub = 'raise NotImplementedError("Not implemented: StoreGame.save")';
    if (text.split(stub).length !== 2) throw new Error('Expected one generated save stub for this fixture.');
    await this.file(path, text.replace(stub, body));
  }
  async implementTitleDefault(value: string): Promise<void> {
    const path = 'src/store/contracts.py', text = await this.text(path);
    await this.file(path, text.replace('class StoreGame:', 'def choose_title() -> str:\n    return ' + JSON.stringify(value) + '\n\nclass StoreGame:')
      .replace('title: str | Absent = Absent.value', 'title: str | Absent = choose_title()'));
  }
  associateStoreFile(file: string): void {
    const inspection = this.current.specification.inspection, store = [...inspection.query('class')].find(item => item.name === 'StoreGame');
    if (!store) throw new Error('The fixture needs its explicit StoreGame contract.');
    const owner = [{ kind: 'class', name: 'StoreGame' }];
    const artifacts = [{ specId: this.current.id(store.id), locator: { outputId: 'python', format: 'python-symbol-1', value: { file, declaration: owner } } }];
    for (const method of store.members) if (method.kind === 'capability') {
      const declaration = [...owner, { kind: 'method', name: method.name }];
      artifacts.push({ specId: this.current.id(method.id), locator: { outputId: 'python', format: 'python-symbol-1', value: { file, declaration } } });
      for (const parameter of method.parameters) artifacts.push({ specId: this.current.id(parameter.id), locator: {
        outputId: 'python', format: 'python-symbol-1', value: { file, declaration: [...declaration, { kind: 'parameter', name: parameter.name }] } } });
    }
    const identified = this.identity.withArtifacts(this.current, artifacts);
    if (!identified.value) throw new Error(JSON.stringify(identified)); this.current = identified.value;
  }
  text(path: string): Promise<string> { return fs.readFile(join(this.root, path), 'utf8'); }
  async run(text: string): Promise<void> { await this.file('consumer.py', text); await this.runConsumer(); }
}
