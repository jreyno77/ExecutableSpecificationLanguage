import { afterAll, beforeAll, it } from 'vitest';
import { InstalledPython } from '../../../dsl/project/python/python-installed-package.js';

beforeAll(() => InstalledPython.prepare(), 240_000);
afterAll(() => InstalledPython.finish(), 30_000);

it('runs the packed Python command against a real Dune basket and detects two copies instead of one', async () => {
  const consumer = await InstalledPython.installPackedProduct();
  await consumer.initialize(); consumer.expectStatus('initialized');
  await consumer.install(); consumer.expectStatus('installed');
  await consumer.source(`examples {
    setup bookIsAvailable(title: Text) returns Nothing
    setup startWithEmptyBasket() returns Nothing
    action addBook(title: Text) returns Nothing
    observation bookQuantity(title: Text) returns Number
    check expectBookQuantity(title: Text, expected: Number) {
      let actual = bookQuantity(title)
      assert actual == expected
    }
    scenario "a shopper can add an available book" {
      given bookIsAvailable("Dune")
      given startWithEmptyBasket()
      when addBook("Dune")
      then expectBookQuantity("Dune", 1)
    }
  }`);
  await consumer.build(); consumer.expectStatus('built'); consumer.rememberGeneratedCode();
  await consumer.implementBasket(1); await consumer.test();
  consumer.expectScenarioPassed('a shopper can add an available book'); consumer.expectGeneratedCodeUnchanged();
  await consumer.implementBasket(2); await consumer.test();
  consumer.expectWrongQuantity(1, 2); consumer.expectGeneratedCodeUnchanged(); consumer.expectInstalledProductOnly();
}, 1_200_000);
