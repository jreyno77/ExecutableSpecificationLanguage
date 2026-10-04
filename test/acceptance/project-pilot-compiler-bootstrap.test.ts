import { afterAll, beforeAll, describe, it } from 'vitest';
import { PackageDriver } from '../driver/installed-package.js';
import { CompilerPilot } from '../dsl/compiler-pilot.js';

beforeAll(() => PackageDriver.prepare(), 240_000);
afterAll(() => PackageDriver.finish());

describe('the language develops useful compiler acceptance', () => {
  it('bootstraps a fresh working copy while the candidate generated DSL remains broken', async () => {
    const pilot = await CompilerPilot.fromExamples(`  scenario "undeclared public capability is rejected" {
    when readSource("concept StoreGame {\\n  public saveGame\\n  capability save() returns Nothing\\n}")
    then expectProblem("unresolved-reference", "saveGame", 2, 10)
  }`);
    await pilot.initializeAndInstall();
    await pilot.rememberImplementation();
    await pilot.build();
    await pilot.useCompilerDriver('actual-packaged-compiler');
    await pilot.retainBootstrap();
    await pilot.breakGeneratedDsl();
    await pilot.expectCandidateSyntaxFailure();

    await pilot.bootstrapFreshCopy();
    await pilot.build();
    await pilot.restoreTrustedDriver();
    await pilot.runGeneratedTests();
    pilot.expectPassed(['undeclared public capability is rejected']);
    await pilot.expectActualDiagnostic('unresolved-reference', 'saveGame', 2, 10);
    await pilot.expectTrustedBootstrapUsed();
  }, 600_000);
});
