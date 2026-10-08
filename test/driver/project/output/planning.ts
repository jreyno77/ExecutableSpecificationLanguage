import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inject } from 'vitest';

export function planWithinHeapLimit({ fileMiB, heapMiB }: { fileMiB: number; heapMiB: number }): Promise<{ exitCode: number | string | null; stderr: string; report: unknown }> {
  const checkout = inject('compiledCheckout');
  if (!checkout) throw new Error('The bounded planning check requires the compiled checkout.');
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['--max-old-space-size=' + heapMiB,
      fileURLToPath(new URL('../../../resources/project/output/bounded-plan.mjs', import.meta.url)),
      pathToFileURL(join(checkout, 'dist/project/output/output.js')).href, String(fileMiB)],
    { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
      if (error && typeof error.code === 'string' && !error.signal) { reject(error); return; }
      resolve({ exitCode: error ? error.code ?? error.signal ?? null : 0, stderr, report: stdout.trim() ? JSON.parse(stdout) : undefined });
    });
  });
}
