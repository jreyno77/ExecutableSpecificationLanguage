import { it } from 'vitest';
import { NativeWalkthrough } from '../dsl/native-walkthrough.js';

it('follows the shipped Kotlin Dune example through an actual basket failure and repair', async () => {
  const author = await NativeWalkthrough.installed('kotlin');
  await author.expectNoDevelopmentCheckout();
  await author.copyShippedShoppingSpecification();
  await author.initializeDocumentedKotlinProject();
  await author.appendDocumentedAcceptanceOutput();
  await author.installCheckAndBuild();
  await author.expectReadableSteps(['bookIsAvailable("Dune")', 'startWithEmptyBasket()', 'addBook("Dune")', 'expectBookQuantity("Dune", 1.0)']);
  await author.implementDocumentedBasket();
  await author.test(); author.expectPassed('a shopper can add an available book');
  await author.rememberGeneratedTests();
  await author.removeActualBasketIncrement();
  await author.test(); author.expectQuantityFailure('a shopper can add an available book', 1, 0);
  await author.expectGeneratedTestsUnchanged();
  await author.restoreDocumentedBasket();
  await author.test(); author.expectPassed('a shopper can add an available book');
  await author.expectGeneratedTestsUnchanged();
}, 900_000);
