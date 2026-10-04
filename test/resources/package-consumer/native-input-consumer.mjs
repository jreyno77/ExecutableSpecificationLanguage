import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let packageUrl;
try {
  packageUrl = import.meta.resolve('executable-specification-language');
  const { ConfigurationReader, ProjectConnector, FileProjectWriter } = await import('executable-specification-language');
  const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const root = join(process.cwd(), 'project'), library = join(process.cwd(), input.library);
  await mkdir(root);
  await writeFile(join(root, 'handwritten.txt'), 'Keep this handwritten note.');
  await writeFile(library, input.before);
  const configuration = new ConfigurationReader([]).read({ sourceId: 'settings', text: JSON.stringify({
    formatVersion: 1, version: '0.1.0', project: { root: 'project' }, build: { entries: ['main.expec'] },
  }) });
  if (!configuration.value) throw Error(JSON.stringify(configuration.problems));
  const connected = await new ProjectConnector(join(process.cwd(), 'expec.json')).connect(configuration.value);
  if (connected.value?.status !== 'connected') throw Error(JSON.stringify(connected));
  const project = connected.value.context, actualUri = pathToFileURL(await realpath(library)).href;
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const context = {
    root: project.root,
    async readSnapshot() {
      const snapshot = await project.readSnapshot();
      return { ...snapshot, nativeInputs: [{ uri: actualUri, version: hash(await readFile(library)) }] };
    },
  };
  const basedOn = await context.readSnapshot(), before = await readFile(library, 'utf8');
  await writeFile(library, input.after);
  const receipt = await new FileProjectWriter(context).apply({ basedOn,
    changes: [{ kind: 'write', path: input.file, bytes: new TextEncoder().encode(input.text) }],
  });
  let targetExists = true;
  try { await access(join(root, input.file)); } catch (error) { if (error.code !== 'ENOENT') throw error; targetExists = false; }
  process.stdout.write(JSON.stringify({ packageUrl, nativeInputs: {
    complete: basedOn.complete, problems: basedOn.problems, evidence: basedOn.nativeInputs, actualUri,
    editable: basedOn.files.map(file => pathToFileURL(join(root, file.path)).href), before,
    after: await readFile(library, 'utf8'), laterVersion: hash(await readFile(library)), receipt, targetExists,
    handwritten: await readFile(join(root, 'handwritten.txt'), 'utf8'),
  } }));
} catch (error) {
  process.stdout.write(JSON.stringify({ packageUrl, error: { code: error.code, message: error.message, url: error.url } }));
  process.exitCode = 1;
}
