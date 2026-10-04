import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyInstalledPackages } from '../driver/typescript-context.js';
import { ConnectedBuildDriver } from '../driver/connected-build.js';
import type { NativeReport } from '../../src/cli-test-result.js';

describe('the private native invocation preserves exact execution evidence', () => {
  let root: string, parent: string, runner: string;
  const entry = fileURLToPath(new URL('../../dist/cli-vitest.js', import.meta.url));
  beforeAll(async () => {
    await ConnectedBuildDriver.prepare(); parent = await realpath(tmpdir()); root = await realpath(await mkdtemp(join(parent, 'expec-native-run-')));
    await writeFile(join(root, 'package.json'), '{"type":"module"}'); await copyInstalledPackages(root, { vitest: '5.0.2' });
    runner = createRequire(join(root, 'package.json')).resolve('vitest/node');
  }, 100_000);
  afterAll(async () => { if (root) { if (dirname(await realpath(root)) !== parent) throw Error('Unexpected fixture root.'); await rm(root, { recursive: true, force: true }); } });
  async function run(source: string, config = '{}'): Promise<{ code: number | null; report: NativeReport; stderr: string }> {
    await writeFile(join(root, 'case.test.ts'), source);
    await writeFile(join(root, 'vitest.config.ts'), 'export default ' + config + ';');
    await rm(join(root, 'events.txt'), { force: true }); await rm(join(root, 'collected.txt'), { force: true });
    return new Promise((resolve, reject) => {
      const child = fork(entry, [], { cwd: root, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [], env: { ...process.env, NODE_PATH: '' } });
      let report: NativeReport, stderr = '';
      const deadline = setTimeout(() => { child.kill(); reject(Error('Native invocation exceeded 30 seconds: ' + stderr)); }, 30_000);
      child.stderr!.on('data', data => { stderr += String(data); }); child.on('message', value => { report = value as NativeReport; });
      child.on('error', reject); child.on('close', code => { clearTimeout(deadline); if (!report) reject(Error('No native report: ' + stderr)); else resolve({ code, report, stderr }); });
      child.send({ runner, selections: [{ id: 'selected', file: 'case.test.ts', title: 'selected', line: 2, column: 1, version: createHash('sha256').update(source).digest('hex') }] });
    });
  }
  const imports = 'import { test, expect } from "vitest"; import { appendFileSync, writeFileSync } from "node:fs";\n';
  async function untouched(): Promise<void> { await expect(stat(join(root, 'events.txt'))).rejects.toMatchObject({ code: 'ENOENT' }); }
  it('keeps collected and skipped neighbors visible without executing them', async () => {
    const result = await run(imports + 'test("selected", () => { appendFileSync("events.txt", "selected\\n"); });\ntest("neighbor", () => { throw Error("unselected"); });');
    expect(result).toMatchObject({ code: 0, report: { collected: [{ id: 'selected', title: 'selected', line: 2, column: 1 }, { title: 'neighbor', line: 3, column: 1 }], tests: [{ id: 'selected', state: 'passed', retryCount: 0, repeatCount: 0 }, { title: 'neighbor', state: 'skipped' }] } });
    expect(await readFile(join(root, 'events.txt'), 'utf8')).toBe('selected\n');
  }, 40_000);
  it('refuses a per-case retry before executing its callback', async () => {
    const result = await run(imports + 'test("selected", { retry: 1 }, () => { appendFileSync("events.txt", "called"); });');
    expect(result).toMatchObject({ code: 1, report: { problems: [{ code: 'unsupported-native-execution' }] } }); await untouched();
  }, 40_000);
  it('refuses a per-case repeat before executing its callback', async () => {
    const result = await run(imports + 'test("selected", { repeats: 1 }, () => { appendFileSync("events.txt", "called"); });');
    expect(result).toMatchObject({ code: 1, report: { problems: [{ code: 'unsupported-native-execution' }] } }); await untouched();
  }, 40_000);
  it('overrides configured retries and repeats to make one actual attempt', async () => {
    const result = await run(imports + 'test("selected", () => { appendFileSync("events.txt", "called\\n"); });', '{ test: { retry: 2, repeats: 2 } }');
    expect(result.code, result.stderr).toBe(0); expect(await readFile(join(root, 'events.txt'), 'utf8')).toBe('called\n');
    expect(result.report.tests).toMatchObject([{ retryCount: 0, repeatCount: 0 }]);
  }, 40_000);
  it('does not create a snapshot merely because native config requests updates', async () => {
    const result = await run(imports + 'test("selected", () => { expect("new snapshot").toMatchSnapshot(); });', '{ test: { update: true } }');
    expect(result.code).toBe(1); expect(result.report.tests).toMatchObject([{ state: 'failed' }]);
    await expect(stat(join(root, '__snapshots__/case.test.ts.snap'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 40_000);
  it('refuses two configured projects claiming the selected module before collection', async () => {
    const result = await run(imports + 'test("selected", () => { appendFileSync("events.txt", "called"); });\nwriteFileSync("collected.txt", "evaluated");', '{ test: { projects: [{ test: { name: "first", include: ["case.test.ts"] } }, { test: { name: "second", include: ["case.test.ts"] } }] } }');
    expect(result).toMatchObject({ code: 1, report: { problems: [{ code: 'unsupported-native-execution' }] } }); await untouched();
    await expect(stat(join(root, 'collected.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 40_000);
  it('refuses typecheck-only selection before collecting runtime code', async () => {
    const result = await run(imports + 'test("selected", () => { appendFileSync("events.txt", "called"); });\nwriteFileSync("collected.txt", "evaluated");', '{ test: { typecheck: { enabled: true, only: true, include: ["case.test.ts"] } } }');
    expect(result).toMatchObject({ code: 1, report: { problems: [{ code: 'unsupported-native-execution' }] } }); await untouched();
    await expect(stat(join(root, 'collected.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 40_000);
  it('bounds cancellation when a running native callback cannot finish cleanup', async () => {
    const source = imports + 'test("selected", async () => { writeFileSync("native-worker.pid", String(process.pid)); setTimeout(() => process.exit(0), 20000).unref(); process.stdout.write("native-cancellation-ready"); await new Promise(() => {}); });';
    await writeFile(join(root, 'case.test.ts'), source);
    await writeFile(join(root, 'global-setup.ts'), 'export default function setup() { return async () => { await new Promise(resolve => setTimeout(resolve, 12000)); }; }');
    await writeFile(join(root, 'vitest.config.ts'), 'export default { test: { pool: "forks", testTimeout: 30000, teardownTimeout: 30000, globalSetup: ["./global-setup.ts"] } };');
    const controller = new AbortController(), write = process.stderr.write.bind(process.stderr);
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array, ...args: unknown[]) => {
      if (String(chunk).includes('native-cancellation-ready')) controller.abort();
      return (write as (...args: unknown[]) => boolean)(chunk, ...args);
    }) as typeof process.stderr.write);
    try {
      const { runSelectedTests } = await import(new URL('../../dist/cli-test.js', import.meta.url).href) as typeof import('../../src/cli-test.js');
      const result = await runSelectedTests({ path: root, identity: 'native-fixture' }, join(root, 'expec.json'), runner,
        [{ id: 'selected', file: 'case.test.ts', title: 'selected', line: 2, column: 1, version: createHash('sha256').update(source).digest('hex') }], controller.signal);
      expect(controller.signal.aborted).toBe(true);
      expect(result).toMatchObject({ status: 'cancelled', exitCode: 130, problems: expect.arrayContaining([expect.objectContaining({ code: 'native-test-terminated' })]),
        stages: [{ name: 'execution', status: 'failed', native: { signal: 'SIGKILL' } }] });
      const worker = Number(await readFile(join(root, 'native-worker.pid'), 'utf8'));
      expect(Number.isSafeInteger(worker) && worker > 0 && worker !== process.pid).toBe(true);
      let running = false; try { process.kill(worker, 0); running = true; } catch (error) { if ((error as { code?: string }).code !== 'ESRCH') throw error; }
      expect(running, 'The exact native worker that ran the selected callback must not survive its cancelled host.').toBe(false);
    } finally { vi.restoreAllMocks(); }
  }, 45_000);

});
