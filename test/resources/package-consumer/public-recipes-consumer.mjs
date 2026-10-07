import { readFile, readdir, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import { SpecificationIdentity } from 'executable-specification-language';
import { buildWorkspace } from './workspace-build.mjs';
import { adoptStoreGame, readStoreGame } from './adopt-store-game.mjs';
const action = process.argv[2];
let report;
if (action === 'workspace') {
  const { current, written } = await buildWorkspace('expec.json', 'author.identity.json');
  const { inspection, types } = current.specification;
  const books = [...inspection.query('record-type-declaration')].filter(item => item.name === 'Book');
  const functions = [...inspection.query('function')], bookType = books.length === 1 ? types.declaredType(books[0].id) : undefined;
  const parameters = functions.flatMap(fn => types.callable(fn.id).parameters);
  report = { written, functions: functions.map(fn => fn.name), books: books.map(book => current.id(book.id)),
    allParametersUseBook: bookType !== undefined && parameters.length === 2 && parameters.every(parameter => parameter.type.status === 'known' && parameter.type.value === bookType),
    bookRecords: books.length === 1 ? current.baseline.elements.filter(row => row.id === current.id(books[0].id)).length : 0 };
} else if (action === 'adopt') {
  const { written } = await adoptStoreGame('expec.json', 'author.identity.json'); report = { written };
} else if (action === 'read') {
  const { read, search } = await readStoreGame('expec.json', 'author.identity.json');
  report = { read: { ...read, artifacts: read.artifacts.map(artifact => ({ ...artifact, text: new TextDecoder().decode(artifact.file.bytes) })) }, search };
} else if (action === 'baseline') {
  const ids = new SpecificationIdentity(() => { throw Error('Reading a baseline must not allocate identity.'); });
  const read = ids.read({ sourceId: 'author.identity.json', text: await readFile('author.identity.json', 'utf8') });
  const written = read.value && ids.write(read.value);
  report = { valid: !!written?.value, artifacts: read.value?.artifacts };
} else if (action === 'native') {
  const declarations = [];
  const inspect = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = directory + '/' + entry.name;
      if (entry.isDirectory()) await inspect(file);
      else if (entry.isFile() && entry.name.endsWith('.ts')) {
        const parsed = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
        const visit = node => {
          if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) declarations.push({ file, name: node.name?.text });
          ts.forEachChild(node, visit);
        };
        visit(parsed);
      }
    }
  };
  await inspect('project/src'); report = { declarations };
}
await writeFile('recipe-observed.json', JSON.stringify(report));
