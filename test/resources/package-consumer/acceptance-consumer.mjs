import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

let packageUrl;
try {
  packageUrl = import.meta.resolve('executable-specification-language');
  const { Compiler, SpecificationIdentity, Outputs, acceptanceOutput, ConfigurationReader, ProjectConnector, TypeScriptContext, FileProjectWriter } = await import('executable-specification-language');
  const root = process.cwd(), file = async (path, text) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); };
  await file('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, types: ['node'], skipLibCheck: true }, include: ['**/*.ts'] }));
  await file('vitest.config.ts', 'import { defineConfig } from "vitest/config"; export default defineConfig({ test: { include: ["test/acceptance/*.test.ts"] } });');
  const basket = `export class Basket {
  private readonly available = new Set<string>();
  private readonly contents = new Map<string, number>();
  offer(title: string): void { this.available.add(title); }
  empty(): void { this.contents.clear(); }
  add(title: string): void {
    if (!this.available.has(title)) throw Error('Book is unavailable');
    this.contents.set(title, this.quantity(title) + 1);
  }
  quantity(title: string): number { return this.contents.get(title) ?? 0; }
}`;
  const driverBefore = `import { Basket } from '../../basket.js';
export class BasketDriver {
  private readonly basket = new Basket();
  bookIsAvailable(title: string): void { this.basket.offer(title); }
  startWithEmptyBasket(): void { this.basket.empty(); }
  addBook(title: string): void { this.basket.add(title); }
  bookQuantity(title: string): number { return this.basket.quantity(title); }
}`;
  await file('basket.ts', basket); await file('test/driver/basket.ts', driverBefore);
  const source = `examples {
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
}`;
  const compiled = new Compiler().compile({ source: { sourceId: 'shopping.expec', text: source }, locator: 'shopping', dependencies: { modules: [], packages: [] } });
  if (!compiled.value) throw Error(JSON.stringify(compiled));
  let sequence = 0;
  const identities = new SpecificationIdentity(() => 'installed-shopping-' + ++sequence), identified = identities.associate(compiled.value);
  if (!identified.value) throw Error(JSON.stringify(identified));
  const declaration = [{ kind: 'class', name: 'BasketDriver' }], driver = { outputId: 'acceptance', format: 'typescript-symbol-1', value: { file: 'test/driver/basket.ts', declaration } };
  const mapped = identities.withArtifacts(identified.value, identified.value.baseline.elements.filter(item => ['setup', 'action', 'observation'].includes(item.address.kind)).map(item => ({
    specId: item.id, locator: { ...driver, value: { ...driver.value, declaration: [...declaration, { kind: 'method', name: item.address.name, static: false }] } },
  })));
  if (!mapped.value) throw Error(JSON.stringify(mapped));
  const outputs = new Outputs(); outputs.register(acceptanceOutput);
  const manifest = join(root, 'expec.json'), configuration = new ConfigurationReader(outputs.profiles).read({ sourceId: manifest,
    text: JSON.stringify({ formatVersion: 1, version: '0.1.0', project: { root: '.' }, build: { entries: ['shopping.expec'] } }) });
  if (!configuration.value) throw Error(JSON.stringify(configuration));
  const connected = await new ProjectConnector(manifest).connect(configuration.value);
  if (connected.value?.status !== 'connected') throw Error(JSON.stringify(connected));
  const context = new TypeScriptContext(connected.value.context, { configFile: 'tsconfig.json', imports: ['vitest'] });
  const output = outputs.open('acceptance', { domain: 'shopping', configFile: 'tsconfig.json', adoptExisting: true, driver }, context, new FileProjectWriter(context), { workspaceModules: ['shopping'] });
  if (!output.value) throw Error(JSON.stringify(output));
  const written = await output.value.create(mapped.value);
  if (written.receipt?.status !== 'applied') throw Error(JSON.stringify(written));
  const scenario = await readFile('test/acceptance/shopping.test.ts', 'utf8'), checks = await readFile('test/dsl/shopping.ts', 'utf8');
  const run = async name => {
    let code = 0;
    try { await promisify(execFile)(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.config.ts', '--reporter=json', '--outputFile=' + name + '.json'], { cwd: root, windowsHide: true, timeout: 30000, maxBuffer: 2 ** 20 }); }
    catch (error) { if (error.code !== 1) throw error; code = 1; }
    const result = JSON.parse(await readFile(name + '.json', 'utf8'));
    return { code, success: result.success, assertions: result.testResults.flatMap(file => file.assertionResults).map(({ title, status, failureMessages }) => ({ title, status, failureMessages })) };
  };
  const passed = await run('working-basket');
  await file('basket.ts', basket.replace('this.contents.set(title, this.quantity(title) + 1);', 'void title;'));
  const broken = await run('broken-basket');
  const unchangedTests = scenario === await readFile('test/acceptance/shopping.test.ts', 'utf8') && checks === await readFile('test/dsl/shopping.ts', 'utf8');
  process.stdout.write(JSON.stringify({ packageUrl, acceptance: { written, scenario, driverBefore, driverAfter: await readFile('test/driver/basket.ts', 'utf8'), passed, broken, unchangedTests } }));
} catch (error) {
  process.stdout.write(JSON.stringify({ packageUrl, error: { code: error.code, message: error.message } })); process.exitCode = 1;
}
