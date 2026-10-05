import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const allChecks = ['core', 'pilot', 'package', 'clean', 'java', 'kotlin', 'python', 'native-java', 'native-kotlin', 'native-python'];
const native = '(java|kotlin|python)';

export function checksFor(event: string, paths: string[]): string[] {
  if (event !== 'pull_request' || paths.length === 0) return [...allChecks];
  const selected = new Set<string>();
  const add = (...checks: string[]) => checks.forEach(check => selected.add(check));
  for (const path of paths) {
    const target = path.match(new RegExp('^src/project/' + native + '/'))?.[1];
    const test = path.match(new RegExp('^test/(?:unit|acceptance)/' + native + '-.*\\.test\\.ts$'))?.[1];
    const installed = path.match(/^test\/acceptance\/installed-(java|kotlin)-package\.test\.ts$/)?.[1];
    const walkthrough = path.match(/^test\/acceptance\/shipped-(java|kotlin|python)-walkthrough\.test\.ts$/)?.[1];
    if (target) add('core', 'package', 'clean', target, 'native-' + target);
    else if (test || installed) add((test || installed)!);
    else if (walkthrough) add('native-' + walkthrough);
    else if (/^src\/project\/typescript\//.test(path)) add('core', 'pilot', 'package', 'clean');
    else return [...allChecks]; // Shared helpers, configuration and unknown ownership affect all consumers.
  }
  return allChecks.filter(check => selected.has(check));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let paths: string[] = [];
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    try {
      // Disabling rename detection yields both deleted and added paths, with no API pagination/truncation.
      paths = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z',
        process.env.CI_BASE_SHA + '...' + process.env.CI_HEAD_SHA], { encoding: 'utf8' }).split('\0').filter(Boolean);
    } catch { console.warn('Change discovery failed; selecting every check.'); }
  }
  const checks = checksFor(process.env.GITHUB_EVENT_NAME ?? '', paths);
  const targets = ['java', 'kotlin', 'python'].filter(target => checks.includes('native-' + target));
  for (const check of allChecks.filter(check => !check.startsWith('native-')))
    appendFileSync(process.env.GITHUB_OUTPUT!, check + '=' + checks.includes(check) + '\n');
  appendFileSync(process.env.GITHUB_OUTPUT!, 'native=' + JSON.stringify(targets) + '\n');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY!, 'Selected checks: ' + checks.join(', ') + '\n');
}
