import spawn from 'cross-spawn';

/** Argument-array launch, including Windows npm.cmd resolution. No package text becomes shell source. */
export async function runNative(command: string, args: readonly string[], cwd: string): Promise<{ code: number | null; stdout: string; error?: string }> {
  return new Promise(resolve => {
    let stdout = '', stderr = '', size = 0, failed: string | undefined;
    const child = spawn(command, [...args], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.setEncoding('utf8'); child.stderr!.setEncoding('utf8');
    const collect = (data: string, output: boolean) => {
      size += Buffer.byteLength(data, 'utf8');
      if (size > 8 * 1024 * 1024) { failed = 'Native output exceeded 8 MiB.'; child.kill(); return; }
      if (output) stdout += data; else stderr += data;
    };
    child.stdout!.on('data', data => collect(data, true)); child.stderr!.on('data', data => collect(data, false));
    child.on('error', error => { failed = error.message; });
    child.on('close', (code, signal) => resolve({ code, stdout,
      ...(failed || signal || code !== 0 ? { error: failed ?? (signal ? 'Native process terminated by ' + signal : stderr.trim() || 'Native exit ' + code) } : {}) }));
  });
}
