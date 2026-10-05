import { describe, it } from "vitest";
import { KotlinAcceptance } from "../dsl/kotlin-acceptance.js";
describe("native imported type meaning", { timeout: 240_000 }, () => {

  it('rejects a provider generic bound that narrows the declared data contract', async () => {
    const p = await KotlinAcceptance.connect();
    p.external('catalog', 'type Box<T> { value: T }');
    p.source('use Box from "catalog"\nexamples { observation box() returns Box<Number>\nexample "one copy": box() => { value: 1 } }');
    await p.nativeFile('src/main/kotlin/catalog/Box.kt', 'package catalog\ndata class Box<T : Number>(val value: T)');
    p.importType({ declaration: ['Box'], module: 'catalog' }, 'catalog.Box');
    await p.expectAcceptanceRefused('native-signature-conflict');
    p.expectNoGeneratedStep('fun oneCopy()');
  });
  it('recognizes a native type alias by meaning rather than its rendered spelling', async () => {
    const p = await KotlinAcceptance.connect();
    p.external('catalog', 'type Book { title: Text }');
    p.source('use Book from "catalog"\nexamples { observation book() returns Book\nexample "Dune title": book() => { title: "Dune" } }');
    await p.nativeFile('src/main/kotlin/catalog/Book.kt', 'package catalog\ntypealias Title = String\ndata class Book(val title: Title)');
    p.importType({ declaration: ['Book'], module: 'catalog' }, 'catalog.Book');
    await p.buildAcceptance();
    await p.implementDriver('package store.tests.driver\nopen class ShoppingDriver { open fun book(): catalog.Book = catalog.Book("Dune") }');
    await p.runTests(); p.expectTests(1, 0);
  });



  it('checks a mapped empty record generic bound even without any fields', async () => {
    const p = await KotlinAcceptance.connect();
    p.external('catalog', 'type Empty<T> {}');
    p.source('use Empty from "catalog"\nexamples { observation empty() returns Empty<Number>\nexample "empty data": empty() => {} }');
    await p.nativeFile('src/main/kotlin/catalog/Empty.kt', 'package catalog\nclass Empty<T : Number>');
    p.importType({ declaration: ['Empty'], module: 'catalog' }, 'catalog.Empty');
    await p.expectAcceptanceRefused('native-signature-conflict');
    p.expectNoGeneratedStep('fun emptyData()');
  });

});
