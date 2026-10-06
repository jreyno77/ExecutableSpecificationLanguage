import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const components = ['language', 'model', 'compiler', 'cli', 'project/connection',
  'project/dependencies', 'project/output', 'project/java', 'project/kotlin', 'project/python', 'project/typescript', 'package', 'workflow'];
const ownership: [RegExp, string][] = [
  [/^(README\.md|AGENTS\.md|\.github\/pull_request_template\.md|\.agents\/.*)$/, 'docs'],
  [/^src\/cli-entry\.ts$/, 'cli'],
  [/^(src\/(index|resources)\.ts|package(-lock)?\.json|\.node-version|\.npmrc|tsconfig(\.[\w-]+)?\.json|rolldown\.config\.mjs)$/, 'package'],
  [/^langium-config\.json$/, 'language'],
  [/^(\.github\/(workflows|ci)\/|vitest(\.[\w-]+)?\.config\.ts$|test\/global-setup\.ts$|test\/driver\/(compiled-checkout|unreadable-file)\.ts$|\.git(ignore|attributes)$)/, 'workflow'],
  [/^test\/resources\/package-consumer\/java-(consumer|cli-consumer|cli-guard)\.mjs$/, 'project/java'],
  [/^test\/resources\/package-consumer\/(kotlin-(consumer|cli-consumer)|checkout-guard)\.mjs$/, 'project/kotlin'],
  [/^test\/resources\/package-consumer\/python-(cli-consumer\.mjs|cli-guard\.mjs|public\.mts)$/, 'project/python'],
  [/^test\/resources\/python\//, 'project/python'],
  [/^test\/resources\/grammar\//, 'language'],
  [/^test\/resources\/(domain-failures|workspace-compilation)\//, 'compiler'],
  [/^test\/resources\/diagrams\//, 'project/output'],
  [/^test\/resources\/java-project\//, 'project/java'],
  [/^test\/resources\/((junit-reports|pilot)\/|connected-(output|selection)\.mjs$)/, 'cli'],
  [/^test\/resources\/scenario-execution\//, 'project/typescript'],
  [/^test\/resources\/package-consumer\//, 'package'],
];

function componentFor(path: string): string {
  const owner = ownership.find(([pattern]) => pattern.test(path))?.[1]
    ?? components.find(component => (component !== 'package' && component !== 'workflow' && path.startsWith('src/' + component + '/'))
      || ['unit', 'acceptance', 'dsl', 'driver'].some(layer => path.startsWith('test/' + layer + '/' + component + '/')));
  if (!owner) throw new Error('Assign a component owner to changed path: ' + path);
  return owner;
}

export function checksFor(event: string, paths: readonly string[], ref = '') {
  const full = event !== 'pull_request' || Boolean(ref);
  const owners = new Set(full ? components : paths.map(componentFor));
  return {
    core: components.filter(owner => owners.has(owner) && owner !== 'project/java' && owner !== 'project/kotlin' && owner !== 'project/python' && owner !== 'workflow')
      .flatMap(owner => ['test/unit/' + owner, 'test/acceptance/' + owner]),
    java: owners.has('project/java'),
    kotlin: owners.has('project/kotlin'),
    python: owners.has('project/python'),
    package: owners.has('package'),
    pilot: owners.has('cli'),
    workflow: owners.has('workflow'),
    shards: full ? [1, 2, 3, 4, 5] : [1],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { GITHUB_EVENT_NAME: event, GITHUB_OUTPUT: output, CHECK_REF: ref = '', BASE_SHA: base, HEAD_SHA: head } = process.env;
  if (!event || !output) throw new Error('GITHUB_EVENT_NAME and GITHUB_OUTPUT are required.');
  let paths: string[] = [];
  if (event === 'pull_request' && !ref) {
    if (!base || !head || !/^[a-f0-9]{40}$/i.test(base) || !/^[a-f0-9]{40}$/i.test(head))
      throw new Error('PR selection requires BASE_SHA and HEAD_SHA commit identities.');
    paths = execFileSync('git', ['diff', '--name-only', '-z', '--no-renames', base + '...' + head],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean);
  }
  const checks = checksFor(event, paths, ref);
  appendFileSync(output, Object.entries({ ...checks, total: checks.shards.length })
    .map(([name, value]) => name + '=' + JSON.stringify(value)).join('\n') + '\n');
  console.log(JSON.stringify(checks));
}