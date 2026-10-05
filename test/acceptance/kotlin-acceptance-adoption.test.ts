import { it } from 'vitest';
import { KotlinAcceptance } from '../dsl/kotlin-acceptance.js';

it('honors explicit adoption while keeping the actual selected driver handwritten', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  const native = 'src/test/kotlin/store/native/NativeBasket.kt';
  await project.nativeFile(native, 'package store.native\nclass NativeBasket { fun copies(title: String): Double = if (title == "Dune") 1.0 else 0.0 }');
  project.selectDriver(native, 'NativeBasket');
  project.mapOperation('quantity', native, 'NativeBasket', 'copies', ['kotlin.String']);
  project.allowDriverAdoption();
  await project.rememberFile(native);
  await project.buildAcceptance();
  project.expectNoObligation('implementation-required');
  await project.expectFileUnchanged(native);
  await project.runTests(); project.expectTests(1, 0);
  await project.nativeFile(native, 'package store.native\nclass NativeBasket { fun copies(title: String): Double = 2.0 }');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('expected: <1.0> but was: <2.0>');
}, 180_000);

it('does not use adoption permission to ignore an incompatible native signature', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  const native = 'src/test/kotlin/store/native/NativeBasket.kt';
  await project.nativeFile(native, 'package store.native\nclass NativeBasket { fun copies(count: Double): Double = count }');
  project.selectDriver(native, 'NativeBasket');
  project.mapOperation('quantity', native, 'NativeBasket', 'copies', ['kotlin.Double']);
  project.allowDriverAdoption();
  await project.rememberFile(native);
  await project.expectCreateRefused('native-signature-conflict');
  await project.expectFileUnchanged(native);
}, 180_000);

it('keeps missing adopted operations visible in the generated delegate', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { action addBook(title: Text) returns Nothing\nobservation quantity(title: Text) returns Number\nscenario "one Dune" { when addBook("Dune")\nthen quantity("Dune") == 1 } }');
  const native = 'src/test/kotlin/store/native/NativeBasket.kt';
  await project.nativeFile(native, 'package store.native\nclass NativeBasket { private val books = mutableListOf<String>()\nfun add(title: String) { books.add(title) } }');
  project.selectDriver(native, 'NativeBasket');
  project.mapOperation('addBook', native, 'NativeBasket', 'add', ['kotlin.String']);
  project.allowDriverAdoption();
  await project.rememberFile(native);
  await project.buildAcceptance();
  project.expectObligation('implementation-required');
  await project.expectFileUnchanged(native);
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('Not implemented: quantity');
}, 180_000);

it('does not adopt an unowned handwritten test through driver permission', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  const native = 'src/test/kotlin/store/native/NativeBasket.kt';
  await project.nativeFile(native, 'package store.native\nclass NativeBasket { fun copies(title: String): Double = 1.0 }');
  project.selectDriver(native, 'NativeBasket');
  project.mapOperation('quantity', native, 'NativeBasket', 'copies', ['kotlin.String']);
  project.allowDriverAdoption();
  const test = 'src/test/kotlin/store/tests/acceptance/ShoppingAcceptance.kt';
  await project.nativeFile(test, 'package store.tests.acceptance\nclass ShoppingAcceptance { @org.junit.jupiter.api.Test fun existing() { org.junit.jupiter.api.Assertions.assertTrue(true) } }');
  await project.rememberFile(test); await project.rememberFile(native);
  await project.expectCreateRefused('output-conflict');
  await project.expectFileUnchanged(test); await project.expectFileUnchanged(native);
}, 180_000);

it('requires an explicit selected driver rather than adopting a matching class name', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  const native = 'src/test/kotlin/store/native/ShoppingDriver.kt';
  await project.nativeFile(native, 'package store.native\nclass ShoppingDriver { fun quantity(title: String): Double = 1.0 }');
  project.allowDriverAdoption();
  await project.rememberFile(native);
  await project.expectCreateRefused('invalid-native-driver');
  await project.expectFileUnchanged(native);
}, 180_000);
