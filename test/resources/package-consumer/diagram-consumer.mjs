import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { guarded, observations, proveGuards } from './diagram-guard.mjs';

let packageUrl;
try {
  packageUrl = import.meta.resolve('executable-specification-language');
  const { Compiler, SpecificationIdentity, ConfigurationReader, ProjectConnector, FileProjectWriter, Outputs, umlOutput } =
    await import('executable-specification-language');
  const input = JSON.parse(await readFile(process.argv[2], 'utf8')), root = join(process.cwd(), 'project');
  await mkdir(root);
  const canary = join(root, 'private.txt');
  await writeFile(canary, 'Keep private.');
  const canaries = await proveGuards(canary), outputs = new Outputs();
  outputs.register({ ...umlOutput, open(options) {
    const adapter = umlOutput.open(options);
    return { id: adapter.id,
      plan: (request, snapshot) => guarded(() => adapter.plan(request, snapshot)),
      read: (id, snapshot) => guarded(() => adapter.read(id, snapshot)),
      search: (id, snapshot) => guarded(() => adapter.search(id, snapshot)),
    };
  } });
  const configuration = new ConfigurationReader(outputs.profiles).read({ sourceId: 'settings', text: JSON.stringify({
    formatVersion: 1, version: '0.1.0', project: { root: 'project' }, build: { entries: ['main.expec'] },
    outputs: [{ id: 'uml', options: { directory: 'design', views: ['structure'] } }],
  }) });
  if (!configuration.value) throw Error(JSON.stringify(configuration));
  const connected = await new ProjectConnector(join(process.cwd(), 'expec.json')).connect(configuration.value);
  if (connected.value?.status !== 'connected') throw Error(JSON.stringify(connected));
  const context = connected.value.context, opened = outputs.open('uml', configuration.value.outputs[0].options, context, new FileProjectWriter(context));
  if (!opened.value) throw Error(JSON.stringify(opened));
  const compilation = new Compiler().compile({ source: { sourceId: 'main.expec', text: input.source },
    locator: 'main', dependencies: { modules: [], packages: [] } });
  if (!compilation.value) throw Error(JSON.stringify(compilation));
  let next = 0;
  const identified = new SpecificationIdentity(() => 'installed-diagram-' + ++next).associate(compilation.value);
  if (!identified.value) throw Error(JSON.stringify(identified));
  const subject = [...compilation.value.inspection.query('concept')].find(item => item.name === 'Store');
  if (!subject) throw Error('Consumer source must declare Store.');
  const id = identified.value.id(subject.id), output = opened.value;
  const written = await output.create(identified.value), read = await output.read(id), search = await output.search(id);
  const { D2 } = await import('@d2lang/d2');
  const native = await guarded(async () => {
    const engine = new D2();
    try {
      const source = read.artifacts.find(item => item.file.path === 'design/structure.d2');
      if (!source) return [];
      const result = await engine.compile({ fs: { 'design/structure.d2': new TextDecoder().decode(source.file.bytes) }, inputPath: 'design/structure.d2' });
      return result.diagram.shapes.map(shape => ({ label: shape.label, methods: shape.methods }));
    } finally { await engine.dispose(); }
  });
  const guards = await observations();
  process.stdout.write(JSON.stringify({ packageUrl, diagram: {
    written, native, read: { ...read, artifacts: await Promise.all(read.artifacts.map(async ({ at, file }) => ({
      at, path: file.path, text: new TextDecoder().decode(file.bytes), disk: await readFile(join(root, file.path), 'utf8'),
    }))) }, search, guards, canaries, private: await readFile(canary, 'utf8'),
  } }));
} catch (error) {
  process.stdout.write(JSON.stringify({ packageUrl, error: { code: error.code, message: error.message, url: error.url } }));
  process.exitCode = 1;
}
