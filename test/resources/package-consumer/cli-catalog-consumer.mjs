import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { runCli } from 'executable-specification-language';

const input = JSON.parse(await readFile('catalog-input.json', 'utf8'));
const packageUrl = import.meta.resolve('executable-specification-language');
let checkoutDenied, privateImportDenied;
try { await readFile(input.checkoutFile); } catch (error) { checkoutDenied = error.code; }
try { await import('executable-specification-language/dist/index.js'); } catch (error) { privateImportDenied = error.code; }
assert.equal(checkoutDenied, 'ERR_ACCESS_DENIED');
assert.equal(privateImportDenied, 'ERR_PACKAGE_PATH_NOT_EXPORTED');

const at = { outputId: 'catalog', format: 'catalog-1', value: 'catalog.txt' };
const coverage = { scope: [at], complete: false, limitations: ['This small profile only creates a signature catalog.'] };
const problem = message => ({ code: 'catalog-output', message, at: { kind: 'dependency', path: ['catalog'] }, related: [] });
const known = fact => { assert.equal(fact.status, 'known'); return fact.value; };
const catalog = {
  id: 'catalog',
  validate: options => Object.keys(options).length ? [{ path: [], message: 'No options are needed.' }] : [],
  open: () => ({
    id: 'catalog',
    async plan(request, basedOn) {
      if (request.operation !== 'create' || basedOn.files.some(file => file.path === 'catalog.txt'))
        return { problems: [problem('This profile creates a new catalog without replacing existing files.')], deferred: [] };
      const { inspection, types } = request.current.specification;
      const typeName = id => {
        const type = types.describe(id);
        assert.equal(type.kind, 'builtin', 'This catalog example supports primitive types.');
        return inspection.read(type.declaration).name;
      };
      const functions = [...inspection.query('function')];
      const text = functions.map(fn => {
        const signature = types.callable(fn.id), result = known(signature.result);
        const parameters = signature.parameters.map(parameter => inspection.read(parameter.declaration).name + ': ' + typeName(known(parameter.type)));
        assert.notEqual(result.kind, 'unspecified');
        return fn.name + '(' + parameters.join(', ') + ') returns ' + (result.kind === 'none' ? 'Nothing' : typeName(result.type)) + '\n';
      }).join('');
      return { value: { outputId: 'catalog', basedOn,
        changes: [{ kind: 'write', path: 'catalog.txt', bytes: new TextEncoder().encode(text) }],
        artifacts: functions.map(fn => ({ specId: request.current.id(fn.id), locator: { ...at, value: { path: 'catalog.txt', name: fn.name } } })) },
        problems: [], deferred: [] };
    },
    async read() { return { artifacts: [], coverage, problems: [] }; },
    async search(subject) {
      return { definitions: [], problems: [], incoming: { subject, direction: 'incoming', coverage, uses: [], unresolved: [] },
        outgoing: { subject, direction: 'outgoing', coverage, uses: [], unresolved: [] } };
    },
  }),
};
await mkdir('spec'); await mkdir('project');
await writeFile('spec/main.expec', input.source);
await writeFile('spec/expec.json', JSON.stringify({ formatVersion: 1, version: '1.2.3', project: { root: '../project' },
  build: { entries: ['main.expec'] }, outputs: [{ id: 'catalog', options: {} }] }));
await writeFile('project/notes.txt', 'Keep this handwritten note.');
process.exitCode = await runCli(['build', '--config', 'spec/expec.json', '--json'], { contracts: [catalog] });
await writeFile('catalog-observed.json', JSON.stringify({ packageUrl, checkoutDenied, privateImportDenied,
  catalog: await readFile('project/catalog.txt', 'utf8'), note: await readFile('project/notes.txt', 'utf8') }));
