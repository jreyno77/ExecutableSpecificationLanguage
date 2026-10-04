import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
const settings = JSON.parse(await readFile(new URL('./outputs.json', import.meta.url), 'utf8'));
const { runCli } = await import(pathToFileURL(settings.library).href);
const registration = item => ({ id: item.id, validate: () => [], open() { let owned = new Set(); return { id: item.id,
  async plan(request, basedOn) {
    if (item.afterPlan) { await mkdir(dirname(item.afterPlan.path), {recursive:true}); await writeFile(item.afterPlan.path, item.afterPlan.text); }
    owned = new Set(request.current.baseline.elements.filter(element => element.address.owner === null && (!item.subject || element.address.name === item.subject)).map(element => element.id));
    const locator = { outputId: item.id, format: 'fixture-file-1', value: { file: item.file } };
    return { value: { outputId: item.id, basedOn, changes: item.file ? [{ kind: 'write', path: item.file, bytes: Buffer.from(item.text) }] : [],
      artifacts: item.file ? [...owned].map(specId => ({ specId, locator: { ...locator, value: { file: item.file, subject: specId } } })) : [] }, problems: [], deferred: [] };
  },
  async read(id, basedOn) {
    const file = owned.has(id) ? basedOn.files.find(file => file.path === item.file) : undefined, at = { outputId: item.id, format: 'fixture-file-1', value: { file: item.file, subject: id } };
    return { artifacts: file ? [{ file, at }] : [], problems: [], coverage: { scope: [at], complete: !!file, limitations: file ? [] : ['missing fixture artifact'] } };
  },
  async search() { throw Error('This fixture does not provide native semantic search.'); },
}; } });
process.exitCode = await runCli(process.argv.slice(2), {
  contracts: settings.outputs.filter(item => item.stage === 'contracts').map(registration),
  tests: settings.outputs.filter(item => item.stage === 'tests').map(registration),
});
