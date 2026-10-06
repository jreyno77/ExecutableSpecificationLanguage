import { afterEach, describe, it } from 'vitest';
import { PythonAcceptance } from '../../../dsl/project/python/python-acceptance.js';

afterEach(() => PythonAcceptance.dispose());
describe('current Python scenario verification', { timeout: 240_000 }, () => {
  it('refuses an empty generated scenario even when its function and identity remain', async () => {
    const shopping = await PythonAcceptance.create();
    shopping.aShopperCanAddAnAvailableBook('Dune', 1);
    await shopping.generateTests(); await shopping.emptyGeneratedScenario();
    await shopping.rememberGeneratedFiles(); await shopping.readScenario();
    shopping.expectCoverageProblem('generated-tests-changed');
    await shopping.expectRememberedFilesUnchanged();
  });
  it('refuses a skipped generated scenario even when its expected steps remain', async () => {
    const shopping = await PythonAcceptance.create();
    shopping.aShopperCanAddAnAvailableBook('Dune', 1);
    await shopping.generateTests(); await shopping.skipGeneratedScenario();
    await shopping.rememberGeneratedFiles(); await shopping.readScenario();
    await shopping.expectScenarioProblemAt('dynamic-python-lookup', 'skip');
    await shopping.expectRememberedFilesUnchanged();
  });
});
