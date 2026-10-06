import { afterEach, describe, it } from 'vitest';
import { PythonAcceptance } from '../../../dsl/project/python/python-acceptance.js';

afterEach(() => PythonAcceptance.dispose());

describe('readable Python tests can use an existing application driver', { timeout: 240_000 }, () => {
  it('uses an explicitly selected driver without generating a duplicate', async () => {
    const p = await PythonAcceptance.create(); p.aShopperCanAddAnAvailableBook('Dune', 1);
    await p.useExistingBasketDriver({ copies: 1, parameter: 'book' });
    await p.keepExistingCatalogDsl('Dune');
    await p.generateTests(); await p.expectSelectedDriverUnchanged(); await p.expectCatalogDslUnchanged();
    await p.rememberGeneratedFiles(); await p.generateTests();
    p.expectNoEdits(); await p.expectRememberedFilesUnchanged(); await p.expectSelectedDriverUnchanged(); await p.expectCatalogDslUnchanged();
    await p.runTests(); p.expectPassed(1);
  });
  it('observes wrong behavior from the same selected driver', async () => {
    const p = await PythonAcceptance.create(); p.aShopperCanAddAnAvailableBook('Dune', 1);
    await p.useExistingBasketDriver({ copies: 2 });
    await p.generateTests(); await p.runTests(); p.expectWrongQuantity(2, 1);
  });
  it('rejects an incompatible selected observation before writing tests', async () => {
    const p = await PythonAcceptance.create(); p.aShopperCanAddAnAvailableBook('Dune', 1);
    await p.useExistingBasketDriver({ returns: 'str' });
    await p.tryGenerateTests(); p.expectGenerationProblem('incompatible-native-operation');
    await p.expectNoAcceptanceWrites(); await p.expectSelectedDriverUnchanged();
  });
  it('does not certify an unknown selected result type', async () => {
    const p = await PythonAcceptance.create(); p.aShopperCanAddAnAvailableBook('Dune', 1);
    await p.useExistingBasketDriver({ returns: 'Any' });
    await p.tryGenerateTests(); p.expectGenerationProblem('incompatible-native-operation'); await p.expectNoAcceptanceWrites();
  });
  it('requires a supplied fixture when the selected driver needs construction inputs', async () => {
    const p = await PythonAcceptance.create(); p.aShopperCanAddAnAvailableBook('Dune', 1);
    await p.useExistingBasketDriver({ requiredConstructorArgument: true });
    await p.tryGenerateTests(); p.expectGenerationProblem('incompatible-native-operation'); await p.expectNoAcceptanceWrites();
  });
  it('rejects Boolean returned through a natively compatible Number operation', async () => {
    const p = await PythonAcceptance.create(); p.aShopperCanAddAnAvailableBook('Dune', 1);
    await p.useExistingBasketDriver({ returns: 'bool' });
    await p.generateTests(); await p.runTests(); p.expectInvalidNumber();
  });
});
