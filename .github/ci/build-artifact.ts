import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const roots = ['dist', 'src/language/langium/generated', 'src/project/java/resources', 'src/project/kotlin/resources',
  'package.json', '.local-docs/package.tgz'];
interface Build {
  commit: string; platform: string; package: string; files: Record<string, string>;
}
async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function child(root: string, path: string): string {
  if (!path || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..') || /^[A-Za-z]:/.test(path))
    throw Error('Invalid build artifact path.');
  return join(root, path);
}
export async function captureBuild(root: string, commit: string, platform: string): Promise<void> {
  const files: Record<string, string> = {};
  async function visit(path: string): Promise<void> {
    const file = child(root, path), info = await lstat(file);
    if (info.isSymbolicLink()) throw Error('Unexpected symbolic link in build artifact.');
    if (info.isDirectory()) for (const name of (await readdir(file)).sort()) await visit(path + '/' + name);
    else files[path] = await digest(file);
  }
  for (const path of roots) await visit(path);
  await writeFile(join(root, '.local-docs/build.json'), JSON.stringify({
    commit, platform, package: '.local-docs/package.tgz', files,
  }));
}
export async function verifyBuild(root: string, commit: string, platform: string): Promise<string> {
  const receipt: Build = JSON.parse(await readFile(join(root, '.local-docs/build.json'), 'utf8'));
  if (receipt.commit !== commit) throw Error('Build artifact source commit differs.');
  if (receipt.platform !== platform) throw Error('Build artifact platform differs.');
  const artifact = child(root, receipt.package);
  if (!Object.hasOwn(receipt.files, receipt.package)) throw Error('Build artifact package is not captured.');
  for (const [path, expected] of Object.entries(receipt.files)) {
    const file = child(root, path);
    if (!(await lstat(file)).isFile()) throw Error('Invalid build artifact file.');
    if (await digest(file) !== expected) throw Error('Build artifact digest differs: ' + path);
  }
  return artifact;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.cwd(), commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (process.argv[2] === 'capture') await captureBuild(root, commit, process.platform);
  else if (process.argv[2] === 'verify') {
    const artifact = await verifyBuild(root, commit, process.platform);
    await appendFile(process.env.GITHUB_ENV!, 'EXPEC_CI_BUILD=' + commit + '\nEXPEC_CI_PACKAGE=' + artifact + '\n');
  } else throw Error('Expected capture or verify.');
}
