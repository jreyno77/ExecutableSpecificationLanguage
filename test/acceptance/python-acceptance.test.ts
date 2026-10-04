import { afterEach, describe, it } from 'vitest';
import { PythonAcceptance } from '../dsl/python-acceptance.js';

afterEach(() => PythonAcceptance.dispose());
describe('readable Python acceptance tests that reach the application', { timeout: 240_000 }, () => {
  it('a shopper can add an available Dune through the generated DSL and real driver', async () => {
    const shopping = await PythonAcceptance.create();
    shopping.aShopperCanAddAnAvailableBook('Dune', 1);
    await shopping.generateTests();
    await shopping.implementBasket(1);
    await shopping.runTests();
    shopping.expectPassed(1);
    shopping.expectReadableSteps(['shopping.bookIsAvailable("Dune")', 'shopping.startWithEmptyBasket()', 'shopping.addBook("Dune")', 'shopping.expectBookQuantity("Dune", 1.0)']);
  });
  it('fails when the real basket adds two copies instead of the specified one', async () => {
    const shopping = await PythonAcceptance.create();
    shopping.aShopperCanAddAnAvailableBook('Dune', 1);
    await shopping.generateTests();
    await shopping.implementBasket(2);
    await shopping.runTests();
    shopping.expectWrongQuantity(2, 1);
  });
  it('fails visibly while the generated driver is still unimplemented', async () => {
    const shopping = await PythonAcceptance.create();
    shopping.aShopperCanAddAnAvailableBook('Dune', 1);
    await shopping.generateTests();
    await shopping.runTests();
    shopping.expectUnimplemented('bookIsAvailable');
  });
});
