import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const text = await readFile(process.argv[2], 'utf8');
let packageUrl;
try {
  packageUrl = import.meta.resolve('executable-specification-language');
  const { Compiler, ConfigurationReader, SourceLoader, SourceComposer } = await import('executable-specification-language');
  const result = new Compiler().compile({
    source: { sourceId: 'consumer.expec', text }, locator: 'consumer',
    dependencies: { modules: [], packages: [] },
  });
  const manifest = join(dirname(process.argv[2]), 'expec.json');
  const configuration = new ConfigurationReader([]).read({ sourceId: manifest, text: JSON.stringify({
    formatVersion: 1, version: '0.1.0', build: { entries: [basename(process.argv[2])] }
  }) });
  const loaded = await new SourceLoader(manifest).load(configuration.value, { modules: [], packages: [] });
  const entry = loaded.value?.entries[0];
  const checked = entry && new Compiler().compile({ resolution: new SourceComposer(loaded.value.locate).compose(entry.entry, entry.dependencies) });
  process.stdout.write(JSON.stringify({
    packageUrl, accepted: result.value !== undefined, syntax: result.syntax, deferred: result.deferred,
    problems: result.problems.map(problem => ({ ...problem,
      text: problem.at.kind === 'source'
        ? Array.from(text).slice(problem.at.range.start.offset, problem.at.range.end.offset).join('') : undefined,
    })),
    capabilities: result.value ? [...result.value.inspection.query('capability')].map(item => item.name) : [],
    loaded: { accepted: checked?.value !== undefined, captures: loaded.captures.length,
      capabilities: checked?.value ? [...checked.value.inspection.query('capability')].map(item => item.name) : [],
      problems: loaded.problems, syntax: loaded.syntax },
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({ packageUrl, error: { code: error.code, message: error.message, url: error.url } }));
  process.exitCode = 1;
}
