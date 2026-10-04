import { afterAll, beforeAll, describe, it } from 'vitest';
import { PackageDriver } from '../driver/installed-package.js';
import { CompilerPilot } from '../dsl/compiler-pilot.js';

beforeAll(() => PackageDriver.prepare(), 240_000);
afterAll(() => PackageDriver.finish());

describe('the language develops useful compiler acceptance', () => {
  it('rejects a suppressed real compiler finding through its generated acceptance test', async () => {
    const pilot = await CompilerPilot.fromExamples(`  scenario "undeclared public capability is rejected" {
    when readSource("concept StoreGame {\\n  public saveGame\\n  capability save() returns Nothing\\n}")
    then expectProblem("unresolved-reference", "saveGame", 2, 10)
  }`);
    await pilot.initializeAndInstall();
    await pilot.rememberImplementation();
    await pilot.build();
    await pilot.expectCompilerContract();
    await pilot.useCompilerDriver('suppress-real-problems');
    await pilot.runGeneratedTests();
    pilot.expectMissingDiagnosticFails();
    await pilot.expectActualDiagnostic('unresolved-reference', 'saveGame', 2, 10);

    await pilot.useCompilerDriver('actual-packaged-compiler');
    await pilot.runGeneratedTests();
    pilot.expectPassed(['undeclared public capability is rejected']);
    await pilot.expectActualDiagnostic('unresolved-reference', 'saveGame', 2, 10);
    await pilot.expectImplementationKept();
  }, 600_000);

  it('adds the valid counterpart without rewriting the compiler or parser', async () => {
    const pilot = await CompilerPilot.fromExamples(`  scenario "undeclared public capability is rejected" {
    when readSource("concept StoreGame {\\n  public saveGame\\n  capability save() returns Nothing\\n}")
    then expectProblem("unresolved-reference", "saveGame", 2, 10)
  }`);
    await pilot.initializeAndInstall();
    await pilot.rememberImplementation();
    await pilot.build();
    await pilot.useCompilerDriver('actual-packaged-compiler');
    const valid = 'concept StoreGame {\n  public saveGame\n  capability saveGame() returns Nothing\n}';
    await pilot.addAcceptedSource(valid);
    await pilot.build();
    await pilot.runGeneratedTests();
    pilot.expectPassed(['undeclared public capability is rejected', 'matching capability is accepted']);
    await pilot.expectAcceptedSource(valid);
    await pilot.expectImplementationKept();
    await pilot.expectExistingCompilerRegressions();
  }, 600_000);
});
