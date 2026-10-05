import { it } from 'vitest';
import { KotlinAcceptance } from '../dsl/kotlin-acceptance.js';

it('uses the actual returned receipt in later authored steps', async () => {
  const project = await KotlinAcceptance.connect();
  project.source(`type Receipt { title: Text }
examples {
  action buy(title: Text) returns Receipt
  check expectTitle(receipt: Receipt, expected: Text) { assert receipt.title == expected }
  scenario "receipt" {
    when receipt = buy("Dune")
    then expectTitle(receipt, "Dune")
  }
}`);
  await project.buildContracts();
  await project.buildAcceptance();
  await project.implementDriver(`package store.tests.driver
class ShoppingDriver {
  fun buy(title: String): store.Receipt = store.Receipt("different")
}`);
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('expected: <Dune> but was: <different>');
}, 180_000);

it('compares independently constructed empty fixture records', async () => {
  const project = await KotlinAcceptance.connect();
  project.source(`type Empty {}
examples {
  fixture first: Empty = {}
  fixture second: Empty = {}
  example "independent empty data": first => second
}`);
  await project.buildContracts(); await project.buildAcceptance();
  await project.runTests(); project.expectTests(1, 0);
}, 180_000);

it('keeps omitted optional fixture data distinct from supplied text', async () => {
  const project = await KotlinAcceptance.connect();
  project.source(`type Book { note: Text? }
examples {
  fixture absent: Book = {}
  fixture present: Book = { note: "Dune" }
  example "same absent data": absent => Book {}
  example "same present data": present => Book { note: "Dune" }
  example "absent is not present": absent => present
  example "present is not absent": present => absent
}`);
  await project.buildContracts(); await project.buildAcceptance();
  await project.runTests(); project.expectTests(2, 2);
  project.expectFailure("optional presence");
}, 180_000);

it('initializes reusable data from declaration dependencies instead of authored order', async () => {
  const project = await KotlinAcceptance.connect();
  project.source(`type Book { title: Text }
examples {
  fixture title: Text = book.title
  fixture book: Book = { title: "Dune" }
  example "read later book data": title => "Dune"
}`);
  await project.buildContracts(); await project.buildAcceptance();
  await project.runTests(); project.expectTests(1, 0);
}, 180_000);
