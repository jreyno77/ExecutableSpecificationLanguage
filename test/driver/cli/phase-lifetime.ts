import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { requireCompiledCheckout } from '../compiled-checkout.js';

export async function generationCaptureLifetime(source: string): Promise<{
  result: { status: string; exitCode: number; problems: unknown[] };
  atPlanning: { initialAlive: boolean; transitionAlive: boolean; stageAlive: boolean };
}> {
  requireCompiledCheckout();
  const checkout = fileURLToPath(new URL('../../../', import.meta.url));
  const fixture = fileURLToPath(new URL('../../resources/cli/phase-lifetime.mjs', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, ['--expose-gc', fixture, checkout, source], {
    cwd: checkout, windowsHide: true, signal: AbortSignal.timeout(20_000), maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout);
}
