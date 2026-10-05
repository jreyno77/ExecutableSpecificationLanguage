import { afterEach, expect, it, vi } from 'vitest';
import { runCli } from '../../src/index.js';

function report() {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => { chunks.push(String(chunk)); return true; }) as typeof process.stdout.write);
  return () => JSON.parse(chunks.join(''));
}
afterEach(() => vi.restoreAllMocks());

it('keeps an explicit JDK selection out of source checking', async () => {
  const observed = report();
  expect(await runCli(['check', '--java-home', '/jdk', '--json'])).toBe(2);
  expect(observed().problems).toMatchObject([{code:'invalid-command',message:expect.stringContaining('only available for init')}]);
});
it('refuses a JDK flag for TypeScript initialization before touching a destination', async () => {
  const observed = report();
  expect(await runCli(['init', '--root', 'missing-project', '--target', 'typescript', '--java-home', '/jdk', '--yes', '--json'])).toBe(2);
  expect(observed().problems).toMatchObject([{code:'invalid-command',message:expect.stringContaining('only available for Java or Kotlin targets')}]);
});
it('does not choose the last of repeated explicit JDK selections', async () => {
  const observed = report();
  expect(await runCli(['init', '--root', 'missing-project', '--target', 'kotlin', '--java-home', '/first', '--java-home', '/second', '--yes', '--json'])).toBe(2);
  expect(observed().problems).toMatchObject([{code:'invalid-command',message:expect.stringContaining('--java-home is repeated')}]);
});
