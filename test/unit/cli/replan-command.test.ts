import { describe, expect, it } from 'vitest';
import { runCli } from '../../../src/cli/cli.js';

async function rejected(command: string) {
  let stdout = '';
  const code = await runCli([command, '--replan', '--json'], {}, { stdout: text => { stdout += text; }, stderr: () => {} });
  expect(code).toBe(2);
  const report = JSON.parse(stdout);
  expect(report.problems).toContainEqual(expect.objectContaining({ code: 'invalid-command', message: expect.stringContaining('--replan is only available for build') }));
}
describe('replan is an explicit build option', () => {
  it('rejects replan on syntax and meaning checks', async () => { await rejected('check'); });
  it('rejects replan on native test execution', async () => { await rejected('test'); });
  it('rejects replan on package installation', async () => { await rejected('install'); });
  it('rejects replan on project initialization', async () => { await rejected('init'); });
});
