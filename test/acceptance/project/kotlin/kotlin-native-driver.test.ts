import { it } from 'vitest';
import { KotlinAcceptance } from '../../../dsl/project/kotlin/kotlin-acceptance.js';

it('delegates an explicitly mapped operation and preserves the handwritten native driver', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  const native = 'src/test/kotlin/store/native/NativeBasket.kt';
  await project.nativeFile(native, 'package store.native\nclass NativeBasket { fun copies(title: String): Double = if (title == "Dune") 1.0 else 0.0 }');
  project.selectDriver(native, 'NativeBasket');
  project.mapOperation('quantity', native, 'NativeBasket', 'copies', ['kotlin.String']);
  await project.rememberFile(native);
  await project.buildAcceptance();
  project.expectNoObligation('implementation-required');
  await project.expectFileUnchanged(native);
  await project.runTests(); project.expectTests(1, 0);
  await project.nativeFile(native, 'package store.native\nclass NativeBasket { fun copies(title: String): Double = 2.0 }');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('expected: <1.0> but was: <2.0>');
}, 180_000);

it('refuses an explicitly mapped but incompatible native signature', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  const native = 'src/test/kotlin/store/native/NativeBasket.kt';
  await project.nativeFile(native, 'package store.native\nclass NativeBasket { fun copies(count: Double): Double = count }');
  project.selectDriver(native, 'NativeBasket');
  project.mapOperation('quantity', native, 'NativeBasket', 'copies', ['kotlin.Double']);
  await project.rememberFile(native);
  await project.expectAcceptanceRefused('native-signature-conflict');
  await project.expectFileUnchanged(native);
}, 180_000);

it('puts missing operations only in the generated adapter', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { action addBook(title: Text)\nobservation quantity(title: Text) returns Number\nscenario "one Dune" { when addBook("Dune")\nthen quantity("Dune") == 1 } }');
  const native = 'src/test/kotlin/store/native/NativeBasket.kt';
  await project.nativeFile(native, 'package store.native\nclass NativeBasket { private val books = mutableListOf<String>()\nfun add(title: String) { books.add(title) } }');
  project.selectDriver(native, 'NativeBasket');
  project.mapOperation('addBook', native, 'NativeBasket', 'add', ['kotlin.String']);
  await project.rememberFile(native);
  await project.buildAcceptance();
  project.expectObligation('implementation-required');
  await project.expectFileUnchanged(native);
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('Not implemented: quantity');
}, 180_000);

it('lets a native fixture supply a driver constructor dependency', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  const native = 'src/test/kotlin/store/native/NativeBasket.kt';
  await project.nativeFile(native, 'package store.native\nclass NativeBasket(private val copies: Double) { fun quantity(title: String): Double = copies }');
  project.selectDriver(native, 'NativeBasket');
  project.mapOperation('quantity', native, 'NativeBasket', 'quantity', ['kotlin.String']);
  const fixture = 'src/test/kotlin/store/tests/dsl/SuppliedShopping.kt';
  await project.nativeFile(fixture, 'package store.tests.dsl\nopen class SuppliedShopping { protected val shopping = Shopping(store.tests.driver.ShoppingDriver(store.native.NativeBasket(1.0))) }');
  project.selectFixture(fixture, 'SuppliedShopping');
  await project.buildAcceptance();
  await project.runTests(); project.expectTests(1, 0);
}, 180_000);

it('does not invent arguments for a selected native driver constructor', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  const native = 'src/test/kotlin/store/native/NativeBasket.kt';
  await project.nativeFile(native, 'package store.native\nclass NativeBasket(private val copies: Double) { fun quantity(title: String): Double = copies }');
  project.selectDriver(native, 'NativeBasket');
  project.mapOperation('quantity', native, 'NativeBasket', 'quantity', ['kotlin.String']);
  await project.expectAcceptanceRefused('invalid-native-driver');
}, 180_000);

it('uses the explicitly mapped inherited native operation', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  const native = 'src/test/kotlin/store/native/NativeBasket.kt';
  await project.nativeFile(native, 'package store.native\nopen class Catalog { fun copies(title: String): Double = if (title == "Dune") 1.0 else 0.0 }\nclass NativeBasket : Catalog()');
  project.selectDriver(native, 'NativeBasket');
  project.mapOperation('quantity', native, 'Catalog', 'copies', ['kotlin.String']);
  await project.rememberFile(native);
  await project.buildAcceptance();
  project.expectNoObligation('implementation-required');
  await project.expectFileUnchanged(native);
  await project.runTests(); project.expectTests(1, 0);
  await project.readOperation('quantity');
  project.expectReadContains('class Catalog');
}, 180_000);

it('refuses a mapping to a different native receiver with the same method signature', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  const native = 'src/test/kotlin/store/native/NativeBasket.kt';
  await project.nativeFile(native, 'package store.native\nclass NativeBasket { fun copies(title: String): Double = 2.0 }\nclass OtherBasket { fun copies(title: String): Double = 1.0 }');
  project.selectDriver(native, 'NativeBasket');
  project.mapOperation('quantity', native, 'OtherBasket', 'copies', ['kotlin.String']);
  await project.expectAcceptanceRefused('native-signature-conflict');
}, 180_000);
