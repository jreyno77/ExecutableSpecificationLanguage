import { it } from 'vitest';
import { KotlinAcceptance } from '../dsl/kotlin-acceptance.js';

it('requires update before changing an existing generated expectation', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity() returns Number\nexample "one copy": quantity() => 1 }');
  await project.buildAcceptance();
  const test = 'src/test/kotlin/store/tests/acceptance/ShoppingAcceptance.kt';
  await project.rememberFile(test);
  project.source('examples { observation quantity() returns Number\nexample "one copy": quantity() => 2 }');
  await project.expectCreateRefused('use-update');
  await project.expectFileUnchanged(test);
}, 180_000);

it('requires update when a new example changes an existing group', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity() returns Number\nexample "one copy": quantity() => 1 }');
  await project.buildAcceptance();
  const test = 'src/test/kotlin/store/tests/acceptance/ShoppingAcceptance.kt';
  await project.rememberFile(test);
  project.source('examples { observation quantity() returns Number\nexample "one copy": quantity() => 1\nexample "two copies": quantity() => 2 }');
  await project.expectInsertRefused('not-addition-only');
  await project.expectFileUnchanged(test);
}, 180_000);

it('recreates a deliberately deleted example using its existing identity', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity() returns Number\nexample "one copy": quantity() => 1 }');
  await project.buildAcceptance();
  await project.implementDriver('package store.tests.driver\nopen class ShoppingDriver { open fun quantity(): Double = 1.0 }');
  const driver = 'src/test/kotlin/store/tests/driver/ShoppingDriver.kt';
  await project.rememberFile(driver);
  await project.deleteExample('one copy'); project.expectDeletionApplied();
  project.expectNoGeneratedStep('fun oneCopy()');
  await project.buildAcceptance();
  await project.expectFileUnchanged(driver);
  await project.readExample('one copy'); project.expectReadContains('fun oneCopy()');
  await project.runTests(); project.expectTests(1, 0);
}, 240_000);

it('recreates a deliberately deleted group without replacing its implemented driver', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity() returns Number\nexample "one copy": quantity() => 1 }');
  await project.buildAcceptance();
  await project.implementDriver('package store.tests.driver\nopen class ShoppingDriver { open fun quantity(): Double = 1.0 }');
  const driver = 'src/test/kotlin/store/tests/driver/ShoppingDriver.kt';
  await project.rememberFile(driver);
  await project.deleteGroup(); project.expectDeletionApplied();
  await project.buildAcceptance();
  await project.expectFileUnchanged(driver);
  await project.readExample('one copy'); project.expectReadContains('fun oneCopy()');
  await project.runTests(); project.expectTests(1, 0);
}, 240_000);

it('does not repair a manually removed generated test file as deliberate deletion', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity() returns Number\nexample "one copy": quantity() => 1 }');
  await project.buildAcceptance();
  const test = 'src/test/kotlin/store/tests/acceptance/ShoppingAcceptance.kt', driver = 'src/test/kotlin/store/tests/driver/ShoppingDriver.kt';
  await project.rememberFile(driver);
  await project.removeNativeFile(test);
  await project.expectCreateRefused('output-conflict');
  await project.expectFileUnchanged(driver);
  project.expectNoGeneratedStep('fun oneCopy()');
}, 180_000);

it('does not change a retained expectation while recreating a different example', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity() returns Number\nexample "one copy": quantity() => 1\nexample "two copies": quantity() => 2 }');
  await project.buildAcceptance();
  await project.deleteExample('one copy'); project.expectDeletionApplied();
  const test = 'src/test/kotlin/store/tests/acceptance/ShoppingAcceptance.kt';
  await project.rememberFile(test);
  project.source('examples { observation quantity() returns Number\nexample "one copy": quantity() => 1\nexample "two copies": quantity() => 3 }');
  await project.expectCreateRefused('use-update');
  await project.expectFileUnchanged(test);
}, 240_000);
