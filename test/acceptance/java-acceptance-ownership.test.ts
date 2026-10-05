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
