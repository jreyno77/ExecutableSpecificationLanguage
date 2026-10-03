import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

let packageUrl;
try {
  packageUrl = import.meta.resolve('executable-specification-language');
  const { ConfigurationReader, ProjectConnector, TypeScriptProject } = await import('executable-specification-language');
  const input = JSON.parse(await readFile(process.argv[2], 'utf8')), root = join(process.cwd(), 'project');
  await mkdir(root);
  for (const [name, text] of Object.entries(input.files)) await writeFile(join(root, name), text);
  const configuration = new ConfigurationReader([]).read({ sourceId: 'settings', text: JSON.stringify({
    formatVersion: 1, version: '0.1.0', project: { root: 'project' }, build: { entries: ['main.expec'] },
  }) });
  if (!configuration.value) throw Error(JSON.stringify(configuration.problems));
  const connected = await new ProjectConnector(join(process.cwd(), 'expec.json')).connect(configuration.value);
  if (connected.value?.status !== 'connected') throw Error(JSON.stringify(connected));
  const snapshot = await connected.value.context.readSnapshot();
  const reader = new TypeScriptProject({ outputId: 'typescript' }, [{
    specId: 'store', locator: { outputId: 'typescript', format: 'typescript-symbol-1',
      value: { file: 'store.ts', declaration: [{ kind: 'class', name: 'StoreGame' }] } },
  }]);
  const read = reader.read('store', snapshot), search = reader.search('store', snapshot);
  const require = createRequire(packageUrl), manifest = require('typescript/package.json');
  process.stdout.write(JSON.stringify({ packageUrl, projectReading: {
    read: { ...read, artifacts: read.artifacts.map(artifact => ({
      at: artifact.at, file: artifact.file.path, text: new TextDecoder().decode(artifact.file.bytes),
    })) }, search,
    files: Object.fromEntries(await Promise.all(Object.keys(input.files).map(async name => [name, await readFile(join(root, name), 'utf8')]))),
    versions: Object.fromEntries(snapshot.files.map(file => [file.path, file.version])),
    typescript: { version: manifest.version, location: require.resolve('typescript') },
  } }));
} catch (error) {
  process.stdout.write(JSON.stringify({ packageUrl, error: { code: error.code, message: error.message, url: error.url } }));
  process.exitCode = 1;
}
