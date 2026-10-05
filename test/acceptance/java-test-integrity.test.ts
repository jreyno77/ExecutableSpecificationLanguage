import { describe, it } from 'vitest';
import { JavaAcceptance } from '../dsl/java-acceptance.js';

describe('native queries retain generated Java test integrity', { timeout: 120_000 }, () => {
  it('retains the actual caller of a surviving sibling when another scenario is retired', async () => {
    const p=await JavaAcceptance.connect();
    p.source('examples { action begin() {}\nscenario "Removed" { when begin()\nthen true }\nscenario "Retained" { when begin()\nthen true } }');
    p.nameGroup(0,'BasketExamples'); p.nameScenario('Removed','oldCase'); p.nameScenario('Retained','keepCase');
    await p.generate(); p.expectApplied();
    const caller='src/test/java/store/tests/Caller.java';
    await p.file(caller,'package store.tests; public class Caller { public void invoke() { new store.tests.acceptance.BasketExamples().keepCase(); } }');
    await p.rememberFiles();
    await p.retireScenario('Removed','examples { action begin() {}\nscenario "Retained" { when begin()\nthen true } }');
    p.expectApplied(); p.expectRememberedFilesExcept(['src/test/java/store/tests/acceptance/BasketExamples.java','.expec/outputs/java-acceptance.json']);
    await p.runTests({classes:['store.tests.acceptance.BasketExamples']}); p.expectTests(1,0);
  });
  it('refuses retirement that would capture an unchanged caller with an inherited fixture method', async () => {
    const p=await JavaAcceptance.connect();
    p.source('examples { action begin() {}\nscenario "Removed" { when begin()\nthen true }\nscenario "Retained" { when begin()\nthen true } }');
    p.nameGroup(0,'BasketExamples'); p.nameScenario('Removed','oldCase'); p.nameScenario('Retained','keepCase');
    const fixture='src/test/java/store/tests/Fresh.java';
    await p.file(fixture,'package store.tests; public class Fresh { protected store.tests.driver.ShoppingDriver createDriver() { return new store.tests.driver.ShoppingDriver(); } public void oldCase() { System.out.print("CAPTURED"); } }');
    p.selectFixture(fixture,'store.tests.Fresh'); await p.generate(); p.expectApplied();
    const caller='src/test/java/store/tests/Caller.java';
    await p.file(caller,'package store.tests; public class Caller { public void invoke() { new store.tests.acceptance.BasketExamples().oldCase(); } }');
    await p.rememberFiles();
    await p.retireScenario('Removed','examples { action begin() {}\nscenario "Retained" { when begin()\nthen true } }');
    p.expectRefusedAt('native-binding-conflict',caller,'oldCase'); await p.expectFilesUnchanged();
  });
  it('returns the actual changed assertion bytes without calling their generated meaning complete', async () => {
    const p=await JavaAcceptance.connect();
    p.source('examples { observation quantity() returns Number\nexample "One copy": quantity() => 1 }');
    await p.generate(); p.expectApplied();
    const path='src/test/java/store/tests/acceptance/Examples.java';
    await p.replaceText(path,'1.0','2.0'); await p.rememberFiles();
    await p.readScenario('One copy'); p.expectIncompleteRead('generated-test-drift',path); await p.expectFilesUnchanged();
  });
  it('does not claim complete search after the native test annotation was removed', async () => {
    const p=await JavaAcceptance.connect();
    p.source('examples { observation quantity() returns Number\nexample "One copy": quantity() => 1 }');
    await p.generate(); p.expectApplied();
    await p.replaceText('src/test/java/store/tests/acceptance/Examples.java','@org.junit.jupiter.api.Test\n',''); await p.rememberFiles();
    await p.searchScenario('One copy'); p.expectIncompleteSearch('generated-test-drift'); await p.expectFilesUnchanged();
  });
});
