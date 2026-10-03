import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';

let packageUrl;
try {
  packageUrl = import.meta.resolve('executable-specification-language');
  const { ConfigurationReader, ProjectConnector, FileProjectWriter } = await import('executable-specification-language');
  const input = JSON.parse(await readFile(process.argv[2], 'utf8')), root = join(process.cwd(), 'project');
  await mkdir(root);
  await writeFile(join(root, 'book.txt'), input.before);
  await writeFile(join(root, 'handwritten.txt'), 'handwritten');
  const configuration = new ConfigurationReader([]).read({ sourceId: 'settings', text: JSON.stringify({
    formatVersion: 1, version: '0.1.0', project: { root: 'project' }, build: { entries: ['main.expec'] },
  }) });
  if (!configuration.value) throw new Error(JSON.stringify(configuration.problems));
  const connection = await new ProjectConnector(join(process.cwd(), 'expec.json')).connect(configuration.value);
  if (connection.value?.status !== 'connected') throw new Error(JSON.stringify(connection));
  const context = connection.value.context, result = await new FileProjectWriter(context).apply({
    basedOn: await context.readSnapshot(),
    changes: [{ kind: 'write', path: 'book.txt', bytes: new TextEncoder().encode(input.after) }],
  });
  let markerPresent = true;
  try { await lstat(join(root, '.expec/write.lock')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    markerPresent = false;
  }
  process.stdout.write(JSON.stringify({ packageUrl, writing: {
    status: result.status, problems: result.problems, outcomes: result.outcomes.map(outcome => outcome.state),
    before: result.outcomes.flatMap(outcome => outcome.before).map(file => file.state === 'file' ? Buffer.from(file.bytes).toString() : file.state),
    file: await readFile(join(root, 'book.txt'), 'utf8'),
    handwritten: await readFile(join(root, 'handwritten.txt'), 'utf8'), markerPresent,
  } }));
} catch (error) {
  process.stdout.write(JSON.stringify({ packageUrl, error: { code: error.code, message: error.message, url: error.url } }));
  process.exitCode = 1;
}

