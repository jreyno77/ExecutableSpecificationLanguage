import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runPython } from '../../../../src/project/python/python-process.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); }, 30_000);

describe('isolated native Python process', () => {
  it('loads current tooling source instead of a valid-looking legacy bytecode cache', async () => {
    const python = process.env.EXPEC_TEST_PYTHON; if (!python) throw new Error('Provide the explicitly provisioned Python 3.12 interpreter.');
    const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-python-process-')); roots.push(root);
    await promisify(execFile)(python, ['-I', '-S', '-B', '-c',
      'import pathlib,sys,os,py_compile; p=pathlib.Path(sys.argv[1])/"tool.py"; p.write_text("VALUE = 1\\n"); stamp=p.stat(); py_compile.compile(str(p),doraise=True); p.write_text("VALUE = 2\\n"); os.utime(p,ns=(stamp.st_atime_ns,stamp.st_mtime_ns))', root], { windowsHide: true });
    const result = await runPython(python, ['-c', 'import sys; sys.path.insert(0,sys.argv[1]); import tool; print(tool.VALUE)', root], root);
    expect(result.code, result.error).toBe(0); expect(result.text.trim()).toBe('2');
  });
});
