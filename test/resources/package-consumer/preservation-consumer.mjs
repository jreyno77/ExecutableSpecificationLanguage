import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
  await writeFile(join(root, 'game.ts'), input.implementation);
  await writeFile(join(root, 'caller.ts'), input.caller);
  const outputs = new Outputs(); outputs.register(typescriptOutput);
  const options = { directory: 'src', adoptExisting: true };
  const configuration = new ConfigurationReader(outputs.profiles).read({ sourceId: 'settings', text: JSON.stringify({
    formatVersion: 1, version: '0.1.0', project: { root: 'project' }, build: { entries: ['main.expec'] },
    outputs: [{ id: 'typescript', options }],
  }) });
  if (!configuration.value) throw Error(JSON.stringify(configuration));
  const connected = await new ProjectConnector(join(process.cwd(), 'expec.json')).connect(configuration.value);
  if (connected.value?.status !== 'connected') throw Error(JSON.stringify(connected));
  const context = connected.value.context, opened = outputs.open('typescript', options, context,
    new FileProjectWriter(context), { workspaceModules: ['main'] });
  if (!opened.value) throw Error(JSON.stringify(opened));
  let next = 0;
  const identities = new SpecificationIdentity(() => 'preserved-' + ++next);
  const compile = text => {
    const checked = new Compiler().compile({ source: { sourceId: 'main.expec', text }, locator: 'main', dependencies: { modules: [], packages: [] } });
    if (!checked.value) throw Error(JSON.stringify(checked)); return checked.value;
  };
  const specification = compile(input.source), identified = identities.associate(specification);
  if (!identified.value) throw Error(JSON.stringify(identified));
  const capability = [...specification.inspection.query('capability')].find(item => item.name === 'save');
  const owner = [...specification.inspection.query('class')].find(item => item.name === 'StoreGame');
  const saveId = identified.value.id(capability.id), storeId = identified.value.id(owner.id);
  const mapped = identities.withArtifacts(identified.value, [
    { specId: storeId, locator: { outputId: 'typescript', format: 'typescript-symbol-1', value: {
      file: 'game.ts', declaration: [{ kind: 'class', name: 'StoreGame' }],
    } } },
    { specId: saveId, locator: { outputId: 'typescript', format: 'typescript-symbol-1', value: {
      file: 'game.ts', declaration: [{ kind: 'class', name: 'StoreGame' }, { kind: 'method', name: 'save', static: false }],
    } } },
  ]);
  if (!mapped.value) throw Error(JSON.stringify(mapped));
  const adopted = await opened.value.create(mapped.value), afterAdoption = await readFile(join(root, 'game.ts'), 'utf8');
  const report = { adopted, original: input.implementation, afterAdoption, generatedDuplicate: false };
  try { await access(join(root, 'src/StoreGame.ts')); report.generatedDuplicate = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (adopted.artifacts) {
    const confirmed = identities.withArtifacts(mapped.value, adopted.artifacts);
    if (!confirmed.value) throw Error(JSON.stringify(confirmed));
    const revisedSpecification = compile(input.revised);
    const renamed = [...revisedSpecification.inspection.query('capability')].find(item => item.name === 'saveGame');
    const revised = identities.associate(revisedSpecification, confirmed.value.baseline, [{ id: saveId, to: renamed.id }]);
    if (!revised.value) throw Error(JSON.stringify(revised));
    const diff = identities.compare(confirmed.value.baseline, revised.value);
    if (!diff.value) throw Error(JSON.stringify(diff));
    report.updated = await opened.value.update(diff.value, revised.value);
    report.retainedIdentity = revised.value.id(renamed.id) === saveId;
    report.source = await readFile(join(root, 'game.ts'), 'utf8');
    report.caller = await readFile(join(root, 'caller.ts'), 'utf8');
    const program = ts.createProgram([join(root, 'caller.ts')], { target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true,
      types: [], skipLibCheck: true, noEmitOnError: true, outDir: join(root, 'build') });
    report.diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => ({ code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') }));
    if (!report.diagnostics.length) {
      program.emit();
      try {
        const result = await promisify(execFile)(process.execPath, ['build/caller.js'], { cwd: root, windowsHide: true, timeout: 20_000 });
        report.runtime = { code: 0, ...result };
      } catch (error) { report.runtime = { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
    }
  }
  process.stdout.write(JSON.stringify({ packageUrl, preservation: report }));
} catch (error) {
  process.stdout.write(JSON.stringify({ packageUrl, error: { code: error.code, message: error.message, url: error.url } }));
  process.exitCode = 1;
}
