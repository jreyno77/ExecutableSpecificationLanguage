import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Compiler, ConfigurationReader, FileProjectWriter, Outputs, ProjectConnector,
  SourceComposer, SourceLoader, SpecificationIdentity, TypeScriptContext, typescriptOutput } from 'executable-specification-language';

const checked = result => {
  if (!result.value) throw Error(JSON.stringify({ problems: result.problems, syntax: result.syntax, deferred: result.deferred }));
  return result.value;
};
const identity = () => new SpecificationIdentity(randomUUID);
async function project(manifest) {
  manifest = resolve(manifest);
  const outputs = new Outputs(); outputs.register(typescriptOutput);
  const configuration = checked(new ConfigurationReader(outputs.profiles).read({ sourceId: manifest, text: await readFile(manifest, 'utf8') }));
  if (configuration.libraries.length || configuration.packages.length) throw Error('Acquire and supply external dependencies explicitly before extending this local recipe.');
  const loaded = checked(await new SourceLoader(manifest).load(configuration, { modules: [], packages: [] }));
  const specification = checked(new Compiler().compile({ resolution: new SourceComposer(loaded.locate).compose(loaded.entries) }));
  const connection = checked(await new ProjectConnector(manifest).connect(configuration));
  if (connection.status !== 'connected') throw Error('Connect the handwritten project before adoption.');
  const context = new TypeScriptContext(connection.context, { configFile: 'tsconfig.json' });
  const output = checked(outputs.open('typescript', { directory: 'src', configFile: 'tsconfig.json', adoptExisting: true },
    context, new FileProjectWriter(context), { workspaceModules: [specification.entry] }));
  return { specification, output };
}
function selected(specification) {
  const owners = [...specification.inspection.query('class')].filter(item => item.name === 'StoreGame');
  if (owners.length !== 1) throw Error('Select one authored StoreGame class.');
  const methods = [...specification.inspection.query('capability')].filter(item =>
    item.name === 'save' && specification.inspection.parent(item.id)?.id === owners[0].id);
  if (methods.length !== 1) throw Error('Select its one authored save capability.');
  return { owner: owners[0], method: methods[0] };
}

/** Concrete explicit mapping; adapt these selectors deliberately for another native layout. */
export async function adoptStoreGame(manifest, identityFile) {
  const { specification, output } = await project(manifest), ids = identity();
  let previous;
  try { previous = checked(ids.read({ sourceId: identityFile, text: await readFile(identityFile, 'utf8') })); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let current = checked(ids.associate(specification, previous));
  const { owner, method } = selected(specification), root = { kind: 'class', name: 'StoreGame' };
  if (!previous) current = checked(ids.withArtifacts(current, [
    { specId: current.id(owner.id), locator: { outputId: 'typescript', format: 'typescript-symbol-1',
      value: { file: 'src/game.ts', declaration: [root] } } },
    { specId: current.id(method.id), locator: { outputId: 'typescript', format: 'typescript-symbol-1',
      value: { file: 'src/game.ts', declaration: [root, { kind: 'method', name: 'save', static: false }] } } },
  ]));
  const written = await output.create(current);
  if (written.receipt?.status === 'applied' || written.receipt?.status === 'unchanged') {
    current = checked(ids.withArtifacts(current, written.artifacts));
    await writeFile(identityFile, checked(ids.write(current.baseline)));
  }
  return { current, written };
}

/** Read current native files and references using the host's confirmed public baseline. */
export async function readStoreGame(manifest, identityFile) {
  const { specification, output } = await project(manifest), ids = identity();
  const baseline = checked(ids.read({ sourceId: identityFile, text: await readFile(identityFile, 'utf8') }));
  const current = checked(ids.associate(specification, baseline)), { owner, method } = selected(specification);
  return { current, read: await output.read(current.id(owner.id)), search: await output.search(current.id(method.id)) };
}
