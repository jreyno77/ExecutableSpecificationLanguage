import { afterEach, describe, it } from 'vitest';
import { PythonAcceptance } from '../../../dsl/project/python/python-acceptance.js';

afterEach(() => PythonAcceptance.dispose());

describe('a selected Python driver fulfills its actual contract', { timeout: 240_000 }, () => {
  it('does not reject unrelated Any helpers on an otherwise known driver', async () => {
    const p = await PythonAcceptance.create(); p.aBookRetainsItsDeclaredData();
    await p.generateBookContract(); await p.useExistingBookDriver({ copiesType: 'float', unrelatedAnyHelper: true });
    await p.generateTests(); await p.runTests(); p.expectPassed(1);
  });
  it('rejects unknown data nested inside a selected observation', async () => {
    const p = await PythonAcceptance.create(); p.aBookRetainsItsDeclaredData();
    await p.generateBookContract(); await p.useExistingBookDriver({ copiesType: 'Any' });
    await p.tryGenerateTests(); p.expectGenerationProblem('incompatible-native-operation'); await p.expectNoAcceptanceWrites();
  });
  it('does not substitute a same-named driver from another source root', async () => {
    const p = await PythonAcceptance.create(); p.aShopperCanAddAnAvailableBook('Dune', 1);
    await p.useExistingBasketDriver({ copies: 1 }); await p.shadowSelectedDriver();
    await p.tryGenerateTests(); p.expectGenerationProblem('invalid-native-driver');
    await p.expectNoAcceptanceWrites(); await p.expectSelectedDriverUnchanged();
  });
  it('keeps an authored parameter named driver usable', async () => {
    const p = await PythonAcceptance.create();
    p.source('examples { observation bookQuantity(driver: Text) returns Number\nexample "empty basket": bookQuantity("Dune") => 0 }');
    await p.useExistingBasketDriver({ parameter: 'driver' });
    await p.generateTests(); await p.runTests(); p.expectPassed(1);
  });
});
