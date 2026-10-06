import { reconcileRelationships, type ProjectRead, type Reconciliation } from '../../../../src/index.js';
import { PythonPreservationDriver } from './python-preservation.js';

/** Concrete authored projects around the real native query and identity APIs. */
export class PythonQueryDriver extends PythonPreservationDriver {
  earlierRead?: ProjectRead;
  comparison?: Reconciliation;
  private reader?: ReturnType<PythonQueryDriver['query']>;
  override async read(id: string): Promise<void> {
    await this.capture(); this.reader ??= this.query();
    this.readResult = await this.reader.read(id, this.snapshot);
  }
  async replace(file: string, before: string, after: string): Promise<void> {
    const original = await this.text(file);
    if (original.split(before).length !== 2) throw Error('Expected one authored fragment to edit.');
    await this.file(file, original.replace(before, after));
  }
  async typedConsumers(count: number): Promise<void> {
    await this.file('src/store.py', 'class StoreGame:\n    def save(self, title: str) -> None:\n        self.title = title\nclass Other:\n    def save(self, title: str) -> None:\n        self.title = title\n');
    for (let index = 0; index < count; index++) await this.file('src/caller' + index + '.py',
      'from store import StoreGame, Other\ndef launch(game: StoreGame, other: Other) -> None:\n    game.save("Dune")\n    other.save("Other")\n');
    await this.file('src/alias.py', 'from store import StoreGame as Game\ndef launch(game: Game) -> None:\n    game.save("Dune")\n');
    await this.file('src/public_api.py', 'from store import StoreGame\n');
    await this.file('src/reexport_caller.py', 'from public_api import StoreGame\ndef launch(game: StoreGame) -> None:\n    game.save("Dune")\n');
    this.map('StoreGame.save', 'src/store.py', [{ kind: 'class', name: 'StoreGame' }, { kind: 'method', name: 'save' }]);
  }
  id(name: string): string {
    const found = this.current.baseline.elements.filter(item => item.address.name === name);
    if (found.length !== 1) throw Error('Expected one authored identity: ' + name);
    return found[0]!.id;
  }
  compare(expected: string[]): void {
    const result = reconcileRelationships(this.current, expected.map(name => this.id(name)), this.searchResult.outgoing);
    if (!result.value) throw Error(JSON.stringify(result)); this.comparison = result.value;
  }
  site(at: { value: unknown }): { file: string; token: string; line: number; utf16Column: number; statement: string } {
    const value = at.value as { file: string; start: number; end: number };
    const file = this.snapshot.files.find(file => file.path === value.file);
    if (!file) throw Error('The observed native site must refer to an actual captured file.');
    const source = Buffer.from(file.bytes).toString('utf8'), lines = source.slice(0, value.start).split(/\r?\n/);
    return { file: value.file, token: source.slice(value.start, value.end), line: lines.length,
      utf16Column: lines.at(-1)!.length + 1, statement: source.split(/\r?\n/)[lines.length - 1]!.trim() };
  }
}
