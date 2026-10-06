import { readFile } from 'node:fs/promises';
import { InstalledPilotDriver } from './installed-pilot.js';

const addBook = 'if (settings.addBook !== \'no-op\') basket.set(title, (basket.get(title) ?? 0) + 1);';
const missingAdd = '// The add endpoint is not implemented yet.';
export class ShoppingPilotDriver extends InstalledPilotDriver {
  private generated: Record<string, string> = {};
  async author(title: string, quantity: number): Promise<void> {
    await this.install();
    await this.file('main.expec', `examples {
  setup bookIsAvailable(title: Text) returns Nothing
  setup startWithEmptyBasket() returns Nothing
  action addBook(title: Text) returns Nothing
  observation bookQuantity(title: Text) returns Number
  check expectBookQuantity(title: Text, expected: Number) {
    let actual = bookQuantity(title)
    assert actual == expected
  }
  scenario "a shopper can add an available book" {
    given bookIsAvailable(${JSON.stringify(title)})
    given startWithEmptyBasket()
    when addBook(${JSON.stringify(title)})
    then expectBookQuantity(${JSON.stringify(title)}, ${quantity})
  }
}`);
    await this.file('expec.json', JSON.stringify({ formatVersion: 1, version: '0.1.0', build: { entries: ['main.expec'] },
      outputs: [{ id: 'acceptance', options: { domain: 'shopping', configFile: 'tsconfig.json' } }],
      packages: [{ alias: 'tests', name: 'npm:vitest', version: '5.0.2', phases: ['test'] },
        { alias: 'node', name: 'npm:@types/node', version: '24.13.6', phases: ['test'] }],
    }));
  }
  async configureNativeTests(): Promise<void> {
    await this.file('game/tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, types: ['node'], skipLibCheck: true }, include: ['**/*.ts'] }));
    await this.file('game/vitest.config.ts', 'import { defineConfig } from "vitest/config"; export default defineConfig({test:{include:["test/acceptance/*.test.ts"],retry:0}});');
  }
  async connectHttpFixture(): Promise<void> {
    for (const [resource, path] of [['shop', 'src/shop.ts'], ['http-shopping', 'test/driver/http-shopping.ts'], ['http-shopping-test', 'test/dsl/http-shopping-test.ts']]) {
      const source = await readFile(new URL('../../resources/scenario-execution/' + resource + '.mts', import.meta.url), 'utf8');
      if (resource === 'shop' && source.split(addBook).length !== 2) throw Error('The actual add endpoint must have one implementation.');
      await this.file('game/' + path, resource === 'shop' ? source.replace(addBook, missingAdd) : source);
    }
    await this.file('game/shop-options.json', '{}');
    const manifest = JSON.parse(await this.text('expec.json'));
    manifest.outputs[0].options.fixture = { outputId: 'acceptance', format: 'typescript-symbol-1', value: {
      file: 'test/dsl/http-shopping-test.ts', declaration: [{ kind: 'variable', name: 'test' }],
    } };
    await this.file('expec.json', JSON.stringify(manifest));
  }
  async rememberGenerated(): Promise<void> {
    for (const path of ['game/test/acceptance/shopping.test.ts', 'game/test/dsl/shopping.ts']) this.generated[path] = await this.text(path);
  }
  async generatedBytes(): Promise<{ before: Record<string, string>; after: Record<string, string> }> {
    return { before: this.generated, after: Object.fromEntries(await Promise.all(Object.keys(this.generated).map(async path => [path, await this.text(path)]))) };
  }
  async runScenarios(): Promise<void> { await this.file('game/shop-events.jsonl', ''); await this.cli(['test']); }
  async repairAdd(): Promise<void> {
    const source = await this.text('game/src/shop.ts');
    if (source.split(missingAdd).length !== 2) throw Error('The current application must still have its incomplete add endpoint.');
    await this.file('game/src/shop.ts', source.replace(missingAdd, addBook));
  }
  async events(): Promise<{ id: string; event: string; title?: string; actual?: number; listening?: boolean }[]> {
    return (await this.text('game/shop-events.jsonl')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
}
