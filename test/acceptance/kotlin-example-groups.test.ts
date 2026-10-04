import { it } from 'vitest';
import { KotlinAcceptance } from '../dsl/kotlin-acceptance.js';

it('runs explicitly named anonymous example groups through their shared domain', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation firstQuantity() returns Number\nexample "one Dune": firstQuantity() => 1 }\nexamples { observation secondQuantity() returns Number\nexample "two Dune": secondQuantity() => 2 }');
  project.nameGroupFor('one Dune', 'FirstBasketAcceptance');
  project.nameGroupFor('two Dune', 'SecondBasketAcceptance');
  await project.buildAcceptance();
  await project.implementDriver('package store.tests.driver\nopen class ShoppingDriver { open fun firstQuantity(): Double = 1.0; open fun secondQuantity(): Double = 2.0 }');
  await project.readExample('one Dune'); project.expectReadFiles(['FirstBasketAcceptance.kt']);
  await project.readExample('two Dune'); project.expectReadFiles(['SecondBasketAcceptance.kt']);
  await project.runTestClasses(['store.tests.acceptance.FirstBasketAcceptance', 'store.tests.acceptance.SecondBasketAcceptance']);
  project.expectTests(2, 0);
}, 240_000);

it('requires explicit distinct names when two groups share the default native name', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { example "one": 1 => 1 }\nexamples { example "two": 2 => 2 }');
  await project.expectAcceptanceRefused('native-name-conflict');
  project.expectNoGeneratedStep('@org.junit.jupiter.api.Test');
}, 240_000);

it('deletes only the selected group while the other remains executable', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation firstQuantity() returns Number\nexample "one Dune": firstQuantity() => 1 }\nexamples { observation secondQuantity() returns Number\nexample "two Dune": secondQuantity() => 2 }');
  project.nameGroupFor('one Dune', 'FirstBasketAcceptance');
  project.nameGroupFor('two Dune', 'SecondBasketAcceptance');
  await project.buildAcceptance();
  await project.implementDriver('package store.tests.driver\nopen class ShoppingDriver { open fun firstQuantity(): Double = 1.0; open fun secondQuantity(): Double = 2.0 }');
  await project.rememberFile('src/test/kotlin/store/tests/driver/ShoppingDriver.kt');
  await project.rememberFile('src/test/kotlin/store/tests/acceptance/SecondBasketAcceptance.kt');
  await project.rememberFile('src/test/kotlin/store/tests/dsl/Shopping.kt');
  await project.deleteGroupFor('one Dune'); project.expectDeletionApplied();
  await project.expectFileUnchanged('src/test/kotlin/store/tests/driver/ShoppingDriver.kt');
  await project.expectFileUnchanged('src/test/kotlin/store/tests/acceptance/SecondBasketAcceptance.kt');
  await project.expectFileUnchanged('src/test/kotlin/store/tests/dsl/Shopping.kt');
  await project.readExample('one Dune'); project.expectReadProblem('native-definition-unavailable');
  await project.readExample('two Dune'); project.expectReadContains('fun twoDune()');
  await project.runTestClasses(['store.tests.acceptance.SecondBasketAcceptance']);
  project.expectTests(1, 0);
  await project.deleteGroupFor('one Dune'); project.expectDeletionUnchanged();
}, 240_000);

it('reorders groups without changing shared implementation or native caller identity', async () => {
  const project = await KotlinAcceptance.connect();
  const first = 'examples { example "one": 1 => 1 }';
  const second = 'examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }';
  project.source(first + '\n' + second);
  project.nameGroupFor('one', 'FirstBasketAcceptance');
  project.nameGroupFor('one Dune', 'SecondBasketAcceptance');
  await project.buildAcceptance();
  await project.implementDriver('package store.tests.driver\nopen class ShoppingDriver { open fun quantity(title: String): Double = if (title == "Dune") 1.0 else 0.0 }');
  await project.rememberFile('src/test/kotlin/store/tests/driver/ShoppingDriver.kt');
  await project.rememberFile('src/test/kotlin/store/tests/dsl/Shopping.kt');
  project.changeGroups(second + '\n' + first, ['one', 'one Dune']);
  await project.updateAcceptance();
  await project.readExample('one'); project.expectReadFiles(['FirstBasketAcceptance.kt']);
  await project.readExample('one Dune'); project.expectReadFiles(['SecondBasketAcceptance.kt']);
  await project.expectFileUnchanged('src/test/kotlin/store/tests/driver/ShoppingDriver.kt');
  await project.expectFileUnchanged('src/test/kotlin/store/tests/dsl/Shopping.kt');
  await project.runTestClasses(['store.tests.acceptance.FirstBasketAcceptance', 'store.tests.acceptance.SecondBasketAcceptance']);
  project.expectTests(2, 0);
}, 240_000);

it('retires the first source group while retaining the other group and shared implementation', async () => {
  const project = await KotlinAcceptance.connect();
  const first = 'examples { example "one": 1 => 1 }';
  const second = 'examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }';
  project.source(first + '\n' + second);
  project.nameGroupFor('one', 'FirstBasketAcceptance');
  project.nameGroupFor('one Dune', 'SecondBasketAcceptance');
  await project.buildAcceptance();
  await project.implementDriver('package store.tests.driver\nopen class ShoppingDriver { open fun quantity(title: String): Double = if (title == "Dune") 1.0 else 0.0 }');
  await project.rememberFile('src/test/kotlin/store/tests/driver/ShoppingDriver.kt');
  await project.rememberFile('src/test/kotlin/store/tests/dsl/Shopping.kt');
  await project.rememberFile('src/test/kotlin/store/tests/acceptance/SecondBasketAcceptance.kt');
  project.changeGroups(second, ['one Dune'], ['one']);
  await project.updateAcceptance();
  await project.expectNoNativeGroup('one');
  await project.expectFileUnchanged('src/test/kotlin/store/tests/driver/ShoppingDriver.kt');
  await project.expectFileUnchanged('src/test/kotlin/store/tests/dsl/Shopping.kt');
  await project.expectFileUnchanged('src/test/kotlin/store/tests/acceptance/SecondBasketAcceptance.kt');
  await project.runTestClasses(['store.tests.acceptance.SecondBasketAcceptance']);
  project.expectTests(1, 0);
}, 240_000);
