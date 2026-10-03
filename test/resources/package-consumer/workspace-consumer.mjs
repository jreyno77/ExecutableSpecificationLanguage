import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConfigurationReader, SourceLoader, SourceComposer, Compiler, SpecificationIdentity } from 'executable-specification-language';

const input = JSON.parse(await readFile('workspace.json', 'utf8'));
await mkdir('spec');
for (const [name, source] of Object.entries(input.files)) await writeFile(resolve('spec', name), source);
const filename = resolve('spec/expec.json');
await writeFile(filename, JSON.stringify({ formatVersion: 1, version: '0.1.0',
  project: { root: '../project' }, build: { entries: input.entries }, libraries: [], packages: [], outputs: [] }));
const config = new ConfigurationReader([]).read({ sourceId: filename, text: await readFile(filename, 'utf8') });
if (!config.value) throw Error(JSON.stringify(config));
const loaded = await new SourceLoader(filename).load(config.value, { modules: [], packages: [] });
if (!loaded.value) throw Error(JSON.stringify(loaded));
const compilation = new Compiler().compile({ resolution: new SourceComposer(loaded.value.locate).compose(loaded.value.entries) });
if (!compilation.value) throw Error(JSON.stringify(compilation));
let next = 0;
const identified = new SpecificationIdentity(() => 'installed-' + ++next).associate(compilation.value);
if (!identified.value) throw Error(JSON.stringify(identified));
const inspection = compilation.value.inspection;
const callables = [...inspection.query('function')];
const books = [...inspection.query('record-type-declaration')].filter(item => item.name === 'Book');
if (books.length !== 1) throw Error('Expected the single authored Book declaration.');
const book = books[0], bookType = compilation.value.types.declaredType(book.id);
const parameters = callables.flatMap(item => compilation.value.types.callable(item.id).parameters);
const bookId = identified.value.id(book.id);
console.log(JSON.stringify({ packageUrl: import.meta.resolve('executable-specification-language'), workspace: {
  functions: callables.map(item => item.name).sort(), books: books.map(item => item.name), parameters: parameters.length,
  bothParametersUseBook: parameters.every(parameter => parameter.type.status === 'known' && parameter.type.value === bookType),
  bookIdentityRecords: identified.value.baseline.elements.filter(record => record.id === bookId).length,
} }));
