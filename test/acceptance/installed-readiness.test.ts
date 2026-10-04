import { afterAll, beforeAll, it } from 'vitest';
import { PackageDriver } from '../driver/installed-package.js';
import { InstalledReadiness } from '../dsl/installed-readiness.js';

beforeAll(() => PackageDriver.prepare());
afterAll(() => PackageDriver.finish());

it('refuses verification when one current example loses its confirmed native association', async () => {
  const author = await InstalledReadiness.fromSource('examples { example "one": 1 => 1\nexample "two": 2 => 2 }');
  await author.initializeAndInstall();
  await author.build();
  await author.runTests();
  await author.expectCollectedAndPassed(['one', 'two']);

  await author.withdrawConfirmedCase('two');
  await author.rememberProjectFiles();
  await author.runTests();
  author.expectProblem('generated-tests-not-executed');
  author.expectExit(1);
  await author.expectNoNativeExecution();
  await author.expectProjectFilesUnchanged();
}, 600_000);
