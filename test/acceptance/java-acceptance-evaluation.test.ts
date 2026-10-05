import { describe, it } from 'vitest';

import { JavaAcceptance } from '../dsl/java-acceptance.js';

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

it('keeps exact binary64 comparison instead of rounding a decimal sum into success', { timeout: 120_000 }, async () => {
  const p=await JavaAcceptance.connect();
  p.source('examples { action begin() {}\ncheck decimal() { assert 0.1 + 0.2 == 0.3 }\nscenario "Binary64 addition" { when begin()\nthen decimal() } }');
  await p.generate(); p.expectApplied(); await p.runTests(); p.expectTests(0,1);
  p.expectFailure('expected: <0.3> but was: <0.30000000000000004>');
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
