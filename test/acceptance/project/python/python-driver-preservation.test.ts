import { afterEach, describe, it } from 'vitest';
import { PythonAcceptance } from '../../../dsl/project/python/python-acceptance.js';

afterEach(() => PythonAcceptance.dispose());

describe('handwritten Python drivers stay separate from generated expectations', { timeout: 240_000 }, () => {
  it('updates a quantity while retaining the explicitly selected driver', async () => {
    const p = await PythonAcceptance.create(); p.aShopperCanAddAnAvailableBook('Dune', 1);
    await p.useExistingBasketDriver({ copies: 1 }); await p.generateTests();
    await p.addReadableNativeEdits(); await p.rememberGeneratedFiles();
    p.reviseExpectedQuantity('Dune', 2); await p.updateTests();
    await p.expectSelectedDriverUnchanged(); await p.expectRememberedImplementationUnchanged();
    await p.runTests(); p.expectWrongQuantity(1, 2);
  });
  it('keeps an unrelated local named like the generated driver import', async () => {
    const p = await PythonAcceptance.create(); p.aShopperCanAddAnAvailableBook('Dune', 1);
    await p.useExistingBasketDriver({ copies: 1 }); await p.generateTests();
    await p.addDriverNamedNeighbor(); await p.rememberGeneratedFiles();
    await p.generateTests(); p.expectNoEdits(); await p.expectRememberedFilesUnchanged();
    await p.runTests(); p.expectPassed(1);
  });
});
