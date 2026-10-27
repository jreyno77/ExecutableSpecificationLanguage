import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { TestRunner } from 'vitest';
import { requireCompiledCheckout } from '../compiled-checkout.js';

export async function generationCaptureLifetime(source: string): Promise<{
  result: { status: string; exitCode: number; problems: unknown[] };
  atPlanning: { initialAlive: boolean; transitionAlive: boolean; stageAlive: boolean };
}> {
  requireCompiledCheckout();
  const checkout = fileURLToPath(new URL('../../../', import.meta.url));
  const fixture = fileURLToPath(new URL('../../resources/cli/phase-lifetime.mjs', import.meta.url));
  const owner = TestRunner.getCurrentTest()?.context.signal, deadline = AbortSignal.timeout(20_000);
  const execution = promisify(execFile)(process.execPath, ['--expose-gc', fixture, checkout, source], {
    cwd: checkout, windowsHide: true, signal: owner ? AbortSignal.any([owner, deadline]) : deadline, maxBuffer: 1024 * 1024,
  });
  const closed = new Promise<void>(resolve => execution.child.once('close', () => resolve()));
  try { return JSON.parse((await execution).stdout); } finally { await closed; }
}