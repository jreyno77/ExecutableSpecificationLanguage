import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Explicit interpreter, isolated startup, argument array, bounded lifetime and output. */
export async function runPython(python: string, args: readonly string[], cwd: string): Promise<{ code: number; text: string; error?: string }> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PYTHON|PYTEST|VIRTUAL_ENV|UV_|PIP_)/i.test(key)));
  try { const result = await promisify(execFile)(python, ['-I', '-S', '-B', ...args], { cwd, env, windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
    return { code: 0, text: result.stdout, ...(result.stderr ? { error: result.stderr } : {}) };
  } catch (error) { const failure = error as { code?: number; stdout?: string; stderr?: string; message: string };
    return { code: typeof failure.code === 'number' ? failure.code : -1, text: failure.stdout ?? '', error: failure.stderr || failure.message };
  }
}
