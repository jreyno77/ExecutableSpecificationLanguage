import { it } from 'vitest';
import { KotlinAcceptance } from '../dsl/kotlin-acceptance.js';

it('updates an authored expected result while preserving the real driver and neighboring method', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  await project.buildAcceptance();
  await project.implementDriver('package store.tests.driver\nopen class ShoppingDriver {\n  // Actual application observation stays handwritten.\n  open fun quantity(title: String): Double = if (title == "Dune") 1.0 else 0.0\n}\n');
  const driver = 'src/test/kotlin/store/tests/driver/ShoppingDriver.kt';
  await project.rememberFile(driver);
  await project.addTestMember('  // Keep this unrelated neighbor.\n  fun authorNote(): String = "Dune is a novel"');
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 2 }');
  await project.updateAcceptance();
  await project.expectFileUnchanged(driver);
  await project.readGroup(); project.expectReadContains('fun authorNote(): String = "Dune is a novel"');
  project.expectVisibleSteps(['shopping.quantity("Dune")', '2.0']);
  await project.runTests(); project.expectTests(0, 1); project.expectFailure('expected: <2.0> but was: <1.0>');
}, 240_000);

it('adds only a missing driver operation while keeping an implemented operation intact', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  await project.buildAcceptance();
  await project.implementDriver('package store.tests.driver\nopen class ShoppingDriver {\n  // Keep actual quantity.\n  open fun quantity(title: String): Double = 1.0\n}\n');
  project.source('examples { observation quantity(title: Text) returns Number\nobservation price(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1\nexample "Dune price": price("Dune") => 20 }');
  await project.updateAcceptance();
  await project.readOperation('quantity'); project.expectReadContains('// Keep actual quantity.');
  project.expectReadContains('open fun quantity(title: String): Double = 1.0');
  await project.runTests(); project.expectTests(1, 1); project.expectFailure('Not implemented: price');
}, 240_000);

it('renames a driver operation using its actual identity while preserving handwritten callers', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  await project.buildAcceptance();
  await project.implementDriver('package store.tests.driver\nopen class ShoppingDriver {\n  // Keep actual Dune data.\n  open fun quantity(title: String): Double = if (title == "Dune") 1.0 else 0.0\n}\n');
  const caller = 'src/test/kotlin/store/Caller.kt';
  await project.nativeFile(caller, 'package store\n// A handwritten caller.\nfun copies(): Double = store.tests.driver.ShoppingDriver().quantity("Dune")\n');
  project.source('examples { observation copies(title: Text) returns Number\nexample "one Dune": copies("Dune") => 1 }', { 'examples.quantity': 'examples.copies' });
  await project.updateAcceptance();
  await project.readOperation('copies'); project.expectReadContains('// Keep actual Dune data.');
  project.expectReadContains('open fun copies(title: String): Double');
  await project.expectNativeFile(caller, 'package store\n// A handwritten caller.\nfun copies(): Double = store.tests.driver.ShoppingDriver().copies("Dune")\n');
  await project.runTests(); project.expectTests(1, 0);
}, 300_000);

it('retires an unchanged unused driver operation while retaining the implemented neighbor', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nobservation obsolete() returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  await project.buildAcceptance();
  await project.replaceNativeText('src/test/kotlin/store/tests/driver/ShoppingDriver.kt', 'throw NotImplementedError("Not implemented: quantity")', '1.0');
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }', {}, ['examples.obsolete']);
  await project.updateAcceptance();
  await project.readOperation('quantity'); project.expectReadContains('open fun quantity(title: String): Double = 1.0');
  project.expectReadExcludes('fun obsolete(');
  await project.runTests(); project.expectTests(1, 0);
}, 300_000);
