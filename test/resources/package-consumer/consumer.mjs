import { readFile } from 'node:fs/promises';

const text = await readFile(process.argv[2], 'utf8');
let packageUrl;
try {
  packageUrl = import.meta.resolve('executable-specification-language');
  const { Compiler } = await import('executable-specification-language');
  const result = new Compiler().compile({
    source: { sourceId: 'consumer.expec', text }, locator: 'consumer',
    dependencies: { modules: [], packages: [] },
  });
  process.stdout.write(JSON.stringify({
    packageUrl, accepted: result.value !== undefined, syntax: result.syntax, deferred: result.deferred,
    problems: result.problems.map(problem => ({ ...problem,
      text: problem.at.kind === 'source'
        ? Array.from(text).slice(problem.at.range.start.offset, problem.at.range.end.offset).join('') : undefined,
    })),
    capabilities: result.value ? [...result.value.inspection.query('capability')].map(item => item.name) : [],
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({ packageUrl, error: { code: error.code, message: error.message, url: error.url } }));
  process.exitCode = 1;
}
