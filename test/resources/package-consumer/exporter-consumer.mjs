import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { serialize, deserialize } from 'node:v8';
import { Compiler, ConfigurationReader, FileProjectWriter, Outputs, ProjectConnector, SpecificationIdentity, runCli } from 'executable-specification-language';
import { signaturesOutput } from './signatures-output.js';

const [action, argument] = process.argv.slice(2);
const value = check => { assert.ok(check.value, JSON.stringify(check)); return check.value; };
const identities = new SpecificationIdentity(randomUUID);
const outputs = new Outputs(); outputs.register(signaturesOutput);
const configuration = value(new ConfigurationReader(outputs.profiles).read({ sourceId: 'expec.json', text: await readFile('expec.json', 'utf8') }));
const connection = value(await new ProjectConnector(resolve('expec.json')).connect(configuration));
assert.equal(connection.status, 'connected');
const context = connection.context, writer = new FileProjectWriter(context);
const output = value(outputs.open('signatures', { destination: 'contracts.ndjson' }, context, writer));
const compile = async () => value(new Compiler().compile({ source: { sourceId: 'main.expec', text: await readFile('main.expec', 'utf8') }, locator: 'main', dependencies: { modules: [], packages: [] } }));
const save = report => writeFile('observed.json', JSON.stringify(report));
if (action === 'cli') {
  process.exitCode = await runCli(['build', '--config', resolve('expec.json'), '--json', ...(argument ? ['--decisions', resolve(argument)] : [])], { contracts: [signaturesOutput] });
} else if (action === 'duplicate') {
  let message;
  try { outputs.register(signaturesOutput); } catch (error) { message = String(error); }
  await save({ message });
} else if (action === 'query') {
  const read = await output.read(argument), search = await output.search(argument);
  await save({ read: { ...read, artifacts: read.artifacts.map(artifact => ({ ...artifact, text: new TextDecoder().decode(artifact.file.bytes) })) }, search });
} else if (action === 'create') {
  const current = value(identities.associate(await compile()));
  const result = await output.create(current);
  assert.ok(result.receipt && result.receipt.status !== 'stopped', JSON.stringify(result));
  await writeFile('author-baseline.json', value(identities.write(value(identities.withArtifacts(current, result.artifacts)).baseline)));
  await save(result);
} else if (action === 'plan') {
  const before = value(identities.read({ sourceId: 'author-baseline.json', text: await readFile('author-baseline.json', 'utf8') }));
  const specification = await compile();
  const selected = [...specification.inspection.query('function')].find(item => item.name === 'saveGame');
  assert.ok(selected);
  const current = value(identities.associate(specification, before, [{ id: argument, to: selected.id }]));
  const plan = value(await output.plan({ operation: 'update', current, diff: value(identities.compare(before, current)) }, await context.readSnapshot()));
  await writeFile('prepared-plan.bin', serialize(plan));
  await save({ planned: true, changes: plan.changes.length });
} else if (action === 'apply') {
  await save(await writer.apply(deserialize(await readFile('prepared-plan.bin'))));
} else if (action === 'imports') {
  let privateDenied;
  try { await import('executable-specification-language/dist/index.js'); } catch (error) { privateDenied = error.code; }
  await save({ entry: import.meta.resolve('executable-specification-language'), privateDenied });
}

