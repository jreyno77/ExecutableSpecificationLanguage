import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const settings = JSON.parse(await readFile(new URL('./selection.json', import.meta.url), 'utf8'));
const { runCli, acceptanceOutput } = await import(pathToFileURL(settings.library).href);
const open = acceptanceOutput.open;
acceptanceOutput.open = function (...args) {
  const adapter = open.apply(this, args); let changed = false;
  return { ...adapter, async search(...query) {
    const result = await adapter.search(...query);
    if (!changed) {
      const text = await readFile(settings.file, 'utf8');
      if (!text.includes(settings.from)) throw Error('The generated assertion to change must exist.');
      await writeFile(settings.file, text.replace(settings.from, settings.to)); changed = true;
    }
    return result;
  } };
};
process.exitCode = await runCli(process.argv.slice(2));
