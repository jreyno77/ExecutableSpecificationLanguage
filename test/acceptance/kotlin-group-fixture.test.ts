import { it } from 'vitest';
import { KotlinAcceptance } from '../dsl/kotlin-acceptance.js';

it('reads each group with its explicitly selected fixture without making the fixture a group definition', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { example "one": 1 => 1 }\nexamples { example "two": 2 => 2 }');
  project.nameGroupFor('one', 'FirstBasketAcceptance');
  project.nameGroupFor('two', 'SecondBasketAcceptance');
  const fixture = 'src/test/kotlin/store/tests/dsl/ConnectedShopping.kt';
  await project.nativeFile(fixture, 'package store.tests.dsl\n// Keep this explicit native fixture.\nopen class ConnectedShopping { protected val shopping = Shopping(store.tests.driver.ShoppingDriver()) }');
  project.selectFixture(fixture, 'ConnectedShopping');
  await project.buildAcceptance();
  await project.rememberFile(fixture);
  await project.readGroupFor('one'); project.expectReadFiles(['FirstBasketAcceptance.kt', 'ConnectedShopping.kt', 'ExpecChecks.kt', 'Shopping.kt', 'ShoppingDriver.kt', 'ShoppingFixture.kt']);
  await project.readGroupFor('two'); project.expectReadFiles(['SecondBasketAcceptance.kt', 'ConnectedShopping.kt', 'ExpecChecks.kt', 'Shopping.kt', 'ShoppingDriver.kt', 'ShoppingFixture.kt']);
  await project.expectGroupDefinedIn('two', 'SecondBasketAcceptance.kt');
  await project.deleteGroupFor('one'); project.expectDeletionApplied();
  await project.expectNoNativeGroup('one');
  await project.expectFileUnchanged(fixture);
  await project.readGroupFor('two'); project.expectReadFiles(['SecondBasketAcceptance.kt', 'ConnectedShopping.kt', 'ExpecChecks.kt', 'Shopping.kt', 'ShoppingDriver.kt', 'ShoppingFixture.kt']);
  await project.runTestClasses(['store.tests.acceptance.SecondBasketAcceptance']); project.expectTests(1, 0);
}, 300_000);
