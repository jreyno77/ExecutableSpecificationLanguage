import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { Compiler, ConfigurationReader, FileProjectWriter, Outputs, ProjectConnector,
  SourceComposer, SourceLoader, SpecificationIdentity, TypeScriptContext, acceptanceOutput, typescriptOutput } from 'executable-specification-language';

// An ordinary installed-library host. Its confirmed baseline is outside the connected project.
const request = JSON.parse(await readFile('store-game-request.json', 'utf8'));
const settings = JSON.parse(await readFile('store-game-host.json', 'utf8'));
const value = result => { assert.ok(result.value, JSON.stringify(result)); return result.value; };
const identities = new SpecificationIdentity(randomUUID), outputs = new Outputs();
outputs.register(typescriptOutput); outputs.register(acceptanceOutput);
const manifest = resolve('expec.json');
const configuration = value(new ConfigurationReader(outputs.profiles).read({ sourceId: manifest, text: await readFile(manifest, 'utf8') }));
const loaded = value(await new SourceLoader(manifest).load(configuration, { modules: [], packages: [] }));
const specification = value(new Compiler().compile({ resolution: new SourceComposer(loaded.locate).compose(loaded.entries) }));
const connection = value(await new ProjectConnector(manifest).connect(configuration));
assert.equal(connection.status, 'connected');
const context = new TypeScriptContext(connection.context, { configFile: 'tsconfig.json',
  ...(request.command === 'verification' ? { imports: ['vitest'] } : {}) });
const writer = new FileProjectWriter(context);
const modules = [...new Set([specification.entry, ...[...specification.inspection.query('class'), ...specification.inspection.query('opaque-type-declaration')]
  .map(item => item.origin.module)])];
const options = { directory: 'src', configFile: 'tsconfig.json', adoptExisting: true,
  imports: ['SystemConfig', 'PlayerStateSnapshot'].map(name => ({ module: pathToFileURL(resolve('models.expec')).href,
    declaration: [name], name, ...(settings.layout === 'distributed' ? { from: './models.js', as: name === 'SystemConfig' ? 'Configuration' : 'Snapshot' } : {}) })) };
const output = value(outputs.open('typescript', options, context, writer, { workspaceModules: modules }));
let baseline;
try {
  const text = settings.layout === 'generated'
    ? JSON.stringify(JSON.parse(await readFile('project/.expec/identity.json', 'utf8')).baseline)
    : await readFile('store-game.identity.json', 'utf8');
  baseline = value(identities.read({ sourceId: 'store-game.identity.json', text }));
}
catch (error) { if (error.code !== 'ENOENT') throw error; }
const qualified = (item, inspection) => {
  const parent = inspection.parent(item.id);
  return parent && ['class', 'concept', 'interface'].includes(parent.kind) ? parent.name + '.' + item.name : item.name;
};
const items = [...specification.inspection.query('class'), ...specification.inspection.query('capability')];
const item = name => { const found = items.filter(item => qualified(item, specification.inspection) === name); assert.equal(found.length, 1, name); return found[0]; };
const names = baseline => {
  const result = {};
  for (const record of baseline?.elements ?? []) {
    if (!['class', 'capability'].includes(record.address.kind)) continue;
    const parent = baseline.elements.find(parent => parent.id === record.address.owner);
    result[(parent ? parent.address.name + '.' : '') + record.address.name] = record.id;
  }
  return result;
};
let written, read, search, current;
if (['adopt', 'update'].includes(request.command)) {
  const decisions = (request.decisions ?? []).map(decision => 'retire' in decision ? decision : { id: decision.id, to: item(decision.to).id });
  current = value(identities.associate(specification, baseline, decisions));
  if (request.command === 'adopt') {
    const root = { kind: 'class', name: 'StoreGame' };
    const mapped = ['StoreGame', 'StoreGame.startup', 'StoreGame.save', 'StoreGame.delete', 'StoreGame.new', 'StoreGame.shutDown'].map(name => ({
      specId: current.id(item(name).id), locator: { outputId: 'typescript', format: 'typescript-symbol-1', value: {
        file: 'src/game.ts', declaration: name === 'StoreGame' ? [root] : [root, { kind: 'method', name: name.split('.')[1], static: false }],
      } },
    }));
    current = value(identities.withArtifacts(current, mapped));
    written = await output.create(current);
  } else written = await output.update(value(identities.compare(baseline, current)), current);
  if (written.artifacts && ['applied', 'unchanged'].includes(written.receipt?.status)) {
    current = value(identities.withArtifacts(current, [...current.baseline.artifacts.filter(artifact => artifact.locator.outputId !== 'typescript'), ...written.artifacts]));
    // If this host write fails, the process fails; applied project changes are not misreported as rolled back.
    await writeFile('store-game.identity.json', value(identities.write(current.baseline)));
    baseline = current.baseline;
  }
}
if (request.command === 'read') read = await output.read(names(baseline)[request.subject]);
if (request.command === 'search') search = await output.search(names(baseline)[request.subject]);
if (request.command === 'verification') {
  current = value(identities.associate(specification, baseline));
  const tests = value(outputs.open('acceptance', { domain: 'persistence', configFile: 'tsconfig.json' }, context, writer, { workspaceModules: modules }));
  written = await tests.create(current);
  if (written.artifacts && ['applied', 'unchanged'].includes(written.receipt?.status)) {
    current = value(identities.withArtifacts(current, [...current.baseline.artifacts.filter(artifact => artifact.locator.outputId !== 'acceptance'), ...written.artifacts]));
    await writeFile('store-game.identity.json', value(identities.write(current.baseline))); baseline = current.baseline;
  }
}
const captured = await context.readSnapshot(), files = Object.fromEntries(captured.files.map(file => [file.path, Buffer.from(file.bytes).toString('utf8')]));
const classes = [], imports = [];
for (const [path, text] of Object.entries(files)) if (path.endsWith('.ts')) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  for (const node of file.statements) {
    if (ts.isClassDeclaration(node)) classes.push({ file: path, name: node.name?.text,
      methods: node.members.filter(ts.isMethodDeclaration).map(method => ({ name: method.name.getText(file), body: method.body?.getText(file),
        start: method.name.getStart(file), end: method.name.end, private: !!ts.getModifiers(method)?.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword) })) });
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings))
      imports.push(...node.importClause.namedBindings.elements.map(binding => ({ file: path, imported: binding.propertyName?.text ?? binding.name.text,
        local: binding.name.text, from: node.moduleSpecifier.text })));
  }
}
const declared = items.map(node => ({ name: qualified(node, specification.inspection), origin: node.origin,
  dependencies: node.kind === 'class' ? node.members.filter(member => member.kind === 'depends-on').flatMap(member => member.references.map(reference => {
    assert.equal(reference.resolution.status, 'bound'); return specification.inspection.read(reference.resolution.target).name;
  })) : [] }));
const result = { written, read: read && { ...read, artifacts: read.artifacts.map(artifact => ({ at: artifact.at, file: { ...artifact.file, bytes: undefined,
  text: Buffer.from(artifact.file.bytes).toString('utf8') } })) }, search, files, classes, imports, declared, ids: names(baseline),
  artifacts: baseline?.artifacts, baseline: baseline && value(identities.write(baseline)),
  packageUrl: import.meta.resolve('executable-specification-language') };
await writeFile('store-game-report.json', JSON.stringify(result));
