import { afterEach, describe, it } from 'vitest';
import { PythonAcceptance } from '../dsl/python-acceptance.js';

afterEach(() => PythonAcceptance.dispose());

describe('a driver uses only its captured native typing environment', { timeout: 240_000 }, () => {
  it('uses a captured typed dependency without running its site startup file', async () => {
    const p = await PythonAcceptance.create(); p.aShopperCanAddAnAvailableBook('Dune', 1);
    await p.useExistingBasketDriver({ copies: 1 }); await p.supplyDriverNumberType({ typed: true, startupCanary: true });
    await p.generateTests(); await p.expectStartupNotRun();
    await p.runTests(); p.expectPassed(1); await p.expectStartupNotRun();
  });
  it('does not turn an untyped installed dependency into a known operation type', async () => {
    const p = await PythonAcceptance.create(); p.aShopperCanAddAnAvailableBook('Dune', 1);
    await p.useExistingBasketDriver({ copies: 1 }); await p.supplyDriverNumberType({ typed: false });
    await p.tryGenerateTests(); p.expectGenerationProblem('incompatible-native-operation'); await p.expectNoAcceptanceWrites();
  });
});
