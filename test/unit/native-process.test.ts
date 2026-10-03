import { describe, expect, it } from 'vitest';
import { runNative } from '../../src/native-process.js';

describe('native process text', () => {
  it('preserves a UTF-8 character whose bytes arrive in separate stdout chunks', async () => {
    const result = await runNative(process.execPath, ['-e', 'process.stdout.write(Buffer.from([0xc3])); setTimeout(() => process.stdout.write(Buffer.from([0xa9])), 30);'], process.cwd());
    expect(result).toEqual({ code: 0, stdout: 'é' });
  });
  it('preserves split UTF-8 native error text', async () => {
    const result = await runNative(process.execPath, ['-e', 'process.stderr.write(Buffer.from([0xc3])); setTimeout(() => { process.stderr.write(Buffer.from([0xa9])); process.exitCode = 1; }, 30);'], process.cwd());
    expect(result).toEqual({ code: 1, stdout: '', error: 'é' });
  });
});
