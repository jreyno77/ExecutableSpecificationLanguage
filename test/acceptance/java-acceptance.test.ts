import { describe, it } from 'vitest';
import { JavaAcceptance } from '../dsl/java-acceptance.js';

const dune = `examples {
  setup available(title: Text)
  action add(title: Text)
  observation quantity(title: Text) returns Number
  check expectQuantity(title: Text, expected: Number) { let actual = quantity(title)
    assert actual == expected }
  scenario "Dune can be added" { given available("Dune")
    when add("Dune")
    then expectQuantity("Dune", 1) }
}`;

describe('generated JUnit reaches the actual application', { timeout: 120_000 }, () => {
  it('adds Dune through readable layers and observes the actual basket', async () => {
    const p = await JavaAcceptance.connect(); p.source(dune); await p.generate();
    p.expectGeneratedSteps(['shopping.available("Dune")','shopping.add("Dune")','shopping.expectQuantity("Dune", 1.0)']);
    await p.installBasket(); await p.runTests(); p.expectTests(1,0); p.expectQuantity('Dune',1);
  });
  it('fails the same authored test when the actual basket contains two copies', async () => {
    const p = await JavaAcceptance.connect(); p.source(dune); await p.generate();
    p.expectGeneratedSteps(['shopping.expectQuantity("Dune", 1.0)']);
    await p.installBasket(2); await p.runTests(); p.expectTests(0,1); p.expectAssertion(1,2); p.expectQuantity('Dune',2);
  });
  it('keeps an unimplemented driver visibly unfinished', async () => {
    const p = await JavaAcceptance.connect(); p.source(dune); await p.generate();
    p.expectGeneratedSteps(['shopping.available("Dune")']); await p.runTests(); p.expectTests(0,1); p.expectUnfinished('available');
  });
});


describe('JUnit uses checked native evaluation order and finite numbers', { timeout: 120_000 }, () => {
  it('evaluates the observation once and does not call the short-circuited branch', async () => {
    const p = await JavaAcceptance.connect();
    p.source(`examples {
      observation next() returns Number
      observation forbidden() returns Boolean
      action begin() {}
      check once() { let actual = next()
        assert actual == 1
        assert true or forbidden() }
      scenario "Observe once" { when begin()
        then once() }
    }`); await p.generate(); p.expectGeneratedSteps(['shopping.begin()']);
    await p.driverMethods('private int calls; public double next() { calls++; System.out.println("CALLS:"+calls); return calls; } public boolean forbidden() { throw new AssertionError("must not run"); }');
    await p.runTests(); p.expectTests(1,0); p.expectNativeOutput('CALLS:1');
  });
  it('normalizes signed zero in actual native equality', async () => {
    const p = await JavaAcceptance.connect();
    p.source('examples { action begin() {}\ncheck zeros() { assert -0 == 0 }\nscenario "Signed zeros agree" { when begin()\nthen zeros() } }');
    await p.generate(); p.expectGeneratedSteps(['shopping.begin()']); await p.runTests(); p.expectTests(1,0);
  });
  it('rejects a nonfinite observation before a comparison can pass', async () => {
    const p = await JavaAcceptance.connect();
    p.source('examples { action begin() {}\nobservation quantity() returns Number\ncheck positive() { assert quantity() > 0 }\nscenario "Finite quantity" { when begin()\nthen positive() } }');
    await p.generate(); p.expectGeneratedSteps(['shopping.positive()']);
    await p.driverMethods('public double quantity() { return Double.POSITIVE_INFINITY; }');
    await p.runTests(); p.expectTests(0,1); p.expectFailure('finite Number required');
    await p.driverMethods('public double quantity() { return Double.NaN; }');
    await p.runTests(); p.expectTests(0,1); p.expectFailure('finite Number required');
  });
  it('rejects nonfinite arithmetic instead of treating infinity as a comparison value', async () => {
    const p = await JavaAcceptance.connect();
    p.source('examples { action begin() {}\ncheck division() { assert 1 / 0 == 0 }\nscenario "Finite arithmetic" { when begin()\nthen division() } }');
    await p.generate(); p.expectGeneratedSteps(['shopping.division()']); await p.runTests(); p.expectTests(0,1); p.expectFailure('finite Number required');
  });
});


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


describe('JUnit fixture selection and resource cleanup', { timeout: 120_000 }, () => {
  it('refuses a fixture mapping that has no actual native type', async () => {
    const p=await JavaAcceptance.connect(); p.source(dune);
    p.selectFixture('src/test/java/store/tests/MissingFixture.java','store.tests.MissingFixture');
    await p.generate(); p.expectRefused('fixture-mapping-unavailable'); p.expectNoGeneratedFiles();
  });
  it('refuses a native factory returning Text instead of the selected driver', async () => {
    const p=await JavaAcceptance.connect(); p.source(dune);
    const file='src/test/java/store/tests/WrongFixture.java';
    await p.file(file,'package store.tests; public class WrongFixture { protected String createDriver() { return "Dune"; } }');
    p.selectFixture(file,'store.tests.WrongFixture'); await p.generate(); p.expectRefused('incompatible-driver-factory'); p.expectNoGeneratedFiles();
  });
  it('closes an acquired socket after setup fails and keeps the cleanup failure', async () => {
    const p=await JavaAcceptance.connect(); p.source(dune); await p.resourceFixture(true);
    await p.generate(); p.expectGeneratedSteps(['shopping.available("Dune")']); await p.installBasket(); await p.runTests();
    p.expectTests(0,1); p.expectNativeOutput('SOCKET-CLOSED:true'); p.expectBodyDidNotRun(); p.expectFailure('setup failed'); p.expectFailure('cleanup failed');
  });
  it('retains the wrong actual quantity and cleanup failure after the test runs', async () => {
    const p=await JavaAcceptance.connect(); p.source(dune); await p.resourceFixture(false);
    await p.generate(); p.expectGeneratedSteps(['shopping.expectQuantity("Dune", 1.0)']); await p.installBasket(2); await p.runTests();
    p.expectTests(0,1); p.expectNativeOutput('SOCKET-CLOSED:true'); p.expectQuantity('Dune',2); p.expectAssertion(1,2); p.expectFailure('cleanup failed');
  });
});


describe('JUnit adopts only explicitly mapped driver operations', { timeout: 120_000 }, () => {
  it('retains actual basket methods and leaves only quantity unfinished', async () => {
    const p=await JavaAcceptance.connect(); p.source(dune); await p.partialBasket();
    await p.generate(); p.expectGeneratedSteps(['shopping.available("Dune")','shopping.expectQuantity("Dune", 1.0)']);
    p.expectSourceContains('src/test/java/store/tests/driver/BasketDriver.java','// This actual basket implementation must survive adoption.');
    await p.runTests(); p.expectTests(0,1); p.expectQuantity('Dune',1); p.expectUnfinished('quantity');
    await p.implementQuantity(); await p.runTests(); p.expectTests(1,0); p.expectQuantity('Dune',1);
  });
  it('does not adopt a same-named method without its operation association', async () => {
    const p=await JavaAcceptance.connect(); p.source(dune);
    const file='src/test/java/store/tests/driver/BasketDriver.java';
    await p.file(file,'package store.tests.driver; public class BasketDriver { public void available(String title) { throw new AssertionError("unrelated"); } }');
    p.selectDriver(file,'store.tests.driver.BasketDriver'); await p.generate();
    p.expectRefused('native-mapping-required'); p.expectNoGeneratedFiles();
    p.expectSourceContains(file,'throw new AssertionError("unrelated")');
  });
  it('refuses an explicitly mapped observation with an incompatible native result', async () => {
    const p=await JavaAcceptance.connect(); p.source(dune);
    const file='src/test/java/store/tests/driver/BasketDriver.java',type='store.tests.driver.BasketDriver';
    await p.file(file,'package store.tests.driver; public class BasketDriver { public String quantity(String title) { return "many"; } }');
    p.selectDriver(file,type); p.mapOperation('quantity',file,type,'quantity',['java.lang.String']); await p.generate();
    p.expectRefused('native-contract-conflict'); p.expectNoGeneratedFiles(); p.expectSourceContains(file,'return "many"');
  });
});


describe('Java acceptance identity survives reopening', { timeout: 120_000 }, () => {
  it('reads the actual complete file through a specific scenario method', async () => {
    const p=await JavaAcceptance.connect(); p.source(dune); await p.generate(); p.expectGeneratedSteps(['shopping.available("Dune")']);
    await p.readScenario('Dune can be added'); p.expectScenarioFile('src/test/java/store/tests/acceptance/Examples.java','Dune can be added');
  });
  it('finds the checked call across its associated driver and DSL facets', async () => {
    const p=await JavaAcceptance.connect(); p.source(dune); await p.generate(); p.expectGeneratedSteps(['shopping.expectQuantity("Dune", 1.0)']);
    await p.searchOperation('quantity'); p.expectNativeOperationUse('src/test/java/store/tests/dsl/Shopping.java','this.quantity(title)','quantity');
  });
  it('refuses duplicate ownership metadata before claiming a complete scenario read', async () => {
    const p=await JavaAcceptance.connect(); p.source(dune); await p.generate(); p.expectGeneratedSteps(['shopping.available("Dune")']);
    await p.corruptState(); await p.readScenario('Dune can be added'); p.expectInvalidState();
  });
});


it('refuses a hostile List before typed result validation invokes its hooks', { timeout: 120_000 }, async () => {
  const p=await JavaAcceptance.connect();
  p.source('examples { action begin() {}\nobservation values() returns List<Number>\ncheck numbers() { assert values() == values() }\nscenario "Plain list data" { when begin()\nthen numbers() } }');
  await p.generate(); p.expectGeneratedSteps(['shopping.numbers()']);
  await p.driverMethods('static class Hook extends java.util.ArrayList<Double> { public java.util.stream.Stream<Double> stream() { throw new AssertionError("stream hook ran"); } } public java.util.List<Double> values() { var list=new Hook(); list.add(1.0); return list; }');
  await p.runTests(); p.expectTests(0,1); p.expectFailure('ordinary list data required'); p.expectNoFailure('stream hook ran');
});


describe('native acceptance ownership survives repeated generation', { timeout: 180_000 }, () => {
  it('repeats generation without replacing the actual basket implementation', async () => {
    const p=await JavaAcceptance.connect(); p.source(dune); await p.generate(); p.expectApplied();
    await p.installBasket(); await p.rememberFiles(); await p.generate(); p.expectUnchanged(); await p.expectFilesUnchanged();
    await p.runTests(); p.expectTests(1,0); p.expectQuantity('Dune',1);
  });
  it('updates the authored expected quantity while retaining the actual driver', async () => {
    const p=await JavaAcceptance.connect(); p.source(dune); await p.generate(); p.expectApplied(); await p.installBasket();
    await p.update(dune.replace('expectQuantity("Dune", 1)','expectQuantity("Dune", 2)')); p.expectApplied();
    await p.runTests(); p.expectTests(0,1); p.expectAssertion(2,1); p.expectQuantity('Dune',1);
  });
  it('refuses a changed generated assertion instead of adopting it as an implementation', async () => {
    const p=await JavaAcceptance.connect(); p.source(dune); await p.generate(); p.expectApplied();
    await p.replaceText('src/test/java/store/tests/dsl/Shopping.java','ExpecChecks.equal(actual, expected);','org.junit.jupiter.api.Assertions.assertTrue(true);');
    await p.rememberFiles(); await p.update(dune); p.expectRefused('generated-test-drift'); await p.expectFilesUnchanged();
  });
});


it('refuses to recreate a removed owned scenario as though its integrity were intact', { timeout: 180_000 }, async () => {
  const p=await JavaAcceptance.connect(); p.source(dune); await p.generate(); p.expectApplied();
  await p.removeFile('src/test/java/store/tests/acceptance/Examples.java'); await p.rememberFiles();
  await p.update(dune); p.expectRefused('generated-test-drift'); await p.expectFilesUnchanged();
});


it('keeps exact binary64 comparison instead of rounding a decimal sum into success', { timeout: 120_000 }, async () => {
  const p=await JavaAcceptance.connect();
  p.source('examples { action begin() {}\ncheck decimal() { assert 0.1 + 0.2 == 0.3 }\nscenario "Binary64 addition" { when begin()\nthen decimal() } }');
  await p.generate(); p.expectApplied(); await p.runTests(); p.expectTests(0,1);
  p.expectFailure('expected: <0.3> but was: <0.30000000000000004>');
});

it('isolates actual mutable baskets during two concurrent native scenarios', { timeout: 120_000 }, async () => {
  const p=await JavaAcceptance.connect();
  p.source(`examples {
    setup available(title: Text)
    action add(title: Text)
    observation quantity(title: Text) returns Number
    check expectQuantity(title: Text, expected: Number) { assert quantity(title) == expected }
    scenario "First basket" { given available("Dune")
      when add("Dune")
      then expectQuantity("Dune", 1) }
    scenario "Second basket" { given available("Dune")
      when add("Dune")
      then expectQuantity("Dune", 1) }
  }`);
  await p.generate(); p.expectApplied(); await p.installBarrierBasket(); await p.runTests({parallel:true});
  p.expectTests(2,0); p.expectIndependentBaskets();
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


it('keeps repeated human titles in distinct explicitly named native groups', { timeout: 150_000 }, async () => {
  const p=await JavaAcceptance.connect();
  p.source(`examples { action first() {}
    scenario "Dune" { when first()
      then true } }
  examples { action second() {}
    scenario "Dune" { when second()
      then true } }`);
  p.nameGroup(0,'FirstBasket','dune'); p.nameGroup(1,'SecondBasket','dune');
  await p.generate(); p.expectApplied();
  p.expectSelectors([
    {file:'src/test/java/store/tests/acceptance/FirstBasket.java',type:'store.tests.acceptance.FirstBasket',method:'dune',title:'Dune'},
    {file:'src/test/java/store/tests/acceptance/SecondBasket.java',type:'store.tests.acceptance.SecondBasket',method:'dune',title:'Dune'},
  ]);
  await p.runTests({classes:['store.tests.acceptance.FirstBasket','store.tests.acceptance.SecondBasket']}); p.expectTests(2,0);
});

describe('Java scenarios retain ordered native captures', { timeout: 150_000 }, () => {
  it('uses a captured record through its checked member type', async () => {
    const p=await JavaAcceptance.connect();
    p.source(`type Receipt { title: Text }
      examples { action checkout() returns Receipt
        scenario "Chosen receipt" { when receipt = checkout()
          then receipt.title == "Dune" }
      }`);
    await p.generateContracts(); await p.generate(); p.expectApplied();
    await p.driverMethods('public store.Receipt checkout() { System.out.println("CHECKOUT:Dune"); return new store.Receipt("Dune"); }');
    await p.runTests(); p.expectTests(1,0); p.expectNativeOutput('CHECKOUT:Dune');
  });
  it('keeps an authored capture distinct from the generated domain field', async () => {
    const p=await JavaAcceptance.connect();
    p.source(`examples { action selectedTitle() returns Text
      action confirm(title: Text)
      scenario "Capture called shopping" { when shopping = selectedTitle()
        when confirm(shopping)
        then shopping == "Dune" }
    }`);
    await p.generate(); p.expectApplied();
    await p.driverMethods('public String selectedTitle() { return "Dune"; } public void confirm(String title) { System.out.println("CONFIRMED:"+title); }');
    await p.runTests(); p.expectTests(1,0); p.expectNativeOutput('CONFIRMED:Dune');
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


describe('unverified Java expectations remain visibly unfinished', {timeout:150_000},()=>{
  it('observes the short example once and retains its actual prose as an obligation',async()=>{
    const p=await JavaAcceptance.connect();
    p.source('examples { observation title() returns Text\nexample "Survives restart": title() => satisfies "Dune remains available after restart" }');
    await p.generate(); p.expectApplied(); p.expectObligation('unimplemented-verification','Dune remains available after restart');
    await p.driverMethods('public String title() { System.out.println("OBSERVED:Dune"); return "Dune"; }');
    await p.runTests(); p.expectTests(0,1); p.expectNativeOutput('OBSERVED:Dune'); p.expectFailure('Verification required: Dune remains available after restart');
  });
  it('runs the real action before an unfinished scenario verification',async()=>{
    const p=await JavaAcceptance.connect();
    p.source('examples { action begin()\nscenario "Review the basket" { when begin()\nthen satisfies "Dune is visible in the basket" } }');
    await p.generate(); p.expectApplied(); p.expectObligation('unimplemented-verification','Dune is visible in the basket');
    await p.driverMethods('public void begin() { System.out.println("ACTION:Dune"); }');
    await p.runTests(); p.expectTests(0,1); p.expectNativeOutput('ACTION:Dune'); p.expectFailure('Verification required: Dune is visible in the basket');
  });
  it('keeps a bodyless check unfinished without inventing a driver assertion',async()=>{
    const p=await JavaAcceptance.connect();
    p.source('examples { action begin() {}\ncheck verified()\nscenario "Verification is missing" { when begin()\nthen verified() } }');
    await p.generate(); p.expectApplied(); p.expectObligation('implementation-required','verified');
    await p.runTests(); p.expectTests(0,1); p.expectUnfinished('verified');
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


describe('Java test generation respects source workspace ownership', {timeout:150_000},()=>{
  it('runs only the entry examples when an included provider is not workspace owned',async()=>{
    const p=await JavaAcceptance.connect();
    p.library('catalog',`examples { action libraryBegin() {}
      check libraryData() { assert 1 == 1 }
      scenario "Provider example" { when libraryBegin()
        then libraryData() }
    }`);
    p.source(`include "catalog"
      examples { action begin() {}
        check data() { assert 2 == 2 }
        scenario "Workspace example" { when begin()
          then data() }
      }`);
    p.nameGroup('main','WorkspaceExamples','workspace'); p.nameGroup('catalog','ProviderExamples','provider');
    await p.generate(); p.expectApplied();
    p.expectSelectors([{file:'src/test/java/store/tests/acceptance/WorkspaceExamples.java',type:'store.tests.acceptance.WorkspaceExamples',method:'workspace',title:'Workspace example'}]);
    await p.runTests({classes:['store.tests.acceptance.WorkspaceExamples']}); p.expectTests(1,0);
  });
  it('runs explicitly owned included examples beside the entry examples',async()=>{
    const p=await JavaAcceptance.connect();
    p.library('catalog',`examples { action libraryBegin() {}
      check libraryData() { assert 1 == 1 }
      scenario "Provider example" { when libraryBegin()
        then libraryData() }
    }`);
    p.source(`include "catalog"
      examples { action begin() {}
        check data() { assert 2 == 2 }
        scenario "Workspace example" { when begin()
          then data() }
      }`);
    p.workspaceModules(['catalog']); p.nameGroup('main','WorkspaceExamples','workspace'); p.nameGroup('catalog','ProviderExamples','provider');
    await p.generate(); p.expectApplied();
    p.expectSelectors([
      {file:'src/test/java/store/tests/acceptance/WorkspaceExamples.java',type:'store.tests.acceptance.WorkspaceExamples',method:'workspace',title:'Workspace example'},
      {file:'src/test/java/store/tests/acceptance/ProviderExamples.java',type:'store.tests.acceptance.ProviderExamples',method:'provider',title:'Provider example'},
    ]);
    await p.runTests({classes:['store.tests.acceptance.WorkspaceExamples','store.tests.acceptance.ProviderExamples']}); p.expectTests(2,0);
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
