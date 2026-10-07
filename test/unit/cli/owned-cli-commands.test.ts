import childProcess, { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, it, onTestFinished, vi } from 'vitest';
import { ConnectedBuildDriver } from '../../driver/cli/connected-build.js';

const execute = promisify(execFile);
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

class Fixture extends ConnectedBuildDriver {
  async launcherText(text: string): Promise<void> {
    this.launcher = this.path('command.mjs'); await this.write('command.mjs', text);
  }
}

async function ownedCli() {
  const owner = new AbortController(), driver = new Fixture(owner.signal);
  await driver.initialize(false);
  const parent = await fs.realpath(tmpdir()), evidence = await fs.mkdtemp(join(parent, 'expec-owned-cli-proof-'));
  const ready = join(evidence, 'ready.json'), nativeReady = join(evidence, 'native-ready.txt'), activity = join(evidence, 'activity.txt');
  const commands: Promise<void>[] = [];
  let pids: number[] = [];
  let stopRefused = false;
  onTestFinished(async () => {
    for (const pid of [...pids].reverse()) if (alive(pid)) {
      if (process.platform === 'win32') await execute('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
      else { try { process.kill(pid, 'SIGKILL'); } catch { /* Already stopped. */ } }
    }
    await Promise.allSettled(commands);
    if (await fs.stat(driver.directory).then(() => true, () => false)) {
      if (!stopRefused) await driver.dispose();
      else {
        if (dirname(await fs.realpath(driver.directory)) !== parent) throw Error('Unexpected failed fixture cleanup.');
        await fs.rm(driver.directory, { recursive: true, force: true });
      }
    }
    if (dirname(await fs.realpath(evidence)) !== parent) throw Error('Unexpected command evidence cleanup.');
    await fs.rm(evidence, { recursive: true, force: true });
  }, 10_000);
  return {
    driver, owner, activity,
    run(args: string[] = [], answers?: string[], deadline?: number) {
      const running = driver.run(args, '', answers, deadline); commands.push(running); void running.catch(() => {}); return running;
    },
    async startTree(): Promise<{ running: Promise<void> }> {
      const native = 'const fs=require("node:fs");fs.writeFileSync(' + JSON.stringify(nativeReady) + ',"ready");setInterval(()=>fs.appendFileSync(' + JSON.stringify(activity) + ',"native\\n"),10);';
      await driver.launcherText('import {spawn} from "node:child_process";import fs from "node:fs";' +
        'const native=spawn(process.execPath,["-e",' + JSON.stringify(native) + '],{stdio:"inherit"});' +
        'fs.writeFileSync(' + JSON.stringify(ready) + ',JSON.stringify([process.pid,native.pid]));' +
        'setInterval(()=>fs.appendFileSync(' + JSON.stringify(activity) + ',"cli\\n"),10);');
      const running = driver.run([]); commands.push(running); void running.catch(() => {});
      await vi.waitFor(async () => { pids = JSON.parse(await fs.readFile(ready, 'utf8')); expect(await fs.readFile(nativeReady, 'utf8')).toBe('ready'); });
      expect(pids).toHaveLength(2); expect(pids.every(pid => Number.isInteger(pid) && pid > 0 && alive(pid))).toBe(true);
      return { running };
    },
    async expectStopped() { await vi.waitFor(() => expect(pids.map(alive)).toEqual([false, false])); },
    async expectRemoved() { await expect(fs.stat(driver.directory)).rejects.toMatchObject({ code: 'ENOENT' }); },
    observeRemoval() {
      const remove = fs.rm.bind(fs); let observed = false;
      const mock = vi.spyOn(fs, 'rm').mockImplementation(async (path, options) => {
        if (String(path) === driver.directory) { observed = true; expect(pids.map(alive)).toEqual([false, false]); }
        return remove(path, options);
      });
      syncBuiltinESMExports();
      onTestFinished(() => { mock.mockRestore(); syncBuiltinESMExports(); });
      return () => { mock.mockRestore(); syncBuiltinESMExports(); expect(observed).toBe(true); };
    },
    refuseStop() {
      stopRefused = true;
      if (process.platform === 'win32') {
        vi.stubEnv('SystemRoot', join(evidence, 'unavailable-system'));
        return () => vi.unstubAllEnvs();
      }
      const kill = process.kill.bind(process);
      const mock = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
        if (pid < 0) throw Object.assign(Error('Deliberate process-group stop refusal'), { code: 'EPERM' });
        return kill(pid, signal);
      });
      return () => mock.mockRestore();
    },
    withholdClosure() {
      stopRefused = true;
      const spawn = childProcess.spawn.bind(childProcess); let replay: (() => void) | undefined;
      const mock = vi.spyOn(childProcess, 'spawn').mockImplementation(((...args: Parameters<typeof childProcess.spawn>) => {
        const child = spawn(...args), emit = child.emit.bind(child);
        child.emit = ((event: string | symbol, ...values: unknown[]) => {
          if (event === 'close') { replay = () => emit(event, ...values); return true; }
          return emit(event, ...values);
        }) as typeof child.emit;
        return child;
      }) as typeof childProcess.spawn);
      syncBuiltinESMExports();
      return () => { mock.mockRestore(); syncBuiltinESMExports(); replay?.(); };
    },
  };
}

it('stops a cancelled fixture command and its native child before cleanup', async () => {
  const p = await ownedCli(), { running } = await p.startTree();
  p.owner.abort(Error('Owning case cancelled'));
  await p.expectStopped();
  await expect(running).rejects.toThrow('Owning case cancelled');
  await p.driver.dispose();
  await p.expectRemoved();
});

it('stops unfinished native work before explicit disposal removes the project', async () => {
  const p = await ownedCli(), { running } = await p.startTree();
  const confirmRemoval = p.observeRemoval();
  await p.driver.dispose();
  await expect(running).rejects.toThrow('fixture was disposed');
  confirmRemoval(); await p.expectStopped(); await p.expectRemoved();
});

it('does not let a cancelled fixture launch into the next fixture lifetime', async () => {
  const old = await ownedCli(), next = await ownedCli();
  const { running } = await old.startTree();
  old.owner.abort(Error('Old owner ended'));
  await expect(running).rejects.toThrow('Old owner ended');
  await old.expectStopped();
  const before = await fs.readFile(old.activity);
  await expect(old.driver.run([])).rejects.toThrow('Old owner ended');
  await next.driver.launcherText('console.log(JSON.stringify({status:"built"}));');
  await next.run(['--json']);
  expect(next.driver.result.code).toBe(0); expect(next.driver.report).toEqual({ status: 'built' });
  await old.driver.dispose();
  expect((await fs.stat(next.driver.directory)).isDirectory()).toBe(true);
  expect(await fs.readFile(old.activity)).toEqual(before);
});

it('preserves successful JSON, split UTF-8 and stderr from the real command', async () => {
  const p = await ownedCli();
  await p.driver.launcherText('process.stdout.write(Buffer.from([123,34,116,101,120,116,34,58,34,195]));' +
    'process.stderr.write(Buffer.from([195]));setImmediate(()=>{process.stdout.write(Buffer.from([169,34,125]));process.stderr.write(Buffer.from([169]));});');
  await p.run(['--json']);
  expect(p.driver.result).toEqual({ code: 0, stdout: '{"text":"é"}', stderr: 'é' });
  expect(p.driver.report).toEqual({ text: 'é' });
  await p.driver.dispose();
  await expect(p.driver.run([])).rejects.toThrow('fixture was disposed');
});

it('preserves a real nonzero JSON result instead of calling it cancellation', async () => {
  const p = await ownedCli();
  await p.driver.launcherText('console.log(JSON.stringify({status:"failed",problems:["Wrong quantity"]}));process.stderr.write("native detail\\n");process.exitCode=2;');
  await p.run(['--json']);
  expect(p.driver.result).toEqual({ code: 2, stdout: '{"status":"failed","problems":["Wrong quantity"]}\n', stderr: 'native detail\n' });
  expect(p.driver.report).toEqual({ status: 'failed', problems: ['Wrong quantity'] });
});

it('preserves the answer to a real interactive prompt', async () => {
  const p = await ownedCli();
  await p.driver.launcherText('process.stderr.write("Continue? ");process.stdin.once("data",answer=>{process.stdout.write(answer);process.stdin.destroy();});');
  await p.run([], ['yes']);
  expect(p.driver.result).toEqual({ code: 0, stdout: 'yes\n', stderr: 'Continue? ' });
  expect(p.driver.report).toBeUndefined();
});

it('cancels an unfinished interactive command', async () => {
  const p = await ownedCli();
  await p.driver.launcherText('import fs from "node:fs";fs.writeFileSync("prompt-ready","ready");process.stderr.write("Continue? ");process.stdin.resume();');
  const running = p.run([], []);
  await vi.waitFor(async () => expect(await fs.readFile(p.driver.path('prompt-ready'), 'utf8')).toBe('ready'));
  p.owner.abort(Error('Prompt owner ended'));
  await expect(running).rejects.toThrow('Prompt owner ended');
  await p.driver.dispose(); await p.expectRemoved();
});

it('retains both captured streams when its owner cancels the command', async () => {
  const p = await ownedCli();
  await p.driver.launcherText('import fs from "node:fs";process.stdout.write("partial build output\\n",()=>process.stderr.write("native warning\\n",()=>fs.writeFileSync("output-ready","ready")));setInterval(()=>{},1000);');
  const running = p.run(), observed = running.catch(error => error);
  await vi.waitFor(async () => expect(await fs.readFile(p.driver.path('output-ready'), 'utf8')).toBe('ready'));
  const reason = Error('Diagnostic owner ended'); p.owner.abort(reason);
  const failure = await observed;
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toContain('Diagnostic owner ended');
  expect(failure.message).toContain('partial build output');
  expect(failure.message).toContain('native warning');
  expect(failure).toMatchObject({ stdout: 'partial build output\n', stderr: 'native warning\n', cause: reason });
  await p.driver.dispose(); await p.expectRemoved();
});

it('stops the command tree when its own deadline expires', async () => {
  const p = await ownedCli();
  await p.driver.launcherText('setInterval(()=>{},1000);');
  await expect(p.run([], undefined, 100)).rejects.toThrow('100ms fixture deadline');
  await p.driver.dispose(); await p.expectRemoved();
});

it('retains the fixture when its platform stop fails', async () => {
  const p = await ownedCli(), { running } = await p.startTree();
  const restore = p.refuseStop();
  try {
    await expect(p.driver.dispose()).rejects.toThrow('termination or closure was not confirmed');
    await expect(running).rejects.toThrow('termination or closure was not confirmed');
    expect((await fs.stat(p.driver.directory)).isDirectory()).toBe(true);
  } finally { restore(); }
});

it('retains the four-MiB output bound while stopping the real command', async () => {
  const p = await ownedCli();
  await p.driver.launcherText('process.stdout.write("x".repeat(4*1024*1024+1));setInterval(()=>{},1000);');
  await expect(p.run()).rejects.toThrow('stdout exceeded four MiB');
  await p.driver.dispose(); await p.expectRemoved();
});

it('bounds interactive stderr while stopping the real command', async () => {
  const p = await ownedCli();
  await p.driver.launcherText('process.stderr.write("x".repeat(4*1024*1024+1));process.stdin.resume();');
  await expect(p.run([], [])).rejects.toThrow('stderr exceeded four MiB');
  await p.driver.dispose(); await p.expectRemoved();
});

it('settles a failed launch without leaving an unclosed cleanup obligation', async () => {
  const p = await ownedCli();
  await expect(p.driver.run([], 'missing-directory')).rejects.toMatchObject({ code: 'ENOENT' });
  await p.driver.dispose(); await p.expectRemoved();
});

it('retains the fixture when actual command closure was not observed', async () => {
  const p = await ownedCli(), restore = p.withholdClosure();
  try {
    const { running } = await p.startTree();
    await expect(p.driver.dispose()).rejects.toThrow('termination or closure was not confirmed');
    await expect(running).rejects.toThrow('termination or closure was not confirmed');
    await p.expectStopped();
    expect((await fs.stat(p.driver.directory)).isDirectory()).toBe(true);
  } finally { restore(); }
}, 10_000);

it('captures the actual Vitest owner before its timed-out body is abandoned', async () => {
  const checkout = fileURLToPath(new URL('../../../', import.meta.url));
  const parent = await fs.realpath(tmpdir()), root = await fs.mkdtemp(join(parent, 'expec-owner-runner-'));
  const test = join(root, 'owner.test.ts'), config = join(root, 'vitest.config.mjs'), report = join(root, 'report.json'), receipt = join(root, 'receipt.json');
  await fs.writeFile(config, 'export default ' + JSON.stringify({ root, test: { include: ['owner.test.ts'], maxWorkers: 1, environment: 'node' } }));
  await fs.writeFile(test, `import { afterEach, expect, it, TestRunner } from ${JSON.stringify(resolve(checkout, 'node_modules/vitest/dist/index.js').replaceAll('\\', '/'))};
import { promises as fs } from 'node:fs';
import { ConnectedBuildDriver } from ${JSON.stringify(resolve(checkout, 'test/driver/cli/connected-build.ts').replaceAll('\\', '/'))};
let driver, signal;
class Fixture extends ConnectedBuildDriver { async start() { this.launcher=this.path('wait.mjs'); await this.write('wait.mjs','setInterval(()=>{},1000);'); return this.run([]); } }
it('owns the waiting CLI', async()=>{signal=TestRunner.getCurrentTest().context.signal;driver=new Fixture();await driver.initialize(false);await driver.start();},500);
afterEach(async()=>{await driver.dispose();await expect(fs.stat(driver.directory)).rejects.toMatchObject({code:'ENOENT'});await fs.writeFile(${JSON.stringify(receipt)},JSON.stringify({aborted:signal.aborted,reason:String(signal.reason),removed:true}));},10000);
`);
  try {
    const result = await execute(process.execPath, [join(checkout, 'node_modules/vitest/vitest.mjs'), 'run', '--config', config, '--reporter=json', '--outputFile=' + report],
      { cwd: checkout, windowsHide: true, timeout: 15_000 }).then(value => ({ code: 0, ...value }), error => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
    expect(result.code, result.stdout + result.stderr).toBe(1);
    const observed = JSON.parse(await fs.readFile(report, 'utf8'));
    expect(observed.numFailedTests).toBe(1); expect(observed.testResults[0].assertionResults[0].failureMessages.join('\n')).toContain('Test timed out in 500ms');
    expect(observed.unhandledErrors ?? []).toEqual([]);
    expect(JSON.parse(await fs.readFile(receipt, 'utf8'))).toEqual({ aborted: true, reason: expect.stringContaining('Test timed out in 500ms'), removed: true });
  } finally {
    if (dirname(await fs.realpath(root)) !== parent) throw Error('Unexpected runner evidence cleanup.');
    await fs.rm(root, { recursive: true, force: true });
  }
}, 20_000);
