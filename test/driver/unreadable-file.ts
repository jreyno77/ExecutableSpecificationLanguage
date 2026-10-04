import { chmod, readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';

/** An actual OS read refusal, released even if fixture readiness fails. */
export async function unreadableFile(path: string): Promise<() => Promise<void>> {
  let release: () => Promise<void>;
  if (process.platform === 'win32') {
    const script = "$ErrorActionPreference='Stop'; $file=[IO.File]::Open($env:EXPEC_LOCK_FILE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None); try { [Console]::Out.WriteLine('READY'); [Console]::Out.Flush(); [Console]::In.ReadLine() | Out-Null } finally { $file.Dispose() }";
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, env: { ...process.env, EXPEC_LOCK_FILE: path }, stdio: ['pipe', 'pipe', 'pipe'] });
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
    child.stdin.on('error', () => {}); // A failed child may close its pipe before cleanup asks it to exit.
    release = async () => {
      child.stdin.end('\n');
      const kill = setTimeout(() => child.kill(), 5000);
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([closed, new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Exclusive-read fixture did not close after termination.')), 10_000);
        })]);
      } finally { clearTimeout(kill); clearTimeout(deadline); }
    };
    try {
      await new Promise<void>((resolve, reject) => {
        let output = '', error = '';
        const timeout = setTimeout(() => reject(new Error(`Exclusive-read fixture did not become ready within 15 seconds: ${error}`)), 15_000);
        child.stderr.on('data', chunk => { error += String(chunk); });
        child.once('error', failure => { clearTimeout(timeout); reject(failure); });
        child.once('close', () => { clearTimeout(timeout); reject(new Error(`Exclusive-read fixture exited: ${error}`)); });
        child.stdout.on('data', chunk => { output += String(chunk); if (output.split(/\r?\n/).includes('READY')) { clearTimeout(timeout); resolve(); } });
      });
    } catch (error) {
      try { await release(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Exclusive-read fixture setup and cleanup failed.'); }
      throw error;
    }
  } else {
    const mode = (await stat(path)).mode; release = () => chmod(path, mode); await chmod(path, 0);
  }
  const failure = await readFile(path).then(() => undefined, error => error as NodeJS.ErrnoException);
  if (!failure || !['EACCES', 'EPERM', 'EBUSY'].includes(failure.code ?? '')) { await release(); throw Error(`Could not establish an unreadable existing file: ${failure?.code ?? 'read succeeded'}.`); }
  return release;
}
