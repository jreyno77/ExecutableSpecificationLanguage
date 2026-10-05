import { afterEach, describe, it } from 'vitest';
import { PythonAcceptance } from '../dsl/python-acceptance.js';

afterEach(() => PythonAcceptance.dispose());

describe('a Python driver uses its actual method definitions', { timeout: 240_000 }, () => {
  it('reads the actual inherited driver method without inventing a declaration', async () => {
    const p = await PythonAcceptance.create(); p.aShopperCanAddAnAvailableBook('Dune', 1);
    await p.useInheritedBasketDriver(); await p.generateTests();
    await p.readOperation('bookQuantity'); p.expectOperationFiles(['test/dsl/shopping.py', 'test/driver/base.py']);
    await p.runTests(); p.expectPassed(1);
  });
});
