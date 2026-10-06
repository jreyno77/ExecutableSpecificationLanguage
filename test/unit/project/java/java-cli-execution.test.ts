import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { jvmCommand, runJUnit } from '../../../../src/cli/cli-junit.js';

let directory: string;
const home = process.env.EXPEC_TEST_JAVA_HOME ?? process.env.JAVA_HOME!, consoleJar = process.env.EXPEC_TEST_JUNIT_CONSOLE!;
const tool = (name: string) => join(home, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
beforeAll(async () => {
  if (!home || !consoleJar) throw Error('Supply the actual pinned JDK and JUnit native fixtures.');
  directory = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-junit-unit-'));
  await fs.writeFile(join(directory, 'Probe.java'), `import org.junit.jupiter.api.*;
public class Probe {
  public static class Exact { @Test void selected() { Assertions.assertEquals("Dune", "Dune"); } @Test void neighbor() { throw new AssertionError("Unselected neighbor must not run"); } }
  public static class Disabled { @org.junit.jupiter.api.Disabled("human pending") @Test void selected() {} }
  public static class Aborted { @Test void selected() { Assumptions.assumeTrue(false, "application unavailable"); } }
  public static class Setup { @BeforeAll static void before() { throw new IllegalStateException("setup failed"); } @Test void selected() {} }
  public static class Dual { @Test void selected() { Assertions.assertEquals(1, 2); } @AfterEach void close() { throw new IllegalStateException("cleanup failed"); } }
  public static class Waiting { @Test void selected() throws Exception { System.out.println("ACTUAL-JVM-WAITING"); while (true) Thread.sleep(100); } }
  public static class Utf8 { public static void main(String[] args) throws Exception { for (byte value : "📚".getBytes(java.nio.charset.StandardCharsets.UTF_8)) { System.out.write(value); System.out.flush(); Thread.sleep(40); } } }
}`);
  await promisify(execFile)(tool('javac'), ['-proc:none', '--release', '21', '-cp', consoleJar, '-d', directory, join(directory, 'Probe.java')], { timeout: 30_000, windowsHide: true });
}, 45_000);
afterAll(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }); });
const execute = (type: string, method = 'selected', signal = new AbortController().signal) => runJUnit(tool('java'), [consoleJar, directory],
  [{ id: 'case-' + type, file: 'Probe.java', title: type, className: 'Probe$' + type, methodName: method, parameters: [] }], { path: directory, identity: 'actual-owned-native-fixture' }, signal);
const stage = (result: Awaited<ReturnType<typeof execute>>) => result.stages.find(item => item.name === 'execution') as { name: string; status: string; tests: { state: string; errors: string[] }[]; errors: string[]; native: { closed: boolean; exitCode: number | null } };

describe('actual native JUnit process observations', { timeout: 30_000 }, () => {
  it('executes only the selected real method beside a failing neighbor', async () => {
    const result = await execute('Exact'); expect(result.status).toBe('tested'); expect(result.exitCode).toBe(0); expect(result.problems).toEqual([]);
    expect(stage(result).tests).toEqual([{ id: 'case-Exact', file: 'Probe.java', title: 'selected()', state: 'passed', errors: [] }]);
  });
  it('refuses a skipped selected method even though native exit is zero', async () => {
    const result = await execute('Disabled'); expect(result.status).toBe('failed'); expect(stage(result).native.exitCode).toBe(0);
    expect(stage(result).tests[0]).toMatchObject({ state: 'skipped', errors: ['human pending'] });
  });
  it('retains the native assumption abort', async () => {
    const result = await execute('Aborted'); expect(result.status).toBe('failed'); expect(stage(result).tests[0]?.state).toBe('aborted');
    expect(stage(result).tests[0]?.errors.join('\n')).toContain('application unavailable');
  });
  it('retains a failed parent with no manufactured passing method', async () => {
    const result = await execute('Setup'); expect(result.status).toBe('failed'); expect(stage(result).tests).toEqual([]);
    expect(stage(result).errors.join('\n')).toContain('setup failed');
  });
  it('retains actual assertion and suppressed cleanup causes', async () => {
    const result = await execute('Dual'); expect(result.status).toBe('failed'); expect(stage(result).tests[0]?.state).toBe('failed');
    expect(stage(result).tests[0]?.errors.join('\n')).toContain('expected: <1> but was: <2>');
    expect(stage(result).tests[0]?.errors.join('\n')).toContain('Suppressed: java.lang.IllegalStateException: cleanup failed');
  });
  it('does not invent a missing native method', async () => {
    const result = await execute('Exact', 'missing'); expect(result.status).toBe('failed'); expect(stage(result).tests).toEqual([]);
    expect(result.problems.length).toBeGreaterThan(0);
  });
  it('observes native closure after cancellation without claiming application cleanup', async () => {
    const controller = new AbortController(), original = process.stderr.write.bind(process.stderr);
    let ready = false;
    const observer = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array, ...args: unknown[]) => {
      if (Buffer.from(chunk).toString().includes('ACTUAL-JVM-WAITING')) { ready = true; controller.abort(); }
      return (original as (...args: unknown[]) => boolean)(chunk, ...args);
    }) as typeof process.stderr.write);
    try {
      const result = await execute('Waiting', 'selected', controller.signal);
      expect(ready).toBe(true); expect(result.status).toBe('cancelled'); expect(result.exitCode).toBe(130);
      expect(stage(result).native.closed).toBe(true); expect(result.problems.some(problem => /cleanup.*unconfirmed/i.test(problem.message))).toBe(true);
    } finally { observer.mockRestore(); }
  });
  it('retains UTF8 output split across actual native writes', async () => {
    const result = await jvmCommand(tool('java'), ['-cp', directory, 'Probe$Utf8'], directory, new AbortController().signal);
    expect(result.exitCode).toBe(0); expect(result.stdout).toBe('📚');
  });
  it('refuses native scratch inside the actual project', async () => {
    const result = await runJUnit(tool('java'), [consoleJar, directory], [{ id: 'exact', file: 'Probe.java', title: 'selected', className: 'Probe$Exact', methodName: 'selected', parameters: [] }],
      { path: await fs.realpath(tmpdir()), identity: 'project-containing-temporary-root' }, new AbortController().signal);
    expect(result.status).toBe('failed'); expect(result.problems).toMatchObject([{ code: 'unsafe-native-temporary-root' }]); expect(result.stages).toEqual([]);
  });
  it('retains actual results when removing the owned report scratch fails', async () => {
    const original = fs.rm.bind(fs); let scratch = '';
    const failure = vi.spyOn(fs, 'rm').mockImplementation(async (path, options) => {
      if (String(path).includes('expec-junit-') && !String(path).includes('expec-junit-unit-')) { scratch = String(path); throw Object.assign(Error('actual cleanup operation refused'), { code: 'EACCES' }); }
      return original(path, options);
    });
    try {
      const result = await execute('Exact'); expect(result.status).toBe('failed');
      expect(stage(result).tests[0]?.state).toBe('passed'); expect(stage(result).native.closed).toBe(true);
      expect(result.problems).toContainEqual(expect.objectContaining({ code: 'native-cleanup-failed' }));
    } finally { failure.mockRestore(); if (scratch) await original(scratch, { recursive: true, force: true }); }
  });
  it('does not remove a replacement report directory after observing native results', async () => {
    const original = fs.readFile.bind(fs); let scratch = '', moved = '';
    const replace = vi.spyOn(fs, 'readFile').mockImplementation((async (...args: Parameters<typeof fs.readFile>) => {
      const data = await original(...args);
      if (String(args[0]).endsWith('open-test-report.xml')) {
        scratch = dirname(String(args[0])); moved = scratch + '-owned'; await fs.rename(scratch, moved); await fs.mkdir(scratch); await fs.writeFile(join(scratch, 'human.txt'), 'Keep replacement data.');
      }
      return data;
    }) as typeof fs.readFile);
    try {
      const result = await execute('Exact'); expect(result.status).toBe('failed'); expect(stage(result).tests[0]?.state).toBe('passed');
      expect(result.problems).toContainEqual(expect.objectContaining({ code: 'native-cleanup-failed' }));
      expect(await original(join(scratch, 'human.txt'), 'utf8')).toBe('Keep replacement data.');
    } finally { replace.mockRestore(); for (const path of [scratch, moved]) if (path) await fs.rm(path, { recursive: true, force: true }); }
  });
});
