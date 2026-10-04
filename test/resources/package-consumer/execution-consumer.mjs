import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

let packageUrl;
try {
  packageUrl = import.meta.resolve('executable-specification-language');
  const { Compiler, SpecificationIdentity, Outputs, acceptanceOutput, ConfigurationReader, ProjectConnector, TypeScriptContext, FileProjectWriter } = await import('executable-specification-language');
  const root = process.cwd(), file = async (path, text) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); };
  await file('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, types: ['node'], skipLibCheck: true }, include: ['**/*.ts'] }));
  await file('vitest.config.ts', 'import { defineConfig } from "vitest/config"; export default defineConfig({ test: { include: ["test/acceptance/*.test.ts"], retry: 0 } });');
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
  const requireValue = checked => { if (!checked.value) throw Error(JSON.stringify(checked)); return checked.value; };
  const compiled = requireValue(new Compiler().compile({ source: { sourceId: 'shopping.expec', text: source }, locator: 'shopping', dependencies: { modules: [], packages: [] } }));
  let sequence = 0;
  const identities = new SpecificationIdentity(() => 'installed-lifecycle-' + ++sequence);
  let current = requireValue(identities.associate(compiled));
  const outputs = new Outputs(); outputs.register(acceptanceOutput);
  const manifest = join(root, 'expec.json'), configuration = requireValue(new ConfigurationReader(outputs.profiles).read({ sourceId: manifest,
    text: JSON.stringify({ formatVersion: 1, version: '0.1.0', project: { root: '.' }, build: { entries: ['shopping.expec'] } }) }));
  const connected = requireValue(await new ProjectConnector(manifest).connect(configuration));
  if (connected.status !== 'connected') throw Error('Expected a connected installed consumer.');
  const context = new TypeScriptContext(connected.context, { configFile: 'tsconfig.json', imports: ['vitest'] }), writer = new FileProjectWriter(context);
  const options = { domain: 'shopping', configFile: 'tsconfig.json' };
  const initial = await requireValue(outputs.open('acceptance', options, context, writer, { workspaceModules: ['shopping'] })).create(current);
  if (initial.receipt?.status !== 'applied') throw Error(JSON.stringify(initial));
  current = requireValue(identities.withArtifacts(current, initial.artifacts));
  for (const [resource, destination] of [['shop', 'src/shop.ts'], ['http-shopping', 'test/driver/http-shopping.ts'], ['http-shopping-test', 'test/dsl/http-shopping-test.ts']]) {
    await mkdir(dirname(destination), { recursive: true }); await copyFile('resources/' + resource + '.mts', destination);
  }
  await file('shop-options.json', '{}');
  const fixture = { outputId: 'acceptance', format: 'typescript-symbol-1', value: { file: 'test/dsl/http-shopping-test.ts', declaration: [{ kind: 'variable', name: 'test' }] } };
  const output = requireValue(outputs.open('acceptance', { ...options, fixture }, context, writer, { workspaceModules: ['shopping'] }));
  const written = await output.update(requireValue(identities.compare(current.baseline, current)), current);
  if (written.receipt?.status !== 'applied') throw Error(JSON.stringify(written));
  const scenario = await readFile('test/acceptance/shopping.test.ts', 'utf8'), checks = await readFile('test/dsl/shopping.ts', 'utf8');
  const run = async name => {
    await file('shop-events.jsonl', ''); let code = 0;
    try { await promisify(execFile)(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.config.ts', '--reporter=json', '--outputFile=' + name + '.json'], { cwd: root, windowsHide: true, timeout: 30000, maxBuffer: 2 ** 20 }); }
    catch (error) { if (error.code !== 1) throw error; code = 1; }
    const result = JSON.parse(await readFile(name + '.json', 'utf8'));
    return { code, success: result.success, assertions: result.testResults.flatMap(file => file.assertionResults).map(({ title, status, failureMessages }) => ({ title, status, failureMessages })),
      events: (await readFile('shop-events.jsonl', 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)) };
  };
  const passed = await run('working-http-shop');
  await file('shop-options.json', JSON.stringify({ addBook: 'no-op' }));
  const broken = await run('broken-http-shop');
  process.stdout.write(JSON.stringify({ packageUrl, lifecycle: { written, scenario, passed, broken,
    unchangedTests: scenario === await readFile('test/acceptance/shopping.test.ts', 'utf8') && checks === await readFile('test/dsl/shopping.ts', 'utf8') } }));
} catch (error) {
  process.stdout.write(JSON.stringify({ packageUrl, error: { code: error.code, message: error.message } })); process.exitCode = 1;
}
