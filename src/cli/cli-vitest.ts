import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join, normalize, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hash } from '../project/connection/project-files.js';
import { testsPassed, type NativeReport, type SelectedTest } from './cli-test-result.js';
import type { TestCase, Vitest } from 'vitest/node';

/** Native process boundary: application logs never share the host's JSON result stream. */
process.once('message', async (input: { runner: string; selections: SelectedTest[] }) => {
  const report: NativeReport = { collected: [], tests: [], errors: [], problems: [], cancelled: false };
  let vitest: Vitest | undefined;
  process.on('message', (message: { cancel?: boolean }) => { if (message.cancel) { report.cancelled = true; void vitest?.cancelCurrentRun('keyboard-input'); } });
  const selected = input.selections, root = process.cwd(), key = (path: string) => process.platform === 'win32' ? normalize(path).toLowerCase() : normalize(path);
  const matches = (test: TestCase, item: SelectedTest) => key(test.module.moduleId) === key(join(root, item.file))
    && test.name === item.title && test.location?.line === item.line && test.location.column === item.column;
  const at = (test: TestCase) => ({ id: selected.find(item => matches(test, item))?.id, file: relative(root, test.module.moduleId).replaceAll('\\', '/'),
    title: test.name, line: test.location?.line, column: test.location?.column });
  const problem = (code: string, message: string) => { report.problems.push({ code, message }); };
  const verify = async () => { for (const item of selected) if (hash(await readFile(item.file)) !== item.version) throw Error('Selected native file changed: ' + item.file); };
  const require = createRequire(join(root, 'package.json'));
  const installed = (name: string) => { try { const path = relative(join(root, 'node_modules'), require.resolve(name)); return !isAbsolute(path) && !path.startsWith('..'); } catch { return false; } };
  try {
    await verify();
    const { createVitest } = await import(pathToFileURL(input.runner).href) as typeof import('vitest/node');
    vitest = await createVitest({ root, watch: false, update: 'none', retry: 0, repeats: 0, includeTaskLocation: true,
      reporters: [{ onUserConsoleLog(log) { process.stderr.write(log.content); } }] }, undefined,
      { packageInstaller: { isPackageExists: installed, ensureInstalled: async name => installed(name) } });
    await vitest.standalone();
    const files = new Set(selected.map(item => key(join(root, item.file)))), specs = (await vitest.globTestSpecifications()).filter(spec => files.has(key(spec.moduleId)));
    if ([...files].some(file => specs.filter(spec => key(spec.moduleId) === file).length > 1)
      || specs.some(spec => spec.pool === 'browser' || spec.pool === 'typescript' || spec.project.config.browser.enabled || spec.project.config.typecheck.only))
      problem('unsupported-native-execution', 'Each selected file requires one ordinary runtime project; browser, typecheck and duplicate projects are unsupported.');
    if ([...files].some(file => !specs.some(spec => key(spec.moduleId) === file))) problem('generated-tests-not-executed', 'A selected file was not collected by the native configuration.');
    if (!report.problems.length && !report.cancelled) {
      const collected = await vitest.collectTests(specs), tests = collected.testModules.flatMap(module => [...module.children.allTests()]);
      report.collected.push(...tests.map(at));
      report.errors.push(...collected.unhandledErrors, ...collected.testModules.flatMap(module => module.errors()));
      if (selected.some(item => tests.filter(test => matches(test, item)).length !== 1)) problem('generated-tests-not-executed', 'Native collection did not identify every selected callback exactly once.');
      if (tests.some(test => selected.some(item => matches(test, item)) && (test.options.retry || test.options.repeats)))
        problem('unsupported-native-execution', 'Explicit retries and repeats cannot establish a single generated execution.');
      if (!report.errors.length && !report.problems.length && !report.cancelled) {
        await verify();
        const run = await vitest.runTestSpecifications(collected.testModules.map(module => module.toTestSpecification([...module.children.allTests()].filter(test => selected.some(item => matches(test, item))))));
        report.errors.push(...run.unhandledErrors, ...run.testModules.flatMap(module => module.errors()));
        for (const test of run.testModules.flatMap(module => [...module.children.allTests()])) {
          const diagnostic = test.diagnostic();
          report.tests.push({ ...at(test), state: test.result().state, errors: [...test.result().errors ?? []], retryCount: diagnostic?.retryCount, repeatCount: diagnostic?.repeatCount });
        }
        if (!testsPassed(selected, report)) problem('generated-tests-not-executed', 'Every selected case must finish passing once; missing, duplicate, unexpected or incomplete execution cannot verify the specification.');
      }
    }
  } catch (error) { report.errors.push({ message: String(error) }); }
  finally { try { await vitest?.close(); } catch (error) { report.errors.push({ message: String(error) }); } }
  process.exitCode = report.cancelled ? 130 : testsPassed(selected, report) ? 0 : 1;
  process.send?.(report, () => process.disconnect());
});
