import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
let packageUrl;
try {
  packageUrl = import.meta.resolve('executable-specification-language');
  const { ConfigurationReader, ProjectConnector, TypeScriptContext, TypeScriptProject, FileProjectWriter } = await import('executable-specification-language');
  const root = process.cwd(), files = {
    'test/shopping.ts': 'import { expect } from "vitest"; export class Shopping { expectQuantity(actual: number, expected: number): void { expect(actual).toBe(expected); } }',
    'test/manual.ts': 'import { test } from "vitest"; import { Shopping } from "./shopping.js"; test("quantity", () => new Shopping().expectQuantity(1, 1));',
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', strict: true, types: ['node'], skipLibCheck: true }, include: ['test/**/*.ts'] }),
  };
  await mkdir(join(root, 'test'));
  for (const [path, text] of Object.entries(files)) await writeFile(join(root, path), text);
  const configuration = new ConfigurationReader([]).read({ sourceId: 'settings', text: JSON.stringify({
    formatVersion: 1, version: '0.1.0', project: { root: '.' }, build: { entries: ['main.expec'] },
  }) });
  if (!configuration.value) throw Error(JSON.stringify(configuration.problems));
  const connection = await new ProjectConnector(join(root, 'expec.json')).connect(configuration.value);
  if (connection.value?.status !== 'connected') throw Error(JSON.stringify(connection));
  const context = new TypeScriptContext(connection.value.context, { configFile: 'tsconfig.json', imports: ['vitest'] });
  const snapshot = await context.readSnapshot();
  const query = new TypeScriptProject({ outputId: 'native', configFile: 'tsconfig.json' }, [{
    specId: 'quantity', locator: { outputId: 'native', format: 'typescript-symbol-1', value: {
      file: 'test/shopping.ts', declaration: [{ kind: 'class', name: 'Shopping' }, { kind: 'method', name: 'expectQuantity', static: false }],
    } },
  }]);
  const search = query.search('quantity', snapshot);
  const changes = [{ kind: 'write', path: 'notes.txt', bytes: new TextEncoder().encode('Must not be written.') }];
  const declaration = 'node_modules/vitest/dist/index.d.ts';
  const originalText = await readFile(join(root, declaration), 'utf8');
  await writeFile(join(root, declaration), originalText + '\n// Installed consumer changes consulted evidence.\n');
  const receipt = await new FileProjectWriter(context).apply({ basedOn: snapshot, changes });
  let notesExist = true;
  try { await access(join(root, 'notes.txt')); } catch (error) { if (error.code !== 'ENOENT') throw error; notesExist = false; }
  const packages = {};
  for (const name of ['vitest', '@types/node']) packages[name] = JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
  process.stdout.write(JSON.stringify({ packageUrl, nativeContext: {
    complete: snapshot.complete, problems: snapshot.problems, search, files,
    editable: snapshot.files.map(file => file.path), readonly: (snapshot.readOnlyFiles ?? []).map(({ path, version }) => ({ path, version })),
    versions: Object.fromEntries(snapshot.files.map(({ path, version }) => [path, version])),
    receipt, notesExist, originalText, diskText: await readFile(join(root, declaration), 'utf8'),
    capturedText: new TextDecoder().decode(snapshot.readOnlyFiles?.find(file => file.path === declaration)?.bytes), packages,
  } }));
} catch (error) {
  process.stdout.write(JSON.stringify({ packageUrl, error: { code: error.code, message: error.message, url: error.url } }));
  process.exitCode = 1;
}
