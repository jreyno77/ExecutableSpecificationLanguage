import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

let packageUrl;
try {
  packageUrl = import.meta.resolve('executable-specification-language');
  const { Compiler, SpecificationIdentity, ConfigurationReader, ProjectConnector, FileProjectWriter, Outputs } = await import('executable-specification-language');
  const { countOutput } = await import('./count-adapter.mts');
  const input = JSON.parse(await readFile('output.json', 'utf8')), root = join(process.cwd(), 'project');
  const outputs = new Outputs();
  outputs.register(countOutput);
  const configuration = new ConfigurationReader(outputs.profiles).read({ sourceId: 'settings', text: JSON.stringify({
    formatVersion: 1, version: '0.1.0', project: { root: 'project' }, build: { entries: ['main.expec'] },
    outputs: [{ id: 'declaration-count', options: input.options }],
  }) });
  if (!configuration.value) throw Error(JSON.stringify(configuration));
  const connection = await new ProjectConnector(join(process.cwd(), 'expec.json')).connect(configuration.value);
  if (connection.value?.status !== 'connected') throw Error(JSON.stringify(connection));
  const context = connection.value.context, selected = configuration.value.outputs[0];
  const opened = outputs.open(selected.id, selected.options, context, new FileProjectWriter(context));
  if (!opened.value) throw Error(JSON.stringify(opened));
  const output = opened.value, command = process.argv[2];
  let result;
  if (command === 'create') {
    const compilation = new Compiler().compile({ source: { sourceId: 'main.expec', text: input.text },
      locator: 'main', dependencies: { modules: [], packages: [] } });
    if (!compilation.value) throw Error(JSON.stringify(compilation));
    let issued = 0;
    const identity = new SpecificationIdentity(() => 'installed-' + ++issued).associate(compilation.value);
    if (!identity.value) throw Error(JSON.stringify(identity));
    const write = await output.create(identity.value);
    const file = await readFile(join(root, input.options.directory, 'counts.json'), 'utf8');
    result = { write, file, counts: JSON.parse(file), handwritten: await readFile(join(root, 'handwritten.txt'), 'utf8') };
  } else if (command === 'read') {
    const read = await output.read(input.subjectId);
    result = { read: { ...read, artifacts: await Promise.all(read.artifacts.map(async ({ at, file }) => ({ at,
      path: file.path, text: new TextDecoder().decode(file.bytes), disk: await readFile(join(root, file.path), 'utf8'),
    }))) } };
  } else if (command === 'consumer') {
    await mkdir(join(root, 'notes'), { recursive: true });
    const consumer = { format: 'declaration-count-1', title: input.title, subjects: [], references: [input.subjectId] };
    await writeFile(join(root, 'notes/release.counts.json'), JSON.stringify(consumer));
    result = { consumer };
  } else if (command === 'search') result = { search: await output.search(input.subjectId) };
  else throw Error('Unknown consumer operation');
  process.stdout.write(JSON.stringify({ packageUrl, output: result }));
} catch (error) {
  process.stdout.write(JSON.stringify({ packageUrl, error: { code: error.code, message: error.message, url: error.url } }));
  process.exitCode = 1;
}
