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
    release = async () => { child.stdin.end('\n'); const timeout = setTimeout(() => child.kill(), 5000); try { await closed; } finally { clearTimeout(timeout); } };
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Exclusive-read fixture did not become ready.')), 8000);
        let output = '', error = '';
        child.stderr.on('data', chunk => { error += String(chunk); });
        child.once('error', failure => { clearTimeout(timeout); reject(failure); });
        child.once('close', () => { clearTimeout(timeout); reject(new Error(`Exclusive-read fixture exited: ${error}`)); });
        child.stdout.on('data', chunk => { output += String(chunk); if (output.includes('READY')) { clearTimeout(timeout); resolve(); } });
      });
    } catch (error) { await release(); throw error; }
  } else {
    const mode = (await stat(path)).mode; release = () => chmod(path, mode); await chmod(path, 0);
  }
  const failure = await readFile(path).then(() => undefined, error => error as NodeJS.ErrnoException);
  if (!failure || !['EACCES', 'EPERM', 'EBUSY'].includes(failure.code ?? '')) { await release(); throw Error(`Could not establish an unreadable existing file: ${failure?.code ?? 'read succeeded'}.`); }
  return release;
}
