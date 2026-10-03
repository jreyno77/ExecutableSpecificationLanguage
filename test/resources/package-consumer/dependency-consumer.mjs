import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ConfigurationReader, LibraryLoader, NpmDependencies, DependencyPlanner, SourceLoader, SourceComposer, Compiler,
} from 'executable-specification-language';

const input = JSON.parse(await readFile('dependencies.json', 'utf8'));
const packageUrl = import.meta.resolve('executable-specification-language');
const configuration = new ConfigurationReader([]).read({ sourceId: pathToFileURL(join(input.root, 'expec.json')).href,
  text: JSON.stringify({ formatVersion: 1, version: '0.1.0', build: { entries: ['main.expec'] },
    libraries: [{ module: 'books', version: '^1', source: './libraries/books' }],
    packages: [{ alias: 'storage', name: 'npm:example-storage', version: '^2', phases: ['runtime'] }] }) });
if (!configuration.value) throw Error(JSON.stringify(configuration));
const native = new NpmDependencies(input.root, { command: input.command });
if (process.argv[2] === 'install') console.log(JSON.stringify({ packageUrl, acquisition: { packages: await native.install(configuration.value.packages) } }));
else {
  await writeFile(join(input.root, 'main.expec'), input.source);
  const libraries = await new LibraryLoader(join(input.root, 'expec.json')).load(configuration.value);
  const packages = await native.read(configuration.value.packages);
  const report = { packages, fields: [], workspace: [], libraryOrigins: [], problems: [...libraries.problems, ...packages.problems], syntax: libraries.syntax };
  if (libraries.value && packages.value) {
    const selected = new DependencyPlanner().resolve(configuration.value, { modules: libraries.value.inventory, packages: packages.value });
    report.problems.push(...selected.problems);
    if (selected.value) {
      const loaded = await new SourceLoader(join(input.root, 'expec.json')).load(configuration.value, selected.value, libraries.value);
      report.problems.push(...loaded.problems); report.syntax.push(...loaded.syntax);
      report.workspace = loaded.captures.filter(item => item.model).map(item => item.source.sourceId);
      report.libraryOrigins = libraries.captures.filter(item => item.model).map(item => item.source.sourceId);
      if (loaded.value) for (const { entry, dependencies } of loaded.value.entries) {
        const checked = new Compiler().compile({ resolution: new SourceComposer(loaded.value.locate).compose(entry, dependencies) });
        report.problems.push(...checked.problems);
        if (checked.value) for (const declaration of checked.value.inspection.query('record-type-declaration')) {
          for (const field of declaration.fields.filter(item => item.kind === 'field')) {
            const fact = checked.value.types.typeOf(field.declaredType.id);
            if (fact.status !== 'known') throw Error('Missing type fact');
            let description = checked.value.types.describe(fact.value);
            while (description.kind === 'alias' && description.target.status === 'known') description = checked.value.types.describe(description.target.value);
            report.fields.push({ name: declaration.name + '.' + field.name, type: checked.value.inspection.read(description.declaration).name });
          }
        }
      }
    }
  }
  console.log(JSON.stringify({ packageUrl, acquisition: report }));
}
