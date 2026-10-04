import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const packageUrl = import.meta.resolve('executable-specification-language');
const packageRoot = dirname(dirname(fileURLToPath(packageUrl)));
const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
const executable = resolve(packageRoot, manifest.bin.expec);
await mkdir('spec'); await mkdir('project');
await writeFile('spec/main.expec', 'concept StoreGame {\n public save\n capability save() returns Nothing\n}\n');
await writeFile('spec/expec.json', JSON.stringify({ formatVersion: 1, version: '1.2.3', project: { root: '../project' },
  build: { entries: ['main.expec'] }, outputs: [] }));
await writeFile('project/notes.txt', 'Keep this handwritten note.');
const manifestBefore = await readFile('spec/expec.json', 'utf8');
const executed = await promisify(execFile)(process.execPath, [executable, 'check', '--config', 'spec/expec.json', '--json'],
  { timeout: 30_000, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } });
console.log(JSON.stringify({ packageUrl, cli: { executable, result: JSON.parse(executed.stdout), stderr: executed.stderr,
  manifestBefore, manifestAfter: await readFile('spec/expec.json', 'utf8'),
  files: await readdir('project'), note: await readFile('project/notes.txt', 'utf8') } }));
