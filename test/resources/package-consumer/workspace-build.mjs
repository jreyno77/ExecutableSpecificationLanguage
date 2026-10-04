import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Compiler, ConfigurationReader, FileProjectWriter, Outputs, ProjectConnector,
  SourceComposer, SourceLoader, SpecificationIdentity, TypeScriptContext, typescriptOutput } from 'executable-specification-language';

const checked = result => {
  if (!result.value) throw Error(JSON.stringify({ problems: result.problems, syntax: result.syntax, deferred: result.deferred }));
  return result.value;
};

/** Local-source recipe. Supply a configured native project and an identity file outside it. */
export async function buildWorkspace(manifest, identityFile) {
  manifest = resolve(manifest);
  const outputs = new Outputs(); outputs.register(typescriptOutput);
  const configuration = checked(new ConfigurationReader(outputs.profiles).read({ sourceId: manifest, text: await readFile(manifest, 'utf8') }));
  if (configuration.libraries.length || configuration.packages.length) throw Error('This local-source recipe requires explicitly supplied dependency acquisition for libraries or packages.');
  const selected = configuration.outputs.find(output => output.id === 'typescript');
  if (!selected || configuration.outputs.length !== 1) throw Error('Select one typescript output for this recipe.');
  const loaded = await new SourceLoader(manifest).load(configuration, { modules: [], packages: [] });
  const workspace = checked(loaded);
  // Compile one composition, not a separate output invocation per entry.
  const specification = checked(new Compiler().compile({ resolution: new SourceComposer(workspace.locate).compose(workspace.entries) }));
  const identity = new SpecificationIdentity(randomUUID);
  let previous;
  try { previous = checked(identity.read({ sourceId: identityFile, text: await readFile(identityFile, 'utf8') })); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let current = checked(identity.associate(specification, previous));
  const connection = checked(await new ProjectConnector(manifest).connect(configuration));
  if (connection.status !== 'connected') throw Error('Connect the native project before running this recipe.');
  const context = new TypeScriptContext(connection.context, selected.options.configFile ? { configFile: selected.options.configFile } : {});
  const output = checked(outputs.open('typescript', selected.options, context, new FileProjectWriter(context), {
    workspaceModules: loaded.captures.flatMap(capture => capture.model ? [capture.model.locator] : []),
  }));
  const written = previous ? await output.update(checked(identity.compare(previous, current)), current) : await output.create(current);
  if (written.receipt?.status === 'applied' || written.receipt?.status === 'unchanged') {
    current = checked(identity.withArtifacts(current, written.artifacts));
    // A persistence failure is reported; already applied native files are not rolled back.
    await writeFile(identityFile, checked(identity.write(current.baseline)));
  }
  return { current, written };
}
