import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { TestProject } from 'vitest/node';

const checkout = fileURLToPath(new URL('../', import.meta.url));
export default async function setup(project: TestProject): Promise<void> {
  const compile = async () => {
    project.provide('compiledCheckout', '');
    await promisify(execFile)(process.execPath, [join(checkout, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
      { cwd: checkout, windowsHide: true, timeout: 25_000, maxBuffer: 4 * 1024 * 1024 });
    project.provide('compiledCheckout', checkout);
  };
  project.onTestsRerun(async () => { await project.vitest.waitForTestRunEnd(); await compile(); });
  await compile();
}
