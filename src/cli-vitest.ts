import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hash } from './project-files.js';
import type { SelectedTest } from './cli-test.js';
import type { TestCase, Vitest } from 'vitest/node';

/** Native process boundary: application logs never share the host's JSON result stream. */
process.once('message', async (input: { runner: string; selections: SelectedTest[] }) => {
  const report = { tests: [] as { id: string; file: string; title: string; state: string; errors: unknown[] }[], errors: [] as unknown[],
    problems: [] as { code: string; message: string }[], cancelled: false };
  let vitest: Vitest | undefined;
  process.on('message', (message: { cancel?: boolean }) => { if (message.cancel) { report.cancelled = true; void vitest?.cancelCurrentRun('keyboard-input'); } });
  const selected = input.selections, key = (path: string) => process.platform === 'win32' ? normalize(path).toLowerCase() : normalize(path);
  const matches = (test: TestCase, item: SelectedTest) => key(test.module.moduleId) === key(join(process.cwd(), item.file))
    && test.name === item.title && test.location?.line === item.line && test.location.column === item.column;
  const verify = async () => { for (const item of selected) if (hash(await readFile(item.file)) !== item.version) throw Error('Selected native file changed: ' + item.file); };
  try {
    await verify();
    const { createVitest } = await import(pathToFileURL(input.runner).href) as typeof import('vitest/node');
    vitest = await createVitest({ root: process.cwd(), watch: false, includeTaskLocation: true, reporters: [{ onUserConsoleLog(log) { process.stderr.write(log.content); } }] });
    await vitest.standalone();
    const files = new Set(selected.map(item => key(join(process.cwd(), item.file)))), specs = (await vitest.globTestSpecifications()).filter(spec => files.has(key(spec.moduleId)));
    const collected = await vitest.collectTests(specs), tests = collected.testModules.flatMap(module => [...module.children.allTests()]);
    report.errors.push(...collected.unhandledErrors, ...collected.testModules.flatMap(module => module.errors()));
    if (selected.some(item => tests.filter(test => matches(test, item)).length !== 1)) report.problems.push({ code: 'generated-tests-not-executed', message: 'Native collection did not identify every selected callback exactly once.' });
    if (!report.errors.length && !report.problems.length && !report.cancelled) {
      await verify();
      const run = await vitest.runTestSpecifications(collected.testModules.map(module => module.toTestSpecification([...module.children.allTests()].filter(test => selected.some(item => matches(test, item))))));
      report.errors.push(...run.unhandledErrors, ...run.testModules.flatMap(module => module.errors()));
      for (const item of selected) for (const test of run.testModules.flatMap(module => [...module.children.allTests()]).filter(test => matches(test, item)))
        report.tests.push({ id: item.id, file: item.file, title: test.name, state: test.result().state, errors: [...test.result().errors ?? []] });
      if (selected.some(item => report.tests.filter(test => test.id === item.id && test.state === 'passed').length !== 1))
        report.problems.push({ code: 'generated-tests-not-executed', message: 'Every selected generated case must actually finish passing; skipped, pending or failed cases are not verification.' });
    }
  } catch (error) { report.errors.push({ message: String(error) }); }
  finally { try { await vitest?.close(); } catch (error) { report.errors.push({ message: String(error) }); } }
  process.exitCode = report.cancelled ? 130 : report.problems.length || report.errors.length ? 1 : 0;
  process.send?.(report, () => process.disconnect());
});
