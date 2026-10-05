import { describe, it } from 'vitest';
import { JavaAcceptance } from '../dsl/java-acceptance.js';

describe('removing only owned generated Java tests', { timeout: 120_000 }, () => {
  it('deletes one generated scenario and retains its sibling and actual driver', async () => {
    const p = await JavaAcceptance.connect();
    p.source(`examples {
      observation quantity() returns Number
      example "One copy": quantity() => 1
      example "Two copies": quantity() => 2
    }`);
    p.nameScenario('One copy','oneCopy'); p.nameScenario('Two copies','twoCopies');
    await p.generate(); p.expectApplied();
    await p.driverMethods('public double quantity() { return 2.0; }');
    await p.rememberFiles();
    await p.deleteScenario('One copy'); p.expectApplied();
    p.expectScenarioNames(['Two copies']);
    p.expectSourceAbsent('src/test/java/store/tests/acceptance/Examples.java','void oneCopy()');
    p.expectSourceContains('src/test/java/store/tests/acceptance/Examples.java','void twoCopies()');
    p.expectRememberedFilesExcept(['src/test/java/store/tests/acceptance/Examples.java','.expec/outputs/java-acceptance.json']);
    await p.runTests(); p.expectTests(1,0);
  });
  it('deletes a generated group while retaining actual driver code', async () => {
    const p = await JavaAcceptance.connect();
    p.source('examples { observation quantity() returns Number\nexample "One copy": quantity() => 1 }');
    await p.generate(); p.expectApplied();
    await p.driverMethods('public double quantity() { return 1.0; }'); await p.rememberFiles();
    await p.deleteGroup(0); p.expectApplied();
    p.expectFileAbsent('src/test/java/store/tests/acceptance/Examples.java');
    p.expectScenarioNames([]);
    p.expectRememberedFilesExcept(['src/test/java/store/tests/acceptance/Examples.java','.expec/outputs/java-acceptance.json']);
  });
  it('refuses scenario deletion after its generated assertion was changed', async () => {
    const p = await JavaAcceptance.connect();
    p.source('examples { observation quantity() returns Number\nexample "One copy": quantity() => 1 }');
    await p.generate(); p.expectApplied();
    await p.replaceText('src/test/java/store/tests/acceptance/Examples.java','1.0','2.0'); await p.rememberFiles();
    await p.deleteScenario('One copy'); p.expectRefused('generated-test-drift'); await p.expectFilesUnchanged();
  });
  it('refuses deletion when an actual native caller uses the selected scenario', async () => {
    const p = await JavaAcceptance.connect();
    p.source('examples { observation quantity() returns Number\nexample "One copy": quantity() => 1 }');
    p.nameScenario('One copy','oneCopy'); await p.generate(); p.expectApplied();
    await p.file('src/test/java/store/tests/Caller.java','package store.tests; class Caller { void run() { new store.tests.acceptance.Examples().oneCopy(); } }');
    await p.rememberFiles(); await p.deleteScenario('One copy');
    p.expectRefusedAt('native-incoming-use','src/test/java/store/tests/Caller.java','oneCopy'); await p.expectFilesUnchanged();
  });
});
