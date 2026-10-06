import { it } from 'vitest';
import { KotlinAcceptance } from '../../../dsl/project/kotlin/kotlin-acceptance.js';

it('runs readable Dune steps against real basket state and detects the wrong observed quantity', async () => {
  const project = await KotlinAcceptance.connect();
  project.source(`examples {
    setup bookIsAvailable(title: Text)
    setup startWithEmptyBasket()
    action addBook(title: Text)
    observation quantity(title: Text) returns Number
    check expectBookQuantity(title: Text, expected: Number) {
      let actual = quantity(title)
      assert actual == expected
    }
    scenario "a shopper can add an available book" {
      given bookIsAvailable("Dune")
      given startWithEmptyBasket()
      when addBook("Dune")
      then expectBookQuantity("Dune", 1)
    }
  }`);
  await project.buildAcceptance();
  project.expectVisibleSteps(['shopping.bookIsAvailable("Dune")', 'shopping.startWithEmptyBasket()', 'shopping.addBook("Dune")', 'shopping.expectBookQuantity("Dune", 1.0)']);
  await project.implementDriver(`package store.tests.driver
class ShoppingDriver {
  private val catalog = mutableSetOf<String>()
  private val basket = mutableMapOf<String, Double>()
  fun bookIsAvailable(title: String) { catalog.add(title) }
  fun startWithEmptyBasket() { basket.clear() }
  fun addBook(title: String) { check(title in catalog); basket[title] = (basket[title] ?: 0.0) + 1.0 }
  fun quantity(title: String): Double = basket[title] ?: 0.0
}`);
  await project.runTests(); project.expectTests(1, 0);
  await project.implementDriver(`package store.tests.driver
class ShoppingDriver {
  fun bookIsAvailable(title: String) {}
  fun startWithEmptyBasket() {}
  fun addBook(title: String) {}
  fun quantity(title: String): Double = 2.0
}`);
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('expected: <1.0> but was: <2.0>');
}, 180_000);
