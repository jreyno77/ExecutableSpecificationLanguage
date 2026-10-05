import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { FileProjectWriter, type Check, type OutputPlan } from '../../src/index.js';
import { PythonNativeLifetimeDriver } from './python-native-lifetime.js';

/** Real excluded files and native evidence around the ordinary output/writer boundary. */
export class PythonCaptureBoundariesDriver extends PythonNativeLifetimeDriver {
  refusedPlan!: Check<OutputPlan>;
  async planClassRename(): Promise<void> {
    await fs.unlink(join(this.root, 'src/store.py'));
    this.source('class StoreGame { public save\ncapability save(title: Text) returns Nothing }');
    await this.generate();
    if (this.written.problems.length || !this.written.artifacts) throw Error(JSON.stringify(this.written));
    const path = 'src/store/contracts.py';
    await this.file(path, (await this.text(path)).replace('from __future__ import annotations\n',
      'from __future__ import annotations\nfrom catalog import Book\n'));
    const before = this.current.baseline;
    const specification = this.compile('class Shop { public save\ncapability save(title: Text) returns Nothing }');
    const old = [...this.current.specification.inspection.query('class')][0]!, next = [...specification.inspection.query('class')][0]!;
    const identified = this.identity.associate(specification, before, [{ id: this.current.id(old.id), to: next.id }]);
    if (!identified.value) throw Error(JSON.stringify(identified)); this.current = identified.value;
    const diff = this.identity.compare(before, this.current); if (!diff.value) throw Error(JSON.stringify(diff));
    this.before = await this.context.readSnapshot();
    const opened = this.outputs.open('python', { module: 'store.contracts' }, this.context, new FileProjectWriter(this.context));
    if (!opened.value) throw Error(JSON.stringify(opened));
    const result = await opened.value.plan({ operation: 'update', diff: diff.value, current: this.current }, this.before);
    if (!result.value) throw Error(JSON.stringify(result)); this.plan = result.value;
  }
  async buildWithExcludedSource(): Promise<void> {
    this.source('class StoreGame {}'); this.before = await this.context.readSnapshot();
    const opened = this.outputs.open('python', { module: 'store.contracts' }, this.context, new FileProjectWriter(this.context));
    if (!opened.value) throw Error(JSON.stringify(opened));
    this.refusedPlan = await opened.value.plan({ operation: 'create', current: this.current }, this.before);
    this.written = await opened.value.create(this.current);
  }
}
