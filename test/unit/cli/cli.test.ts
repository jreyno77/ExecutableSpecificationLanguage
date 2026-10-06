import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli, typescriptOutput } from '../../../src/index.js';

function output() {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => { chunks.push(String(chunk)); return true; }) as typeof process.stdout.write);
  return () => JSON.parse(chunks.join(''));
}
afterEach(() => vi.restoreAllMocks());

describe('explicit command arguments', () => {
  it('rejects a repeated manifest instead of choosing the last one', async () => {
    const report = output();
    expect(await runCli(['check', '--config', 'first.json', '--config', 'second.json', '--json'])).toBe(2);
    expect(report().problems[0].message).toContain('--config is repeated');
  });
  it('rejects an empty manifest filename before reading a directory as configuration', async () => {
    const report = output();
    expect(await runCli(['check', '--config', '', '--json'])).toBe(2);
    expect(report().problems[0].code).toBe('invalid-command');
  });
  it('rejects an extra positional argument instead of silently ignoring it', async () => {
    const report = output();
    expect(await runCli(['check', 'extra', '--json'])).toBe(2);
    expect(report().status).toBe('usage-error');
  });
  it('keeps initialization consent out of check', async () => {
    const report = output();
    expect(await runCli(['check', '--yes', '--json'])).toBe(2);
    expect(report().problems[0].message).toContain('only available for init');
  });
  it('rejects duplicate output registrations before loading the manifest', async () => {
    const report = output();
    expect(await runCli(['check', '--config', 'missing-manifest.json', '--json'], { tests: [typescriptOutput] })).toBe(1);
    expect(report().problems).toMatchObject([{ code: 'host-failure', message: expect.stringContaining('unique nonblank output ID') }]);
  });
});
