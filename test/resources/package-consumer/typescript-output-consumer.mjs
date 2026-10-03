import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import ts from 'typescript';

let packageUrl;
try {
  packageUrl = import.meta.resolve('executable-specification-language');
  const { Compiler, SpecificationIdentity, ConfigurationReader, ProjectConnector, FileProjectWriter, Outputs, typescriptOutput } =
    await import('executable-specification-language');
  const input = JSON.parse(await readFile(process.argv[2], 'utf8')), root = join(process.cwd(), 'project');
  await mkdir(root);
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await writeFile(join(root, 'notes.txt'), 'Keep the deployment note.');
  const outputs = new Outputs();
  outputs.register(typescriptOutput);
  const configuration = new ConfigurationReader(outputs.profiles).read({ sourceId: 'settings', text: JSON.stringify({
    formatVersion: 1, version: '0.1.0', project: { root: 'project' }, build: { entries: ['main.expec'] },
    outputs: [{ id: 'typescript', options: { directory: 'src' } }],
  }) });
  if (!configuration.value) throw Error(JSON.stringify(configuration));
  const connected = await new ProjectConnector(join(process.cwd(), 'expec.json')).connect(configuration.value);
  if (connected.value?.status !== 'connected') throw Error(JSON.stringify(connected));
  const context = connected.value.context, opened = outputs.open('typescript', configuration.value.outputs[0].options,
    context, new FileProjectWriter(context), { workspaceModules: ['main'] });
  if (!opened.value) throw Error(JSON.stringify(opened));
  let next = 0;
  const identities = new SpecificationIdentity(() => 'installed-ts-' + ++next);
  const identify = (text, previous) => {
    const compilation = new Compiler().compile({ source: { sourceId: 'main.expec', text }, locator: 'main', dependencies: { modules: [], packages: [] } });
    if (!compilation.value) throw Error(JSON.stringify(compilation));
    const result = identities.associate(compilation.value, previous);
    if (!result.value) throw Error(JSON.stringify(result));
    return result.value;
  };
  const current = identify(input.source), output = opened.value, written = await output.create(current);
  const report = { written, typescript: { version: ts.version, location: createRequire(import.meta.url).resolve('typescript') } };
  if (written.receipt?.status === 'applied') {
    const sourcePath = join(root, 'src/save.ts');
    report.source = await readFile(sourcePath, 'utf8');
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true, types: [], skipLibCheck: true, outDir: join(root, 'build') };
    const diagnostics = program => ts.getPreEmitDiagnostics(program).map(diagnostic => ({ code: diagnostic.code,
      file: diagnostic.file?.fileName.split(/[\\/]/).at(-1),
      text: diagnostic.file?.text.slice(diagnostic.start, diagnostic.start + diagnostic.length),
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') }));
    await writeFile(join(root, 'valid.mts'), input.validConsumer);
    const valid = ts.createProgram([join(root, 'valid.mts')], options);
    report.validDiagnostics = diagnostics(valid);
    valid.emit();
    await writeFile(join(root, 'invalid.mts'), input.invalidConsumer);
    report.invalidDiagnostics = diagnostics(ts.createProgram([join(root, 'invalid.mts')], options));
    await writeFile(join(root, 'run.mjs'), `try { await import('./build/valid.mjs'); process.stdout.write(JSON.stringify({ returned: true })); }
catch (error) { process.stdout.write(JSON.stringify({ name: error.name, message: error.message })); }`);
    const runtime = await promisify(execFile)(process.execPath, ['run.mjs'], { cwd: root, windowsHide: true, timeout: 20_000 });
    report.runtime = JSON.parse(runtime.stdout);
    report.notes = await readFile(join(root, 'notes.txt'), 'utf8');
    const statePath = join(root, '.expec/outputs', Buffer.from('typescript').toString('hex') + '.json');
    const stateBefore = await readFile(statePath, 'utf8');
    report.baseline = JSON.parse(stateBefore).files.find(file => file.path === 'src/save.ts').generated;
    report.handwritten = report.source + '\n// Keep the handwritten retry rationale.\n';
    await writeFile(sourcePath, report.handwritten);
    const revised = identify(input.revised, current.baseline), diff = identities.compare(current.baseline, revised);
    if (!diff.value) throw Error(JSON.stringify(diff));
    report.update = await output.update(diff.value, revised);
    report.after = await readFile(sourcePath, 'utf8');
    report.stateAfter = await readFile(statePath, 'utf8');
    report.stateBefore = stateBefore;
  }
  process.stdout.write(JSON.stringify({ packageUrl, typescriptOutput: report }));
} catch (error) {
  process.stdout.write(JSON.stringify({ packageUrl, error: { code: error.code, message: error.message, url: error.url } }));
  process.exitCode = 1;
}
