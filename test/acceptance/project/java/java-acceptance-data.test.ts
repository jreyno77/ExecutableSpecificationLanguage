import { describe, it } from 'vitest';

import { JavaAcceptance } from '../../../dsl/project/java/java-acceptance.js';

describe('JUnit compares actual declared data', { timeout: 120_000 }, () => {
  it('distinguishes an absent component from a present zero at the actual field', async () => {
    const p = await JavaAcceptance.connect();
    p.source(`type Book { copies: Number? }
      examples { action begin() {}
        observation absentBook() returns Book
        observation presentBook() returns Book
        check copies() { assert absentBook() == presentBook() }
        scenario "Optional presence differs" { when begin()
          then copies() }
      }`);
    await p.generateContracts(); await p.generate(); p.expectGeneratedSteps(['shopping.copies()']);
    await p.driverMethods('public store.Book absentBook() { return new store.Book(java.util.Optional.empty()); } public store.Book presentBook() { return new store.Book(java.util.Optional.of(0.0)); }');
    await p.runTests(); p.expectTests(0,1); p.expectFailure('copies'); p.expectFailure('expected: <true> but was: <false>');
  });
  it('compares nested generated record and list components without object identity', async () => {
    const p = await JavaAcceptance.connect();
    p.source(`type Book { title: Text
        copies: List<Number> }
      type Shelf { books: List<Book> }
      examples { action begin() {}
        observation firstShelf() returns Shelf
        observation secondShelf() returns Shelf
        check sameData() { assert firstShelf() == secondShelf() }
        scenario "Same data in separate objects" { when begin()
          then sameData() }
      }`);
    await p.generateContracts(); await p.generate(); p.expectGeneratedSteps(['shopping.sameData()']);
    await p.driverMethods('public store.Shelf firstShelf() { return new store.Shelf(java.util.List.of(new store.Book("Dune", java.util.List.of(-0.0, 1.0)))); } public store.Shelf secondShelf() { return new store.Shelf(java.util.List.of(new store.Book("Dune", java.util.List.of(0.0, 1.0)))); }');
    await p.runTests(); p.expectTests(1,0);
  });
});

it('refuses a hostile List before typed result validation invokes its hooks', { timeout: 120_000 }, async () => {
  const p=await JavaAcceptance.connect();
  p.source('examples { action begin() {}\nobservation values() returns List<Number>\ncheck numbers() { assert values() == values() }\nscenario "Plain list data" { when begin()\nthen numbers() } }');
  await p.generate(); p.expectGeneratedSteps(['shopping.numbers()']);
  await p.driverMethods('static class Hook extends java.util.ArrayList<Double> { public java.util.stream.Stream<Double> stream() { throw new AssertionError("stream hook ran"); } } public java.util.List<Double> values() { var list=new Hook(); list.add(1.0); return list; }');
  await p.runTests(); p.expectTests(0,1); p.expectFailure('ordinary list data required'); p.expectNoFailure('stream hook ran');
});

describe('Java fixtures remain explicit reusable data', { timeout: 150_000 }, () => {
  it('constructs forward-referenced records and nested lists with exact optional presence', async () => {
    const p=await JavaAcceptance.connect();
    p.source(`type Book { title: Text
      copies: Number? }
    type Shelf { books: List<Book> }
    examples {
      fixture expected: Shelf = { books: [book] }
      fixture book: Book = { title: "Dune", copies: count }
      fixture count: Number = 1
      action begin() {}
      observation actualShelf() returns Shelf
      check sameData() { assert actualShelf() == expected
        assert book.title == "Dune" }
      scenario "Explicit Dune data" { when begin()
        then sameData() }
    }`);
    await p.generateContracts(); await p.generate(); p.expectApplied();
    await p.driverMethods('public store.Shelf actualShelf() { return new store.Shelf(java.util.List.of(new store.Book("Dune",java.util.Optional.of(1.0)))); }');
    await p.runTests(); p.expectTests(1,0);
  });
  it('constructs exact tuple fixture positions and reports the actual mismatching element', async () => {
    const p=await JavaAcceptance.connect();
    p.source(`examples {
      fixture expected: [Text, Number] = ["Dune", 1]
      action begin() {}
      observation actualPair() returns [Text, Number]
      check samePair() { assert actualPair() == expected }
      scenario "Tuple quantity differs" { when begin()
        then samePair() }
    }`);
    await p.generate(); p.expectApplied();
    await p.driverMethods('public store.tests.dsl.Tuple2<String,Double> actualPair() { return new store.tests.dsl.Tuple2<>("Dune",2.0); }');
    await p.runTests(); p.expectTests(0,1); p.expectFailure('value[1]'); p.expectFailure('expected: <1.0> but was: <2.0>');
  });
});

it('uses the same native tuple representation inside generated contract records and tests', { timeout: 150_000 }, async () => {
  const p=await JavaAcceptance.connect();
  p.source(`type Receipt { pair: [Text, Number] }
    examples { fixture expected: Receipt = { pair: ["Dune", 1] }
      action begin() {}
      observation actualReceipt() returns Receipt
      check sameReceipt() { assert actualReceipt() == expected }
      scenario "Nested tuple data" { when begin()
        then sameReceipt() }
    }`);
  await p.generateContracts(); await p.generate(); p.expectApplied();
  await p.driverMethods('public store.Receipt actualReceipt() { return new store.Receipt(new store.Tuple2<>("Dune",1.0)); }');
  await p.runTests(); p.expectTests(1,0);
});

it('refuses a handwritten constructor that would change the authored fixture data', { timeout:150_000 }, async()=>{
  const p=await JavaAcceptance.connect();
  p.source(`type Book { title: Text }
    examples { fixture expected: Book = { title: "Dune" }
      action begin() {}
      observation actualBook() returns Book
      check sameBook() { assert actualBook() == expected }
      scenario "Dune stays explicit" { when begin()
        then sameBook() }
    }`);
  await p.generateContracts();
  await p.replaceText('src/main/java/store/Book.java','title = store.ExpecData.required(title, "title");','title = java.lang.String.valueOf("Other");');
  await p.rememberFiles(); await p.generate(); p.expectRefused('unsupported-fixture-data'); await p.expectFilesUnchanged();
});

describe('native record construction is separate from observed data', { timeout:150_000 },()=>{
  it('constructs explicit data through an implicit native canonical constructor',async()=>{
    const p=await JavaAcceptance.connect();
    p.source(`type Book { title: Text }
      examples { fixture expected: Book = { title: "Dune" }
        action begin() {}
        observation actualBook() returns Book
        check sameBook() { assert actualBook() == expected }
        scenario "Implicit plain data" { when begin()
          then sameBook() }
      }`);
    await p.generateContracts();
    await p.file('src/main/java/store/Book.java','package store; public record Book(String title) {}');
    await p.generate(); p.expectApplied();
    await p.driverMethods('public store.Book actualBook() { return new store.Book("Dune"); }');
    await p.runTests(); p.expectTests(1,0);
  });
  it('refuses a record initializer even when the native canonical constructor is implicit',async()=>{
    const p=await JavaAcceptance.connect();
    p.source(`type Book { title: Text }
      examples { fixture book: Book = { title: "Dune" }
        action begin() {}
        scenario "No constructor hooks" { when begin()
          then book.title == "Dune" }
      }`);
    await p.generateContracts();
    await p.file('src/main/java/store/Book.java','package store; public record Book(String title) { static { System.setProperty("expec.fixture.hook","ran"); } }');
    await p.rememberFiles(); await p.generate(); p.expectRefused('unsupported-fixture-data'); await p.expectFilesUnchanged();
  });
  it('still observes records produced by an actual handwritten application constructor',async()=>{
    const p=await JavaAcceptance.connect();
    p.source(`type Book { title: Text }
      examples { action begin() {}
        observation actualBook() returns Book
        check normalizedTitle() { assert actualBook().title == "Other" }
        scenario "Actual normalized data" { when begin()
          then normalizedTitle() }
      }`);
    await p.generateContracts();
    await p.replaceText('src/main/java/store/Book.java','title = store.ExpecData.required(title, "title");','title = "Other";');
    await p.generate(); p.expectApplied();
    await p.driverMethods('public store.Book actualBook() { return new store.Book("Dune"); }');
    await p.runTests(); p.expectTests(1,0);
  });
});

it('uses the checked observation type for an inline tuple expectation', {timeout:150_000}, async()=>{
  const p=await JavaAcceptance.connect();
  p.source('examples { observation position() returns [Number, Number]\nexample "Current position": position() => [1, 2] }');
  await p.generate(); p.expectApplied();
  await p.driverMethods('public store.tests.dsl.Tuple2<Double,Double> position() { return new store.tests.dsl.Tuple2<>(1.0,2.0); }');
  await p.runTests(); p.expectTests(1,0);
  await p.driverMethods('public store.tests.dsl.Tuple2<Double,Double> position() { return new store.tests.dsl.Tuple2<>(2.0,1.0); }');
  await p.runTests(); p.expectTests(0,1); p.expectFailure('value[0]');
});

describe('Java record observations retain their checked field contracts', {timeout:150_000},()=>{
  it('refuses a native record field whose type disagrees with the checked data',async()=>{
    const p=await JavaAcceptance.connect();
    p.source(`type Book { copies: Number }
      examples { action begin() {}
        observation first() returns Book
        observation second() returns Book
        check equalBooks() { assert first() == second() }
        scenario "Numbers stay numbers" { when begin()
          then equalBooks() }
      }`);
    await p.generateContracts();
    await p.file('src/main/java/store/Book.java','package store; public record Book(String copies) {}');
    await p.rememberFiles(); await p.generate(); p.expectRefused('native-contract-conflict'); await p.expectFilesUnchanged();
  });
  it('does not let two identically wrong literal fields verify each other',async()=>{
    const p=await JavaAcceptance.connect();
    p.source(`type Book { title: "Dune" }
      examples { action begin() {}
        observation first() returns Book
        observation second() returns Book
        check equalBooks() { assert first() == second() }
        scenario "Dune is a declared constraint" { when begin()
          then equalBooks() }
      }`);
    await p.generateContracts();
    await p.file('src/main/java/store/Book.java','package store; public record Book(String title) {}');
    await p.generate(); p.expectApplied();
    await p.driverMethods('public store.Book first() { return new store.Book("Other"); } public store.Book second() { return new store.Book("Other"); }');
    await p.runTests(); p.expectTests(0,1); p.expectFailure('literal value required');
  });
});

it('checks the actual generic record component instead of trusting an unchecked Java cast', {timeout:150_000},async()=>{
  const p=await JavaAcceptance.connect();
  p.source(`type Box<T> { value: T }
    examples { observation first() returns Box<Number>
      observation second() returns Box<Number>
      example "Generic numbers": first() => second()
    }`);
  await p.generateContracts(); await p.generate(); p.expectApplied();
  await p.driverMethods('public store.Box<Double> first() { return new store.Box<>(1.0); } public store.Box<Double> second() { return new store.Box<>(1.0); }');
  await p.runTests(); p.expectTests(1,0);
  await p.driverMethods('@SuppressWarnings({"unchecked","rawtypes"}) public store.Box<Double> first() { return new store.Box("Dune"); } @SuppressWarnings({"unchecked","rawtypes"}) public store.Box<Double> second() { return new store.Box("Dune"); }');
  await p.runTests(); p.expectTests(0,1);
});

it('refuses a handwritten record accessor that would normalize expected Dune into Other', {timeout:150_000},async()=>{
  const p=await JavaAcceptance.connect();
  p.source(`type Book { title: Text }
    examples { fixture expected: Book = { title: "Dune" }
      observation actualBook() returns Book
      example "Authored Dune": actualBook() => expected
    }`);
  await p.generateContracts();
  await p.file('src/main/java/store/Book.java','package store; public record Book(String title) { public String title() { return "Other"; } }');
  await p.rememberFiles(); await p.generate(); p.expectRefused('unsupported-comparison-data'); await p.expectFilesUnchanged();
});
