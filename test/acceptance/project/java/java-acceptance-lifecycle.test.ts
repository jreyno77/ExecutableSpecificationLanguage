import { describe, it } from 'vitest';

import { JavaAcceptance } from '../../../dsl/project/java/java-acceptance.js';

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
