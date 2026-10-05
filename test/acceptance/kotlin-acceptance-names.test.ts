import { it } from 'vitest';
import { KotlinAcceptance } from '../dsl/kotlin-acceptance.js';

it('uses explicit native names while keeping the authored example title', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  project.nameOperation('quantity', 'copies');
  project.nameExample('one Dune', 'duneHasOneCopy');
  await project.buildAcceptance();
  await project.implementDriver('package store.tests.driver\nopen class ShoppingDriver { open fun copies(title: String): Double = 1.0 }');
  project.expectVisibleSteps(['fun duneHasOneCopy()', '@org.junit.jupiter.api.DisplayName("one Dune")', 'shopping.copies("Dune")']);
  await project.readOperation('quantity'); project.expectReadContains('fun copies(title: String): Double');
  await project.runTests(); project.expectTests(1, 0);
}, 240_000);

it('adds a name mapping for a new operation without rebinding the existing one', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity() returns Number\nexample "one copy": quantity() => 1 }');
  await project.buildAcceptance();
  await project.implementDriver('package store.tests.driver\nopen class ShoppingDriver { open fun quantity(): Double = 1.0 }');
  project.source('examples { observation quantity() returns Number\nobservation price() returns Number\nexample "one copy": quantity() => 1\nexample "price": price() => 20 }');
  project.nameOperation('price', 'bookPrice');
  await project.updateAcceptance();
  await project.readOperation('quantity'); project.expectReadContains('open fun quantity(): Double = 1.0');
  project.expectVisibleSteps(['shopping.bookPrice()']);
  await project.runTests(); project.expectTests(1, 1); project.expectFailure('Not implemented: bookPrice');
}, 240_000);

it('refuses changing a retained native name without its actual identity transition', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity() returns Number\nexample "one copy": quantity() => 1 }');
  project.nameOperation('quantity', 'copies');
  await project.buildAcceptance();
  const driver = 'src/test/kotlin/store/tests/driver/ShoppingDriver.kt'; await project.rememberFile(driver);
  project.nameOperation('quantity', 'amount');
  await project.expectAcceptanceRefused('output-options-changed');
  await project.expectFileUnchanged(driver);
}, 240_000);

it('preserves the real method through a corresponding source and native rename', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity() returns Number\nexample "one copy": quantity() => 1 }');
  project.nameOperation('quantity', 'copies');
  await project.buildAcceptance();
  await project.implementDriver('package store.tests.driver\nopen class ShoppingDriver { open fun copies(): Double = 1.0 }');
  project.source('examples { observation count() returns Number\nexample "one copy": count() => 1 }', { 'examples.quantity': 'examples.count' });
  project.nameOperation('count', 'bookCount');
  await project.updateAcceptance();
  await project.readOperation('count'); project.expectReadContains('open fun bookCount(): Double = 1.0');
  await project.runTests(); project.expectTests(1, 0);
}, 240_000);
