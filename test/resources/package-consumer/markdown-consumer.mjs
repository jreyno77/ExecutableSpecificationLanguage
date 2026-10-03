import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

let packageUrl;
try {
  packageUrl = import.meta.resolve('executable-specification-language');
  const { Compiler, SpecificationIdentity, ConfigurationReader, ProjectConnector, FileProjectWriter, Outputs, markdownOutput } =
    await import('executable-specification-language');
  const input = JSON.parse(await readFile(process.argv[2], 'utf8')), root = join(process.cwd(), 'project');
  await mkdir(root);
  const outputs = new Outputs();
  outputs.register(markdownOutput);
  const configuration = new ConfigurationReader(outputs.profiles).read({ sourceId: 'settings', text: JSON.stringify({
    formatVersion: 1, version: '0.1.0', project: { root: 'project' }, build: { entries: ['main.expec'] },
    outputs: [{ id: 'markdown', options: { directory: 'reference' } }],
  }) });
  if (!configuration.value) throw Error(JSON.stringify(configuration));
  const connected = await new ProjectConnector(join(process.cwd(), 'expec.json')).connect(configuration.value);
  if (connected.value?.status !== 'connected') throw Error(JSON.stringify(connected));
  const context = connected.value.context, opened = outputs.open('markdown', configuration.value.outputs[0].options,
    context, new FileProjectWriter(context));
  if (!opened.value) throw Error(JSON.stringify(opened));
  const compilation = new Compiler().compile({ source: { sourceId: 'main.expec', text: input.source },
    locator: 'main', dependencies: { modules: [], packages: [] } });
  if (!compilation.value) throw Error(JSON.stringify(compilation));
  let next = 0;
  const identified = new SpecificationIdentity(() => 'installed-doc-' + ++next).associate(compilation.value);
  if (!identified.value) throw Error(JSON.stringify(identified));
  const game = [...compilation.value.inspection.query('concept')].find(item => item.name === 'Game');
  if (!game) throw Error('Consumer source must declare Game.');
  const id = identified.value.id(game.id), output = opened.value, written = await output.create(identified.value);
  await appendFile(join(root, 'reference/Game.md'), input.note);
  const read = await output.read(id);
  await writeFile(join(root, 'guide.md'), '[Game](reference/Game.md)');
  const search = await output.search(id);
  process.stdout.write(JSON.stringify({ packageUrl, documentation: {
    written, read: { ...read, artifacts: await Promise.all(read.artifacts.map(async ({ at, file }) => ({
      at, path: file.path, text: new TextDecoder().decode(file.bytes), disk: await readFile(join(root, file.path), 'utf8'),
    }))) }, search,
  } }));
} catch (error) {
  process.stdout.write(JSON.stringify({ packageUrl, error: { code: error.code, message: error.message, url: error.url } }));
  process.exitCode = 1;
}
