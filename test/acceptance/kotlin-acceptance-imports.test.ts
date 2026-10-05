import { describe, it } from 'vitest';
import { KotlinAcceptance } from '../dsl/kotlin-acceptance.js';

describe('native Kotlin provider data in examples', { timeout: 240_000 }, () => {
it('compares a mapped external record and preserves the native class', async () => {
  const p = await KotlinAcceptance.connect();
  p.external('catalog', 'type Book { title: Text }');
  p.source('use Book from "catalog"\nexamples { observation book() returns Book\nexample "Dune title": book() => { title: "Dune" } }');
  await p.nativeFile('src/main/kotlin/catalog/Book.kt', 'package catalog\ndata class Book(val title: String)');
  p.importType({ declaration: ['Book'], module: 'catalog' }, 'catalog.Book', 'CatalogBook');
  await p.rememberFile('src/main/kotlin/catalog/Book.kt'); await p.buildAcceptance();
  await p.readOperation('book'); p.expectReadContains('import catalog.Book as CatalogBook');
  p.expectReadContains('fun book(): CatalogBook');
  await p.implementDriver('package store.tests.driver\nopen class ShoppingDriver { open fun book(): catalog.Book = catalog.Book("Dune") }');
  await p.runTests(); p.expectTests(1, 0);
  await p.implementDriver('package store.tests.driver\nopen class ShoppingDriver { open fun book(): catalog.Book = catalog.Book("Other") }');
  await p.runTests(); p.expectTests(0, 1); p.expectFailure('value.title ==> expected: <Dune> but was: <Other>');
  await p.expectFileUnchanged('src/main/kotlin/catalog/Book.kt');
});
it('checks a mapped generic record through its declared instantiated field', async () => {
  const p = await KotlinAcceptance.connect();
  p.external('catalog', 'type Box<T> { value: T }');
  p.source('use Box from "catalog"\nexamples { observation box() returns Box<Number>\nexample "one copy": box() => { value: 1 } }');
  await p.nativeFile('src/main/kotlin/catalog/Box.kt', 'package catalog\ndata class Box<T>(val value: T)');
  p.importType({ declaration: ['Box'], module: 'catalog' }, 'catalog.Box');
  await p.buildAcceptance();
  await p.implementDriver('package store.tests.driver\nopen class ShoppingDriver { open fun box(): catalog.Box<Double> = catalog.Box(1.0) }');
  await p.runTests(); p.expectTests(1, 0);
  await p.implementDriver('package store.tests.driver\nopen class ShoppingDriver { @Suppress("UNCHECKED_CAST") open fun box(): catalog.Box<Double> = catalog.Box("many") as catalog.Box<Double> }');
  await p.runTests(); p.expectTests(0, 1); p.expectFailure('value.value: expected Double data');
});
it('refuses a wrong nullable native field even when the expected data omits it', async () => {
  const p = await KotlinAcceptance.connect();
  p.external('catalog', 'type Book { title: Text? }');
  p.source('use Book from "catalog"\nexamples { observation book() returns Book\nexample "no title": book() => {} }');
  await p.nativeFile('src/main/kotlin/catalog/Book.kt', 'package catalog\ndata class Book(val title: Double? = null)');
  p.importType({ declaration: ['Book'], module: 'catalog' }, 'catalog.Book');
  await p.expectAcceptanceRefused('native-signature-conflict');
  p.expectNoGeneratedStep('fun noTitle()');
});
it('does not invoke a mapped record initializer to construct the expected value', async () => {
  const p = await KotlinAcceptance.connect();
  p.external('catalog', 'type Book { title: Text }');
  p.source('use Book from "catalog"\nexamples { observation book() returns Book\nexample "Dune title": book() => { title: "Dune" } }');
  await p.nativeFile('src/main/kotlin/catalog/Book.kt', 'package catalog\ndata class Book(var title: String) { init { title = "Other"; println("APPLICATION_INITIALIZER") } }');
  p.importType({ declaration: ['Book'], module: 'catalog' }, 'catalog.Book');
  await p.expectAcceptanceRefused('unsupported-fixture-data');
  p.expectNoGeneratedStep('fun duneTitle()');
});
it('does not read a mapped computed property as declared stored data', async () => {
  const p = await KotlinAcceptance.connect();
  p.external('catalog', 'type Book { title: Text }');
  p.source('use Book from "catalog"\nexamples { observation book() returns Book\nexample "Dune title": book().title => "Dune" }');
  await p.nativeFile('src/main/kotlin/catalog/Book.kt', 'package catalog\nclass Book { val title get() = "Dune" }');
  p.importType({ declaration: ['Book'], module: 'catalog' }, 'catalog.Book');
  await p.expectAcceptanceRefused('unsupported-comparison-data');
  p.expectNoGeneratedStep('fun duneTitle()');
});
it('does not silently rebind a retained imported record to another native class', async () => {
  const p = await KotlinAcceptance.connect();
  p.external('catalog', 'type Book { title: Text }');
  p.source('use Book from "catalog"\nexamples { observation book() returns Book\nexample "Dune title": book() => { title: "Dune" } }');
  await p.nativeFile('src/main/kotlin/catalog/Book.kt', 'package catalog\ndata class Book(val title: String)\ndata class OtherBook(val title: String)');
  p.importType({ declaration: ['Book'], module: 'catalog' }, 'catalog.Book');
  await p.buildAcceptance(); await p.rememberFile('src/test/kotlin/store/tests/acceptance/ShoppingAcceptance.kt');
  p.importType({ declaration: ['Book'], module: 'catalog' }, 'catalog.OtherBook');
  await p.expectAcceptanceRefused('output-options-changed');
  await p.expectFileUnchanged('src/test/kotlin/store/tests/acceptance/ShoppingAcceptance.kt');
});
it('adds a mapping for a new provider subject without rebinding the existing record', async () => {
  const p = await KotlinAcceptance.connect();
  p.external('catalog', 'type Book { title: Text }');
  p.source('use Book from "catalog"\nexamples { observation book() returns Book\nexample "Dune title": book() => { title: "Dune" } }');
  await p.nativeFile('src/main/kotlin/catalog/Book.kt', 'package catalog\ndata class Book(val title: String)');
  p.importType({ declaration: ['Book'], module: 'catalog' }, 'catalog.Book', 'CatalogBook');
  await p.buildAcceptance();
  await p.implementDriver('package store.tests.driver\nopen class ShoppingDriver { open fun book(): catalog.Book = catalog.Book("Dune") }');
  p.external('periodicals', 'type Magazine { title: Text }');
  p.source('use Book from "catalog"\nuse Magazine from "periodicals"\nexamples { observation book() returns Book\nobservation magazine() returns Magazine\nexample "Dune title": book() => { title: "Dune" } }');
  await p.nativeFile('src/main/kotlin/catalog/Magazine.kt', 'package catalog\ndata class Magazine(val title: String)');
  p.importType({ declaration: ['Magazine'], module: 'periodicals' }, 'catalog.Magazine', 'CatalogMagazine');
  await p.updateAcceptance();
  await p.readOperation('magazine'); p.expectReadContains('import catalog.Magazine as CatalogMagazine');
  p.expectReadContains('fun magazine(): CatalogMagazine');
  p.expectReadContains('Not implemented: magazine');
  await p.runTests(); p.expectTests(1, 0);
});
});
