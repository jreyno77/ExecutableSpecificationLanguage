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
    await p.installBasket(); await p.rememberFiles(); await p.generate(); p.expectApplied(); await p.expectFilesUnchanged();
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
