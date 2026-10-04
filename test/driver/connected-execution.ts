import { promises as fs } from 'node:fs';
import { ConnectedBuildDriver } from './connected-build.js';
export class ConnectedExecutionDriver extends ConnectedBuildDriver {
  private generated: Record<string, string> = {};
  async prepareShopping(): Promise<void> {
    await this.initialize(true); await this.nativeAcceptance();
    await this.write('spec/main.expec', `examples {
  setup bookIsAvailable(title: Text) returns Nothing
  setup startWithEmptyBasket() returns Nothing
  action addBook(title: Text) returns Nothing
  observation bookQuantity(title: Text) returns Number
  check expectBookQuantity(title: Text, expected: Number) {
    let actual = bookQuantity(title)
    assert actual == expected
  }
  scenario "a shopper can add an available book" {
    given bookIsAvailable("Dune")
    given startWithEmptyBasket()
    when addBook("Dune")
    then expectBookQuantity("Dune", 1)
  }
}`);
    const options: Record<string, unknown> = { domain: 'shopping', configFile: 'tsconfig.json' };
    this.manifest.outputs = [{ id: 'acceptance', options }]; await this.saveManifest();
    await this.run(['build', '--config', 'spec/expec.json', '--json'], '', undefined, 120_000);
    if (this.result.code) throw Error('Initial real generation failed: ' + this.result.stdout);
    for (const [resource, path] of [['shop', 'src/shop.ts'], ['http-shopping', 'test/driver/http-shopping.ts'], ['http-shopping-test', 'test/dsl/http-shopping-test.ts']])
      await this.write('project/' + path, await fs.readFile(new URL('../resources/scenario-execution/' + resource + '.mts', import.meta.url), 'utf8'));
    await this.write('project/shop-options.json', '{}');
    options.fixture = { outputId: 'acceptance', format: 'typescript-symbol-1', value: { file: 'test/dsl/http-shopping-test.ts', declaration: [{ kind: 'variable', name: 'test' }] } };
    await this.saveManifest(); await this.run(['build', '--config', 'spec/expec.json', '--json'], '', undefined, 120_000);
    if (this.result.code) throw Error('Real fixture connection failed: ' + this.result.stdout);
    this.generated = await this.capture(['node_modules']);
  }
  async restoreShopping(): Promise<void> {
    await this.restoreRunner();
    const current = await this.capture(['node_modules']);
    for (const path of Object.keys(current)) if (!(path in this.generated)) await fs.rm(this.path(path));
    for (const [path, data] of Object.entries(this.generated)) await this.write(path, Buffer.from(data, 'base64').toString('utf8'));
  }
  async options(value: object): Promise<void> { await this.write('project/shop-options.json', JSON.stringify(value)); }
  async edit(path: string, from: string, to: string): Promise<void> {
    const text = await fs.readFile(this.path(path), 'utf8'); if (!text.includes(from)) throw Error('Expected fixture text is absent.');
    await this.write(path, text.replace(from, to));
  }
  async unchanged(paths: string[]): Promise<boolean> { for (const path of paths) if ((await fs.readFile(this.path(path))).toString('base64') !== this.generated[path]) return false; return true; }
  async runnerUnavailable(): Promise<void> { await fs.rename(this.path('project/node_modules/vitest'), this.path('project/node_modules/vitest-not-selected')); }
  async restoreRunner(): Promise<void> { try { await fs.rename(this.path('project/node_modules/vitest-not-selected'), this.path('project/node_modules/vitest')); } catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error; } }
  async events(): Promise<{ event: string; title?: string; actual?: number; listening?: boolean }[]> {
    return (await fs.readFile(this.path('project/shop-events.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
}
