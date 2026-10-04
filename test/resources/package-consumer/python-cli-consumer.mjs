import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const packageUrl = import.meta.resolve('executable-specification-language');
const packageRoot = dirname(dirname(fileURLToPath(packageUrl)));
const metadata = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
const executable = resolve(packageRoot, metadata.bin.expec), input = JSON.parse(await readFile('python-cli-input.json', 'utf8'));
let privateImportDenied;
try { await import('executable-specification-language/dist/python-context.js'); } catch (error) { privateImportDenied = error.code; }
assert.equal(privateImportDenied, 'ERR_PACKAGE_PATH_NOT_EXPORTED');
const temporary = await realpath(tmpdir());
const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', TMP: temporary, TEMP: temporary, TMPDIR: temporary,
  EXPEC_TEST_CHECKOUT_FILE: input.checkoutFile, EXPEC_DENIED_CHECKOUT: dirname(dirname(input.checkoutFile)) };
delete env.EXPEC_TEST_PYTHON_SITE;
const execute = async (command, args, timeout = 600_000) => {
  try { return { code: 0, ...await promisify(execFile)(command, args, { env, timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }) }; }
  catch (error) { if (typeof error.code !== 'number' || error.killed) throw error; return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
};
let command, declarations;
if (input.command === 'prepare') {
  await mkdir('spec');
  await writeFile('spec/main.expec', 'concept StoreGame {}');
  await writeFile('spec/expec.json', JSON.stringify({ formatVersion: 1, version: '1.0.0', build: { entries: ['main.expec'] }, outputs: [] }));
  await writeFile('tsconfig.json', JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022',
    strict: true, exactOptionalPropertyTypes: true, skipLibCheck: true, noEmit: true, types: [] }, files: ['python-public.mts'] }));
  declarations = await execute(process.execPath, [createRequire(packageUrl).resolve('typescript/bin/tsc'), '-p', 'tsconfig.json', '--pretty', 'false'], 30_000);
} else if (input.command === 'source') {
  await writeFile('spec/main.expec', input.source);
} else if (input.command === 'implement') {
  const basket = await readFile('basket.py', 'utf8');
  assert.ok(basket.includes('COPIES_ADDED = 1'));
  await writeFile('project/src/basket.py', basket.replace('COPIES_ADDED = 1', 'COPIES_ADDED = ' + input.copies));
  await writeFile('project/test/driver/shopping_driver.py', `from basket import Basket

class ShoppingDriver:
    def __init__(self) -> None:
        self.basket = Basket()
    def bookIsAvailable(self, title: str) -> None:
        self.basket.offer(title)
    def startWithEmptyBasket(self) -> None:
        self.basket.empty()
    def addBook(self, title: str) -> None:
        self.basket.add(title)
    def bookQuantity(self, title: str) -> float:
        return float(self.basket.quantity(title))
`);
} else {
  const guarded = ['build', 'test'].includes(input.command);
  const permission = guarded ? ['--import', './python-cli-guard.mjs'] : [];
  const extra = input.command === 'init' ? ['--root', '../project', '--target', 'python', '--python', env.EXPEC_TEST_PYTHON,
    '--uv', env.EXPEC_TEST_UV, '--yes'] : [];
  const result = await execute(process.execPath, [...permission, executable, input.command, '--config', 'spec/expec.json', '--json', ...extra]);
  command = { ...result, report: JSON.parse(result.stdout) };
}
const generated = {};
const observe = async directory => {
  let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (entry.name === 'driver' || entry.name === '__pycache__') continue;
    const path = directory + '/' + entry.name;
    if (entry.isDirectory()) await observe(path);
    else if (entry.isFile() && entry.name.endsWith('.py')) generated[path.replace(/^project\//, '')] = await readFile(path, 'utf8');
  }
};
await observe('project/test');
console.log(JSON.stringify({ packageUrl, executable, privateImportDenied, command, declarations, generated }));
