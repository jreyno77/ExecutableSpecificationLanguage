import { it } from 'vitest';
import { KotlinAcceptance } from '../../../dsl/project/kotlin/kotlin-acceptance.js';

it('deletes only the generated example group and retains implemented support', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity() returns Number\nexample "one copy": quantity() => 1 }');
  await project.buildAcceptance();
  await project.implementDriver('package store.tests.driver\nopen class ShoppingDriver { open fun quantity(): Double = 1.0 }');
  const driver = 'src/test/kotlin/store/tests/driver/ShoppingDriver.kt', dsl = 'src/test/kotlin/store/tests/dsl/Shopping.kt';
  await project.rememberFile(driver); await project.rememberFile(dsl);
  await project.deleteGroup(); project.expectDeletionApplied();
  project.expectNoGeneratedStep('class ShoppingAcceptance');
  await project.expectFileUnchanged(driver); await project.expectFileUnchanged(dsl);
  await project.readOperation('quantity'); project.expectReadContains('open fun quantity(): Double = 1.0');
  await project.readGroup(); project.expectReadProblem('native-definition-unavailable');
  await project.deleteGroup(); project.expectDeletionUnchanged();
}, 240_000);

it('deletes one generated example while retaining its sibling and actual driver', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1\nexample "two Dune": quantity("Dune") => 2 }');
  await project.buildAcceptance();
  await project.implementDriver('package store.tests.driver\nopen class ShoppingDriver { open fun quantity(title: String): Double = 2.0 }');
  const driver = 'src/test/kotlin/store/tests/driver/ShoppingDriver.kt';
  await project.rememberFile(driver);
  await project.deleteExample('one Dune'); project.expectDeletionApplied();
  await project.expectFileUnchanged(driver);
  project.expectVisibleSteps(['fun twoDune()']); project.expectNoGeneratedStep('fun oneDune()');
  await project.runTests(); project.expectTests(1, 0);
  await project.deleteExample('one Dune'); project.expectDeletionUnchanged();
}, 240_000);

it('refuses to delete a generated example whose assertion was edited', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity() returns Number\nexample "one copy": quantity() => 1 }');
  await project.buildAcceptance();
  const test = 'src/test/kotlin/store/tests/acceptance/ShoppingAcceptance.kt';
  await project.replaceNativeText(test, '1.0', '2.0'); await project.rememberFile(test);
  await project.deleteExample('one copy'); project.expectDeletionRefused('output-conflict');
  await project.expectFileUnchanged(test);
}, 180_000);

it('refuses to delete a generated example required by an actual handwritten caller', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity() returns Number\nexample "one copy": quantity() => 1 }');
  await project.buildAcceptance();
  const caller = 'src/test/kotlin/store/Caller.kt', test = 'src/test/kotlin/store/tests/acceptance/ShoppingAcceptance.kt';
  await project.nativeFile(caller, 'package store\nfun runExample() { store.tests.acceptance.ShoppingAcceptance().oneCopy() }\n');
  await project.rememberFile(caller); await project.rememberFile(test);
  await project.deleteExample('one copy'); project.expectDeletionRefused('output-conflict');
  await project.expectFileUnchanged(caller); await project.expectFileUnchanged(test);
}, 180_000);
