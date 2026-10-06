import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { FileProjectWriter, type IdentityBaseline, type IdentityDecision, type SpecDiff } from '../../../../src/index.js';
import { PythonAcceptanceDriver } from './python-acceptance.js';

export class PythonTestChangesDriver extends PythonAcceptanceDriver {
  description = '';
  before!: IdentityBaseline;
  difference!: SpecDiff;
  readonly identities = new Map<string, string>();
  group = '';
  files: { path: string; bytes: Buffer }[] = [];
  body = '';
  collected: string[] = [];
  outcomes: { name: string; phase: string; outcome: string }[] = [];
  private shared = false;
  override source(text: string): void { super.source(text); this.description = text; }
  override async generate(): Promise<void> { await super.generate(); this.rememberIdentity(); }
  private rememberIdentity(): void {
    if (!this.written.artifacts) return;
    const identified = this.identity.withArtifacts(this.current, this.written.artifacts);
    if (!identified.value) throw Error(JSON.stringify(identified)); this.current = identified.value; this.before = this.current.baseline;
    const inspection = this.current.specification.inspection;
    for (const item of [...inspection.query('example'), ...inspection.query('scenario')]) if (!this.identities.has(item.title.value)) this.identities.set(item.title.value, this.current.id(item.id));
    this.group = this.current.id([...inspection.query('examples')][0]!.id);
  }
  private change(text: string, rename?: { from: string; to: string }): void {
    const specification = this.compile(text), decisions: IdentityDecision[] = [];
    if (rename) {
      const next = [...specification.inspection.query('scenario')].find(item => item.title.value === rename.to);
      if (!next) throw Error('The renamed scenario is absent.');
      decisions.push({ id: this.identities.get(rename.from)!, to: next.id });
    }
    const identified = this.identity.associate(specification, this.current.baseline, decisions);
    if (!identified.value) throw Error(JSON.stringify(identified)); this.current = identified.value; this.description = text;
    const difference = this.identity.compare(this.before, this.current);
    if (!difference.value) throw Error(JSON.stringify(difference)); this.difference = difference.value;
  }
  add(text: string): void { const end = this.description.lastIndexOf('}'); this.change(this.description.slice(0, end) + '\n' + text + '\n' + this.description.slice(end)); }
  rename(from: string, to: string): void { this.change(this.description.replace('scenario ' + JSON.stringify(from), 'scenario ' + JSON.stringify(to)), { from, to }); }
  reviseSource(text: string): void { this.change(text); }
  async addNativeNeighbor(note: string): Promise<void> {
    const path = 'test/acceptance/test_shopping.py';
    await this.file(path, await this.text(path) + '\ndef neighbor():\n    # ' + note + '\n    return "human code"\n');
  }
  async revise(operation: 'insert' | 'update'): Promise<void> {
    const output = this.outputs.open('python-acceptance', { domain: 'shopping' }, this.context, new FileProjectWriter(this.context));
    this.written = output.value ? await output.value[operation](this.difference, this.current) : { problems: output.problems }; this.rememberIdentity();
  }
  async remove(id: string): Promise<void> {
    const output = this.outputs.open('python-acceptance', { domain: 'shopping' }, this.context, new FileProjectWriter(this.context));
    this.written = output.value ? await output.value.delete(id) : { problems: output.problems };
  }
  async rememberFiles(shared: boolean): Promise<void> {
    this.shared = shared;
    this.files = (await this.context.readSnapshot()).files.filter(file => !shared || /^(test\/(dsl|driver)\/|src\/)/.test(file.path))
      .map(file => ({ path: file.path, bytes: Buffer.from(file.bytes) }));
  }
  async actualFiles(): Promise<typeof this.files> {
    return this.shared ? Promise.all(this.files.map(async file => ({ path: file.path, bytes: await fs.readFile(join(this.root, file.path)) })))
      : (await this.context.readSnapshot()).files.map(file => ({ path: file.path, bytes: Buffer.from(file.bytes) }));
  }
  async text(path: string): Promise<string> { return fs.readFile(join(this.root, path), 'utf8'); }
  private nativeName(title: string): string {
    const value = this.current.baseline.artifacts.find(item => item.specId === this.identities.get(title) && item.locator.outputId === 'python-acceptance');
    if (!value) throw Error('No actual generated association for ' + title);
    return (value.locator.value as { declaration: { name: string }[] }).declaration.at(-1)!.name;
  }
  async addComment(title: string, comment: string): Promise<void> {
    const path = 'test/acceptance/test_shopping.py', text = await this.text(path), signature = new RegExp('(def ' + this.nativeName(title) + '\\([^\\n]*\\n)');
    if (!signature.test(text)) throw Error('The actual generated scenario is absent.');
    await this.file(path, text.replace(signature, '$1    # ' + comment + '\n'));
  }
  async addCaller(title: string): Promise<void> {
    const name = this.nativeName(title); await this.file('test/driver/unmodeled.py', 'from acceptance.test_shopping import ' + name + '\ndef rerun(receiver):\n    ' + name + '(receiver)\n');
  }
  async addUnresolvedCaller(title: string): Promise<void> {
    await this.file('test/driver/unmodeled.py', 'def rerun(receiver):\n    receiver.' + this.nativeName(title) + '()\n');
  }
  removeAcceptanceFile(): Promise<void> { return fs.unlink(join(this.root, 'test/acceptance/test_shopping.py')); }
  async driverBody(name: string): Promise<string> {
    const source = await this.text('test/driver/shopping_driver.py'), lines = source.split(/\r?\n/);
    const first = lines.findIndex(line => line.startsWith('    def ' + name + '('));
    if (first < 0) throw Error('Actual driver method is absent.');
    const next = lines.findIndex((line, index) => index > first && line.startsWith('    def '));
    return lines.slice(first + 1, next < 0 ? undefined : next).join('\n').trimEnd();
  }
  async runObservedTests(): Promise<void> {
    const sites = join(this.root, '.venv', ...(process.platform === 'win32' ? ['Lib', 'site-packages'] : ['lib', 'python3.12', 'site-packages']));
    this.runtime = await this.python(`import sys, os, json
from pathlib import Path
sys.path[:0] = sys.argv[1:4]
os.environ['PYTEST_DISABLE_PLUGIN_AUTOLOAD'] = '1'
os.environ.pop('PYTEST_ADDOPTS', None)
os.environ.pop('PYTEST_PLUGINS', None)
import pytest
observations = {'collected': [], 'outcomes': []}
class Observations:
    def pytest_collection_finish(self, session):
        observations['collected'] = [item.name for item in session.items]
    def pytest_runtest_logreport(self, report):
        observations['outcomes'].append({'name': report.nodeid.split('::')[-1], 'phase': report.when, 'outcome': report.outcome})
status = pytest.main(['-q', '-p', 'no:cacheprovider', '--rootdir', sys.argv[4], sys.argv[5]], plugins=[Observations()])
Path('native-observations.json').write_text(json.dumps(observations))
sys.exit(status)`, [sites, join(this.root, 'src'), join(this.root, 'test'), this.root, join(this.root, 'test/acceptance/test_shopping.py')]);
    const result = JSON.parse(await this.text('native-observations.json')) as { collected: string[]; outcomes: PythonTestChangesDriver['outcomes'] };
    this.collected = result.collected; this.outcomes = result.outcomes;
  }
}
