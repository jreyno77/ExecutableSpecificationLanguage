import { execFile, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { TestProject } from 'vitest/node';

const checkout = fileURLToPath(new URL('../', import.meta.url));
export default async function setup(project: TestProject): Promise<void> {
  const compile = async () => {
    project.provide('compiledCheckout', '');
    const signal = AbortSignal.timeout(25_000);
    for (const [tool, ...args] of [['typescript/bin/tsc', '-p', 'tsconfig.build.json'], ['rolldown/bin/cli.mjs', '-c']])
      await promisify(execFile)(process.execPath, [join(checkout, 'node_modules', tool!), ...args],
        { cwd: checkout, windowsHide: true, signal, maxBuffer: 4 * 1024 * 1024 });
    signal.throwIfAborted();
    project.provide('compiledCheckout', checkout);
  };
  project.onTestsRerun(async () => { await project.vitest.waitForTestRunEnd(); await compile(); });
  if (process.env.EXPEC_CI_BUILD) {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
    if (process.env.EXPEC_CI_BUILD !== commit) throw Error('Verified CI build belongs to another commit.');
    project.provide('compiledCheckout', checkout);
  } else await compile();
}
