import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { JavaCliDriver } from '../driver/java-cli.js';
import { checkManifest, type CheckedManifest } from '../../src/cli-check.js';
import { testJava } from '../../src/cli-java-test.js';
import { javaCliExclusions } from '../../src/cli-java.js';
import { Outputs, javaOutput, javaAcceptanceOutput, ProjectConnector, type ProjectContext } from '../../src/index.js';

const fixture = new JavaCliDriver(), outputs = new Outputs();
let checked: CheckedManifest, context: ProjectContext;
beforeAll(async () => {
  outputs.register(javaOutput); outputs.register(javaAcceptanceOutput);
  await JavaCliDriver.prepare(); await fixture.initializeJava();
  await fixture.source('examples { action start()\nobservation quantity(title: Text) returns Number\ncheck expectQuantity(title: Text, expected: Number) { assert quantity(title) == expected }\nscenario "Dune quantity" { when start()\nthen expectQuantity("Dune", 1) } }');
  for (const command of ['init', 'install', 'build']) {
    if (command === 'init') await fixture.init(); else await fixture.cli(command);
    expect(fixture.result.code, fixture.result.stdout + fixture.result.stderr).toBe(0);
  }
  await fixture.write('project/src/test/java/generated/tests/driver/ShoppingDriver.java', 'package generated.tests.driver; public class ShoppingDriver { public void start() {} public double quantity(String title) { return 1; } }');
  checked = await checkManifest(fixture.path('spec/expec.json'), outputs.profiles);
  expect(checked.problems).toEqual([]);
  const connection = await new ProjectConnector(checked.manifest, { excludeNames: javaCliExclusions }).connect(checked.configuration!);
  if (connection.value?.status !== 'connected') throw Error('Expected real Java connection.'); context = connection.value.context;
}, 180_000);
afterAll(() => fixture.directory ? fixture.dispose() : undefined);
const execute = () => testJava(checked, context, outputs, new AbortController().signal);
const passedNative = (result: Awaited<ReturnType<typeof execute>>) => {
  expect(result.stages.filter(stage => stage.name.startsWith('compilation:')).every(stage => stage.status === 'passed')).toBe(true);
  expect(result.stages.find(stage => stage.name === 'execution')).toMatchObject({ tests: [{ state: 'passed' }] });
  expect(result.problems).toContainEqual(expect.objectContaining({ code: 'native-cleanup-failed' }));
  expect(result.status).toBe('failed');
};

describe('Java compilation scratch retains observed results', { timeout: 90_000 }, () => {
  it('reports cleanup failure after real compilation and execution', async () => {
    const original = fs.rm.bind(fs); let scratch = '';
    const failure = vi.spyOn(fs, 'rm').mockImplementation(async (path, options) => {
      if (String(path).includes('expec-java-test-')) { scratch = String(path); throw Object.assign(Error('Cannot remove actual compiled scratch'), { code: 'EACCES' }); }
      return original(path, options);
    });
    try { passedNative(await execute()); }
    finally { failure.mockRestore(); if (scratch) await original(scratch, { recursive: true, force: true }); }
  });
  it('retains replacement data when the compiled directory changes after execution', async () => {
    const create = fs.mkdtemp.bind(fs), read = fs.readFile.bind(fs); let scratch = '', moved = '';
    const created = vi.spyOn(fs, 'mkdtemp').mockImplementation((async (...args: Parameters<typeof fs.mkdtemp>) => {
      const path = await create(...args); if (String(args[0]).includes('expec-java-test-')) scratch = String(path); return path;
    }) as typeof fs.mkdtemp);
    const replaced = vi.spyOn(fs, 'readFile').mockImplementation((async (...args: Parameters<typeof fs.readFile>) => {
      const bytes = await read(...args);
      if (String(args[0]).endsWith('open-test-report.xml')) {
        moved = scratch + '-owned'; await fs.rename(scratch, moved); await fs.mkdir(scratch); await fs.writeFile(join(scratch, 'human.txt'), 'Keep this replacement.');
      }
      return bytes;
    }) as typeof fs.readFile);
    try { passedNative(await execute()); expect(await read(join(scratch, 'human.txt'), 'utf8')).toBe('Keep this replacement.'); }
    finally { created.mockRestore(); replaced.mockRestore(); for (const path of [scratch, moved]) if (path) await fs.rm(path, { recursive: true, force: true }); }
  });
  it('retains actual executed tests when final project recapture throws', async () => {
    const read = fs.readFile.bind(fs); let executed = false;
    const observed = vi.spyOn(fs, 'readFile').mockImplementation((async (...args: Parameters<typeof fs.readFile>) => {
      const bytes = await read(...args); if (String(args[0]).endsWith('open-test-report.xml')) executed = true; return bytes;
    }) as typeof fs.readFile);
    try {
      const result = await testJava(checked, { root: context.root, readSnapshot: () => {
        if (executed) throw Error('Actual final source capture is unavailable.'); return context.readSnapshot();
      } }, outputs, new AbortController().signal);
      expect(result.status).toBe('failed');
      expect(result.problems).toContainEqual(expect.objectContaining({ code: 'native-test-failure', message: expect.stringContaining('final source capture') }));
      expect(result.stages.find(stage => stage.name === 'execution')).toMatchObject({ tests: [{ state: 'passed' }] });
    } finally { observed.mockRestore(); }
  });
});
