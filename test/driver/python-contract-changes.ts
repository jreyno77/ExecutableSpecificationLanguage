import { FileProjectWriter, type ProjectSnapshot } from '../../src/index.js';
import { PythonPreservationDriver } from './python-preservation.js';

export class PythonContractChangesDriver extends PythonPreservationDriver {
  readonly classes = new Map<string, string>();
  files: ProjectSnapshot['files'] = [];
  caller = '';
  override async generate(): Promise<void> {
    await super.generate();
    for (const item of this.current.specification.inspection.query('class')) if (!this.classes.has(item.name)) this.classes.set(item.name, this.current.id(item.id));
  }
  async insert(): Promise<void> {
    const opened = this.outputs.open('python', { module: 'store.contracts' }, this.context, new FileProjectWriter(this.context));
    this.written = opened.value ? await opened.value.insert(this.diff, this.current) : { problems: opened.problems };
  }
  skipOutput(): void {
    const diff = this.identity.compare(this.current.baseline, this.current);
    if (!diff.value) throw Error(JSON.stringify(diff)); this.diff = diff.value;
  }
  async remove(id: string): Promise<void> {
    const opened = this.outputs.open('python', { module: 'store.contracts' }, this.context, new FileProjectWriter(this.context));
    this.written = opened.value ? await opened.value.delete(id) : { problems: opened.problems };
  }
  renameClass(from: string, to: string, text: string): void {
    const before = this.current.baseline, specification = this.compile(text);
    const next = [...specification.inspection.query('class')].find(item => item.name === to);
    if (!next) throw Error('The named destination class is absent.');
    const identified = this.identity.associate(specification, before, [{ id: this.classes.get(from)!, to: next.id }]);
    if (!identified.value) throw Error(JSON.stringify(identified)); this.current = identified.value;
    this.classes.set(to, this.classes.get(from)!);
    const diff = this.identity.compare(before, this.current);
    if (!diff.value) throw Error(JSON.stringify(diff)); this.diff = diff.value;
  }
  async addAliasedCaller(name: string, alias: string): Promise<void> {
    this.caller = '# StoreGame in this comment stays unchanged.\nfrom store.contracts import ' + name + ' as ' + alias
      + '\ndef launch(title: str) -> None:\n    game = ' + alias + '()\n    game.save(title)\n    print(game.saved)\n';
    await this.file('src/launcher.py', this.caller);
  }
  async addMemberCaller(name: string, member: string): Promise<void> {
    await this.file('src/launcher.py', 'from store.contracts import ' + name + '\ncallback = ' + name + '.' + member + '\n');
  }
  async addNeighbor(note: string): Promise<void> {
    const path = 'src/store/contracts.py';
    await this.file(path, await this.text(path) + '\ndef neighbor():\n    # ' + note + '\n    return "human code"\n');
  }
  async rememberFiles(): Promise<void> { this.files = structuredClone((await this.context.readSnapshot()).files); }
}
