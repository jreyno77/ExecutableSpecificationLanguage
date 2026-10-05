import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PythonProjectDriver } from '../driver/python-project.js';
import { pythonConfiguration, type PythonProfile } from '../../src/python-profile.js';
import { pythonEnvironment, type PythonEnvironment } from '../../src/python-inputs.js';
import { runPytest } from '../../src/cli-pytest.js';
import { pythonPackagePhases } from '../../src/cli-python-phases.js';
import type { ProjectSnapshot } from '../../src/project-connection.js';

const fixture = new PythonProjectDriver();
const selected = [{ id: 'quantity', file: 'test/test_quantity.py', name: 'test_quantity', title: 'one copy' }];
let profile: PythonProfile, environment: PythonEnvironment, snapshot: ProjectSnapshot;
beforeAll(async () => {
  await fixture.initialize(); await fixture.installFixture();
  await fixture.file('test/test_quantity.py', 'def test_quantity() -> None:\n    print("Observed one copy")\n    assert 1 == 1\n');
  const captured = snapshot = await fixture.context.readSnapshot();
  const configured = pythonConfiguration(captured); if (!configured.value) throw Error(JSON.stringify(configured.problems));
  profile = configured.value;
  const installed = pythonEnvironment(captured, profile); if (!installed.value) throw Error(JSON.stringify(installed.problems));
  environment = installed.value;
}, 120_000);
afterAll(async () => { vi.restoreAllMocks(); await fixture.dispose(); });
const execute = (selectedProfile = profile) => runPytest(fixture.context.root, join(fixture.directory, 'expec.json'), selectedProfile, environment, selected, new AbortController().signal);

describe('the controlled pytest process preserves native outcomes', () => {
  it('returns the actual successful call and captured application output', async () => {
    const result = await execute();
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    expect(result.stages[0]).toMatchObject({ name: 'execution', status: 'passed', native: { exitCode: 0 },
      tests: [expect.objectContaining({ id: 'quantity', state: 'passed', phases: expect.arrayContaining([
        expect.objectContaining({ when: 'call', sections: expect.arrayContaining([['Captured stdout call', 'Observed one copy\n']]) }),
      ]) })] });
  }, 30_000);
  it('loads the actual selected standard-library extension modules during a native call', async () => {
    await fixture.file('test/test_extensions.py', `import _socket
import socket
import select
import unicodedata
import zlib

def test_extensions() -> None:
    assert _socket.inet_ntoa(bytes([127, 0, 0, 1])) == "127.0.0.1"
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen()
        assert select.select([server], [], [], 0) == ([], [], [])
    assert unicodedata.name("é") == "LATIN SMALL LETTER E WITH ACUTE"
    assert zlib.decompress(zlib.compress(b"Dune")) == b"Dune"
`);
    const result = await runPytest(fixture.context.root, join(fixture.directory, 'expec.json'), profile, environment,
      [{ id: 'extensions', file: 'test/test_extensions.py', name: 'test_extensions', title: 'selected native modules' }], new AbortController().signal);
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    expect(result.stages[0]).toMatchObject({ native: { exitCode: 0 }, tests: [expect.objectContaining({ id: 'extensions', state: 'passed' })] });
  }, 30_000);
  it('does not certify an actually skipped selected native case', async () => {
    await fixture.file('test/test_skipped.py', 'import pytest\n\n@pytest.mark.skip(reason="Unavailable store")\ndef test_skipped():\n    assert False\n');
    const result = await runPytest(fixture.context.root, join(fixture.directory, 'expec.json'), profile, environment,
      [{ id: 'skipped', file: 'test/test_skipped.py', name: 'test_skipped', title: 'unavailable store' }], new AbortController().signal);
    expect(result.exitCode).toBe(1);
    expect(result.stages[0]).toMatchObject({ native: { exitCode: 0 }, tests: [expect.objectContaining({ id: 'skipped', state: 'skipped' })] });
  }, 30_000);
  it('refuses when native collection produces no selected case', async () => {
    await fixture.file('test/test_hidden.py', 'def test_hidden():\n    assert False\n\ntest_hidden.__test__ = False\n');
    const result = await runPytest(fixture.context.root, join(fixture.directory, 'expec.json'), profile, environment,
      [{ id: 'hidden', file: 'test/test_hidden.py', name: 'test_hidden', title: 'hidden case' }], new AbortController().signal);
    expect(result.exitCode).toBe(1);
    expect(result.stages[0]).toMatchObject({ collected: [], tests: [expect.objectContaining({ id: 'hidden', state: 'incomplete', phases: [] })] });
  }, 30_000);
  it('retains native setup and finalizer failures without inventing a call', async () => {
    await fixture.file('test/test_setup.py', `import pytest

@pytest.fixture
def resource(request):
    def close():
        raise RuntimeError("Socket cleanup failed")
    request.addfinalizer(close)
    raise RuntimeError("Store setup failed")

def test_setup(resource):
    assert False, "The call must not run"
`);
    const result = await runPytest(fixture.context.root, join(fixture.directory, 'expec.json'), profile, environment,
      [{ id: 'setup', file: 'test/test_setup.py', name: 'test_setup', title: 'fallible resource setup' }], new AbortController().signal);
    expect(result.exitCode).toBe(1);
    expect(result.stages[0]).toMatchObject({ native: { exitCode: 1 }, tests: [expect.objectContaining({ id: 'setup', state: 'failed',
      errors: [expect.stringContaining('Store setup failed'), expect.stringContaining('Socket cleanup failed')],
      phases: [expect.objectContaining({ when: 'setup', outcome: 'failed' }), expect.objectContaining({ when: 'teardown', outcome: 'failed' })] })] });
  }, 30_000);
  it('retains successful phases when removing its owned temporary files fails', async () => {
    const remove = fs.rm.bind(fs); let temporary = '';
    const fault = vi.spyOn(fs, 'rm').mockImplementation(async (path, options) => {
      if (basename(String(path)).startsWith('expec-pytest-')) {
        temporary = String(path); throw Object.assign(Error('Deliberate temporary cleanup refusal'), { code: 'EACCES' });
      }
      return remove(path, options);
    });
    try {
      const result = await execute();
      expect(result.exitCode).toBe(1);
      expect(result.problems).toContainEqual(expect.objectContaining({ code: 'native-cleanup-failed' }));
      expect(result.stages[0]).toMatchObject({ name: 'execution', status: 'passed', native: { exitCode: 0 },
        tests: [expect.objectContaining({ id: 'quantity', state: 'passed' })] });
    } finally {
      fault.mockRestore();
      if (temporary) {
        expect(dirname(temporary)).toBe(await fs.realpath(tmpdir()));
        await remove(temporary, { recursive: true, force: true });
      }
    }
  }, 30_000);
  it('does not delete a different directory substituted for its temporary result directory', async () => {
    const read = fs.readFile.bind(fs); let temporary = '', original = '';
    const swap = vi.spyOn(fs, 'readFile').mockImplementation(async (...args: Parameters<typeof fs.readFile>) => {
      const value = await read(...args);
      if (basename(String(args[0])) === 'report.json' && basename(dirname(String(args[0]))).startsWith('expec-pytest-')) {
        temporary = dirname(String(args[0])); original = temporary + '-original';
        await fs.rename(temporary, original); await fs.mkdir(temporary);
        await fs.writeFile(join(temporary, 'keep.txt'), 'Unowned replacement');
      }
      return value;
    });
    try {
      const result = await execute();
      expect(await read(join(temporary, 'keep.txt'), 'utf8')).toBe('Unowned replacement');
      expect(result.exitCode).toBe(1);
      expect(result.problems).toContainEqual(expect.objectContaining({ code: 'native-cleanup-failed' }));
      expect(result.stages[0]).toMatchObject({ tests: [expect.objectContaining({ id: 'quantity', state: 'passed' })] });
    } finally {
      swap.mockRestore();
      for (const path of [temporary, original].filter(Boolean)) {
        expect(dirname(path)).toBe(await fs.realpath(tmpdir()));
        await fs.rm(path, { recursive: true, force: true });
      }
    }
  }, 30_000);
  it('refuses a project containing the native temporary directory before execution', async () => {
    const scratch = join(fixture.root, 'temporary'); await fs.mkdir(scratch, { recursive: true });
    vi.stubEnv(process.platform === 'win32' ? 'TEMP' : 'TMPDIR', scratch);
    try {
      const result = await execute();
      expect(result.exitCode).toBe(1);
      expect(result.problems).toContainEqual(expect.objectContaining({ code: 'unsafe-native-temporary-directory' }));
      expect(result.stages).toEqual([]); expect(await fs.readdir(scratch)).toEqual([]);
    } finally { vi.unstubAllEnvs(); }
  }, 30_000);
  it('requests native interruption and observes the real fixture finalizer', async () => {
    await fixture.file('test/test_wait.py', `import time
from pathlib import Path
import pytest

@pytest.fixture
def resource():
    try:
        yield
    finally:
        Path("closed.txt").write_text("closed", encoding="utf-8")

def test_wait(resource):
    Path("started.txt").write_text("started", encoding="utf-8")
    while True:
        time.sleep(0.02)
`);
    const controller = new AbortController();
    const running = runPytest(fixture.context.root, join(fixture.directory, 'expec.json'), profile, environment,
      [{ id: 'wait', file: 'test/test_wait.py', name: 'test_wait', title: 'waiting operation' }], controller.signal);
    try {
      const deadline = Date.now() + 5_000;
      while (!await fs.stat(join(fixture.root, 'started.txt')).then(() => true, () => false)) {
        if (Date.now() >= deadline) throw Error('The native waiting call did not start.');
        await delay(25);
      }
      controller.abort(); const result = await running;
      expect(result.status).toBe('cancelled'); expect(result.exitCode).toBe(130);
      expect(result.problems.map(problem => problem.code)).not.toContain('native-test-terminated');
      expect(result.stages[0]).toMatchObject({ native: { exitCode: 2, signal: null } });
      expect(await fs.readFile(join(fixture.root, 'closed.txt'), 'utf8')).toBe('closed');
    } finally { controller.abort(); await running; }
  }, 30_000);
  it('bounds inherited output-pipe closure while retaining the completed native report', async () => {
    await fixture.file('conftest.py', `import subprocess
import sys

def pytest_sessionfinish(session, exitstatus):
    subprocess.Popen([sys.executable, "-I", "-S", "-c",
        "import os,time; from pathlib import Path; Path('pipe-child.txt').write_text(str(os.getpid())); time.sleep(30)"],
        stdin=subprocess.DEVNULL)
`);
    const running = execute(); let pid = 0, scratch = '';
    try {
      const deadline = Date.now() + 5_000;
      while (!pid && Date.now() < deadline) {
        pid = await fs.readFile(join(fixture.root, 'pipe-child.txt'), 'utf8').then(Number, () => 0);
        if (!pid) await delay(25);
      }
      expect(pid).toBeGreaterThan(0);
      const result = await Promise.race([running, delay(8_000).then(() => { throw Error('Native output-pipe closure remained unbounded.'); })]);
      expect(result.exitCode).toBe(1);
      expect(result.problems).toContainEqual(expect.objectContaining({ code: 'native-test-closure-unconfirmed' }));
      expect(result.stages[0]).toMatchObject({ native: { exitCode: 0 }, tests: [expect.objectContaining({ id: 'quantity', state: 'passed' })] });
      scratch = dirname((result.stages[0]!.native as { args: string[] }).args.at(-1)!);
      expect(await fs.readFile(join(scratch, 'report.json'), 'utf8')).toContain('test_quantity');
    } finally {
      if (pid) { try { process.kill(pid); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } }
      await running; await fs.unlink(join(fixture.root, 'conftest.py'));
      if (scratch) { expect(dirname(await fs.realpath(scratch))).toBe(await fs.realpath(tmpdir())); await fs.rm(scratch, { recursive: true }); }
    }
  }, 30_000);
  it('returns a transport failure when the explicitly selected executable disappears', async () => {
    const result = await execute({ ...profile, python: join(fixture.directory, 'absent-python') });
    expect(result.exitCode).toBe(1);
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'native-test-failure' }));
    expect(result.stages[0]).toMatchObject({ tests: [], collected: [] });
  }, 30_000);
});

describe('the native phase audit owns only its actual temporary directory', () => {
  it('retains a substituted directory instead of deleting its unrelated contents', async () => {
    const remove = fs.rm.bind(fs); let temporary = '', original = '';
    const swap = vi.spyOn(fs, 'rm').mockImplementation(async (path, options) => {
      await remove(path, options);
      if (basename(String(path)).startsWith('expec-python-bytecode-') && basename(dirname(String(path))).startsWith('expec-python-phases-')) {
        temporary = dirname(String(path)); original = temporary + '-original';
        await fs.rename(temporary, original); await fs.mkdir(temporary);
        await fs.writeFile(join(temporary, 'keep.txt'), 'Unowned replacement');
      }
    });
    try {
      const problems = await pythonPackagePhases(snapshot, [], 'expec.python.json');
      expect(await fs.readFile(join(temporary, 'keep.txt'), 'utf8')).toBe('Unowned replacement');
      expect(problems).toContainEqual(expect.objectContaining({ code: 'native-cleanup-failed' }));
    } finally {
      swap.mockRestore();
      for (const path of [temporary, original].filter(Boolean)) {
        expect(dirname(path)).toBe(await fs.realpath(tmpdir())); await remove(path, { recursive: true, force: true });
      }
    }
  }, 30_000);
  it('refuses a project containing the native temporary directory', async () => {
    const scratch = join(fixture.root, 'temporary'); await fs.mkdir(scratch, { recursive: true });
    vi.stubEnv(process.platform === 'win32' ? 'TEMP' : 'TMPDIR', scratch);
    try {
      const problems = await pythonPackagePhases(snapshot, [], 'expec.python.json');
      expect(problems).toContainEqual(expect.objectContaining({ code: 'unsafe-native-temporary-directory' }));
      expect(await fs.readdir(scratch)).toEqual([]);
    } finally { vi.unstubAllEnvs(); }
  }, 30_000);
});
