import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { denied } from './checkout-guard.mjs';

const canaries = [];
for (const action of [() => fs.readFile(join(process.env.EXPEC_DENIED_CHECKOUT, 'package.json')), () => import(pathToFileURL(join(process.env.EXPEC_DENIED_CHECKOUT, 'dist/index.js')).href)]) {
  try { await action(); canaries.push(false); } catch (error) { canaries.push(error.message.startsWith('CHECKOUT_DENIED:')); }
}
const denialCount = denied.length;
const { Compiler, ConfigurationReader, FileProjectWriter, KotlinContext, KotlinDependencies, kotlinAcceptanceOutput, kotlinOutput,
  Outputs, ProjectConnector, ProjectInitializer, SpecificationIdentity } = await import('executable-specification-language');
const packageUrl = import.meta.resolve('executable-specification-language'), resource = fileURLToPath(new URL('./project/kotlin/resources/', packageUrl));
const javaHome = process.env.EXPEC_TEST_JAVA_HOME;
assert(javaHome, 'Supply an explicit ordinary JDK21');
const java = join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
const source = JSON.parse(await fs.readFile(process.argv[2], 'utf8')).source;
const root = join(process.cwd(), 'game'), manifest = join(process.cwd(), 'expec.json');
const outputs = new Outputs(); outputs.register(kotlinOutput); outputs.register(kotlinAcceptanceOutput);
const read = new ConfigurationReader(outputs.profiles).read({ sourceId: manifest, text: JSON.stringify({ formatVersion: 1, version: '0.1.0', build: { entries: ['main.expec'] } }) });
assert(read.value, JSON.stringify(read));
const initializer = new ProjectInitializer(manifest, read.value), preview = await initializer.prepare({ root: 'game', target: 'kotlin', javaHome });
assert(preview.value, JSON.stringify(preview));
const initialized = await initializer.apply(preview.value, true); assert(initialized.value, JSON.stringify(initialized));
const acquired = await new KotlinDependencies(root).install(initialized.value.configuration.packages); assert(acquired.value, JSON.stringify(acquired));
const connected = await new ProjectConnector(manifest, { excludeNames: ['.git', 'node_modules', '.gradle', '.kotlin', 'build'] }).connect(initialized.value.configuration);
assert.equal(connected.value?.status, 'connected', JSON.stringify(connected));
const context = new KotlinContext(connected.value.context), writer = new FileProjectWriter(context);
const checked = new Compiler().compile({ source: { sourceId: 'main.expec', text: source }, locator: 'main', dependencies: { modules: [], packages: [] } });
assert(checked.value, JSON.stringify(checked));
let next = 0; const identity = new SpecificationIdentity(() => 'installed-kotlin-' + ++next);
let current = identity.associate(checked.value).value; assert(current);
const contracts = outputs.open('kotlin', { package: 'generated', directory: 'src/main/kotlin' }, context, writer).value; assert(contracts);
const created = await contracts.create(current); assert(created.artifacts, JSON.stringify(created));
current = identity.withArtifacts(current, created.artifacts).value; assert(current);
const applicationPath = 'src/main/kotlin/generated/multiply.kt', application = join(root, applicationPath);
let text = await fs.readFile(application, 'utf8'); assert(text.includes('throw NotImplementedError("Not implemented: multiply")'));
text = text.replace('throw NotImplementedError("Not implemented: multiply")', '/* Keep this application body. */ return a * b');
await fs.writeFile(application, text);
const callerPath = 'src/main/kotlin/generated/Launcher.kt', caller = 'package generated\r\n// emoji 😀\r\nfun launch() = multiply(8.0, 8.0)\r\nclass Other { fun multiply(a: Double, b: Double) = a + b }\r\nfun unrelated() = Other().multiply(8.0, 8.0)\r\n';
await fs.writeFile(join(root, callerPath), caller);
const subject = current.baseline.elements.find(item => item.address.name === 'multiply').id;
const observed = await contracts.read(subject), search = await contracts.search(subject);
const repeated = await contracts.create(current), preserved = await fs.readFile(application, 'utf8');
assert.deepEqual(repeated.problems, [], JSON.stringify(repeated));
const acceptance = outputs.open('kotlin-acceptance', { package: 'generated.tests', domain: 'shopping' }, context, writer).value; assert(acceptance);
const tests = await acceptance.create(current); assert(tests.artifacts, JSON.stringify(tests));
const testPath = 'src/test/kotlin/generated/tests/acceptance/ShoppingAcceptance.kt', testText = await fs.readFile(join(root, testPath), 'utf8');
const jars = (await fs.readdir(join(resource, 'lib'))).filter(name => name.endsWith('.jar')).map(name => join(resource, 'lib', name));
const report = JSON.parse(await fs.readFile(join(root, '.expec/kotlin/classpath.json'), 'utf8'));
const run = async args => { try { return { code: 0, ...await promisify(execFile)(java, args, { cwd: root, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }) }; } catch (error) { if (typeof error.code !== 'number') throw error; return { code: error.code, stdout: error.stdout, stderr: error.stderr }; } };
let iteration = 0;
async function execute() {
  const directory = join(process.cwd(), 'native-' + ++iteration), main = join(directory, 'main'), test = join(directory, 'test'), reports = join(directory, 'reports');
  for (const path of [main, test, reports]) await fs.mkdir(path, { recursive: true });
  const snapshot = await context.readSnapshot(); assert(snapshot.complete, JSON.stringify(snapshot.problems));
  for (const scope of ['main', 'test']) {
    const compilation = await run(['-cp', jars.join(delimiter), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-classpath',
      [...scope === 'test' ? [main] : [], ...report.classPath[scope]].join(delimiter), '-jvm-target', '21', ...scope === 'test' ? ['-Xfriend-paths=' + main] : [], '-d', scope === 'main' ? main : test,
      ...snapshot.files.filter(file => file.path.endsWith('.kt') && report.sourceRoots[scope].some(root => file.path.startsWith(root + '/'))).map(file => join(root, file.path))]);
    assert.equal(compilation.code, 0, JSON.stringify(compilation));
  }
  const result = await run(['-cp', [main, test, ...report.runtimeClassPath.test].join(delimiter), 'org.junit.platform.console.ConsoleLauncher', 'execute', '--select-method',
    'generated.tests.acceptance.ShoppingAcceptance#eightSquared()', '--reports-dir', reports, '--disable-banner', '--disable-ansi-colors']);
  return { ...result, xml: await Promise.all((await fs.readdir(reports)).filter(file => file.endsWith('.xml')).map(file => fs.readFile(join(reports, file), 'utf8'))) };
}
const passed = await execute();
await fs.writeFile(application, preserved.replace('return a * b', 'return a + b'));
const broken = await execute();
const inventory = JSON.parse(await fs.readFile(join(resource, 'dependencies.json'), 'utf8'));
const artifacts = [];
for (const item of inventory.artifacts) {
  const bytes = await fs.readFile(join(resource, 'lib', item.file));
  artifacts.push({ file: item.file, expected: item.sha256, actual: createHash('sha256').update(bytes).digest('hex'), notices: await Promise.all(item.notices.map(async path => ({ path, bytes: (await fs.readFile(join(resource, path))).length }))) });
}
console.log(JSON.stringify({ packageUrl, kotlin: { initialized: initialized.status, acquired, created, repeated, tests, testText,
  observed: { coverage: observed.coverage, problems: observed.problems, files: observed.artifacts.map(item => ({ path: item.file.path, text: Buffer.from(item.file.bytes).toString('utf8') })) }, search,
  caller, callerPath, before: text, after: preserved, passed, broken, testUnchanged: testText === await fs.readFile(join(root, testPath), 'utf8'),
  canaries, unexpectedDenials: denied.slice(denialCount), jars: jars.length, nativeBytes: (await Promise.all(jars.map(path => fs.stat(path)))).reduce((sum, item) => sum + item.size, 0),
  artifacts, notice: await fs.readFile(join(resource, 'NOTICE.txt'), 'utf8') } }));
