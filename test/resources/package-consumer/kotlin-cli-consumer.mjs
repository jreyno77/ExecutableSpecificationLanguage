import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { denied } from './checkout-guard.mjs';

const canaries = [];
for (const action of [() => fs.readFile(join(process.env.EXPEC_DENIED_CHECKOUT, 'package.json')), () => import(pathToFileURL(join(process.env.EXPEC_DENIED_CHECKOUT, 'dist/index.js')).href)]) {
  try { await action(); canaries.push(false); } catch (error) { canaries.push(error.message.startsWith('CHECKOUT_DENIED:')); }
}
const denialCount = denied.length;
const { runCli } = await import('executable-specification-language');
assert.equal(typeof runCli, 'function');
const packageUrl = import.meta.resolve('executable-specification-language');
const packageRoot = fileURLToPath(new URL('../', packageUrl));
const metadata = JSON.parse(await fs.readFile(join(packageRoot, 'package.json'), 'utf8'));
const executable = join(packageRoot, metadata.bin.expec);
const javaHome = process.env.EXPEC_TEST_JAVA_HOME; assert(javaHome, 'Supply the explicit ordinary JDK21.');
const source = JSON.parse(await fs.readFile(process.argv[2], 'utf8')).source;
const manifest = join(process.cwd(), 'expec.json');
await fs.writeFile(manifest, JSON.stringify({ formatVersion: 1, version: '1.0.0', build: { entries: ['main.expec'] } }, null, 2));
await fs.writeFile('main.expec', source);
async function command(args) {
  let result;
  try { result = { code: 0, ...await promisify(execFile)(process.execPath, ['--import', pathToFileURL(join(process.cwd(), 'checkout-guard.mjs')).href, executable, ...args, '--json'],
    { cwd: process.cwd(), env: process.env, timeout: 360_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }) }; }
  catch (error) { if (typeof error.code !== 'number') throw error; result = { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
  assert(result.stdout.trim(), 'CLI returned no JSON: ' + result.stderr);
  return { code: result.code, report: JSON.parse(result.stdout), stderr: result.stderr };
}
const initialized = await command(['init', '--root', 'game', '--target', 'kotlin', '--java-home', javaHome, '--yes']);
assert.equal(initialized.code, 0, JSON.stringify(initialized));
const configuration = JSON.parse(await fs.readFile(manifest, 'utf8'));
configuration.outputs.push({ id: 'kotlin-acceptance', options: { package: 'generated.tests', domain: 'shopping' } });
await fs.writeFile(manifest, JSON.stringify(configuration, null, 2));
const acquired = await command(['install']); assert.equal(acquired.code, 0, JSON.stringify(acquired));
const built = await command(['build']); assert.equal(built.code, 0, JSON.stringify(built));
const application = join(process.cwd(), 'game/src/main/kotlin/generated/multiply.kt');
const original = await fs.readFile(application, 'utf8');
assert(original.includes('throw NotImplementedError("Not implemented: multiply")'));
await fs.writeFile(application, original.replace('throw NotImplementedError("Not implemented: multiply")', 'return a * b'));
const tests = join(process.cwd(), 'game/src/test/kotlin/generated/tests/acceptance/ShoppingAcceptance.kt'), testText = await fs.readFile(tests, 'utf8');
const passed = await command(['test']);
await fs.writeFile(application, original.replace('throw NotImplementedError("Not implemented: multiply")', 'return a + b'));
const broken = await command(['test']);
console.log(JSON.stringify({ packageUrl, kotlinCli: { executable, initialized, acquired, built, passed, broken, original, testText,
  testUnchanged: await fs.readFile(tests, 'utf8') === testText, canaries, unexpectedDenials: denied.slice(denialCount) } }));
