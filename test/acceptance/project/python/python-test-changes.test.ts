import { afterEach, describe, it } from 'vitest';
import { PythonTestChanges } from '../../../dsl/project/python/python-test-changes.js';

afterEach(() => PythonTestChanges.dispose(), 30_000);
describe('preserving the shape of Python acceptance tests', { timeout: 240_000 }, () => {
  it('keeps an unowned neighbor when retiring the last generated scenario', async () => {
    const p = await PythonTestChanges.fromSource('examples { example "one": 1 => 1 }');
    await p.generateTests(); await p.addNativeNeighbor('Keep this independent function.');
    await p.deleteOnlyExamplesGroup(); p.expectApplied(); p.expectNoScenarioAssociation('one');
    await p.expectNativeNeighborRetained('Keep this independent function.');
  });
  it('requires update to change a surviving assertion while restoring another case', async () => {
    const p = await PythonTestChanges.fromSource('examples { example "one": 1 => 1\nexample "two": 2 => 2 }');
    await p.generateTests(); await p.deleteScenario('one'); p.expectApplied();
    p.reviseSource('examples { example "one": 1 => 1\nexample "two": 2 => 3 }'); await p.rememberAllFiles();
    await p.requestCreation(); p.expectProblem('use-update'); await p.expectAllFilesUnchanged();
  });
  it('requires update when an addition changes an existing examples group', async () => {
    const p = await PythonTestChanges.fromSource('examples { example "one": 1 => 1 }');
    await p.generateTests(); p.addExample('two', '2 => 2'); await p.rememberAllFiles();
    await p.insertTests(); p.expectProblem('not-addition-only'); await p.expectAllFilesUnchanged();
  });
  it('does not report an unknown identifier as already deleted', async () => {
    const p = await PythonTestChanges.fromSource('examples { example "one": 1 => 1 }');
    await p.generateTests(); await p.rememberAllFiles(); await p.deleteIdentifier('never-owned');
    p.expectProblem('not-found'); await p.expectAllFilesUnchanged();
  });
  it('recreates a deliberately retired scenario with its original identity', async () => {
    const p = await PythonTestChanges.fromSource('examples { example "one": 1 => 1\nexample "two": 2 => 2 }');
    await p.generateTests(); await p.deleteScenario('one'); p.expectApplied();
    await p.generateTests(); p.expectScenarioAssociated('one');
    await p.runTests(); p.expectPassed(['one', 'two']);
  });
  it('recreates an intentionally retired examples file', async () => {
    const p = await PythonTestChanges.fromSource('examples { example "one": 1 => 1 }');
    await p.generateTests(); await p.deleteOnlyExamplesGroup(); p.expectApplied(); await p.expectAcceptanceFileAbsent();
    await p.generateTests(); p.expectScenarioAssociated('one');
    await p.runTests(); p.expectPassed(['one']);
  });
  it('does not mistake an externally deleted file for an intentional retirement', async () => {
    const p = await PythonTestChanges.fromSource('examples { example "one": 1 => 1 }');
    await p.generateTests(); await p.removeAcceptanceFile(); await p.rememberAllFiles();
    await p.requestCreation(); p.expectProblem('generated-tests-changed'); await p.expectAllFilesUnchanged();
  });
  it('refuses retirement when a same-named dynamic member cannot be resolved', async () => {
    const p = await PythonTestChanges.fromSource('examples { example "one": 1 => 1 }');
    await p.generateTests(); await p.addUnresolvedCallerOfExample('one'); await p.rememberAllFiles();
    await p.deleteScenario('one'); p.expectProblem('incomplete-native-references'); await p.expectAllFilesUnchanged();
  });
  it('adds an independently executable example without changing the existing implementation', async () => {
    const p = await PythonTestChanges.shopping('Dune', 1);
    await p.generateTests(); await p.implementBasket(1); await p.rememberSharedLayers();
    p.addExample('an empty basket has no copies', 'bookQuantity("Dune") => 0');
    await p.updateTests(); p.expectApplied(); await p.expectSharedLayersUnchanged();
    await p.runTests(); p.expectPassed(['a shopper can add an available book', 'an empty basket has no copies']);
  });
  it('renames the same scenario while retaining its explanation and identity', async () => {
    const p = await PythonTestChanges.shopping('Dune', 1);
    await p.generateTests(); await p.implementBasket(1);
    await p.addScenarioComment('a shopper can add an available book', 'One available copy goes into this basket.');
    p.renameScenario('a shopper can add an available book', 'a shopper keeps one copy');
    await p.updateTests(); p.expectSameScenarioIdentity('a shopper keeps one copy');
    await p.expectScenarioComment('One available copy goes into this basket.');
    await p.runTests(); p.expectPassed(['a shopper keeps one copy']);
  });
  it('adds one explicit driver obligation without replacing an existing driver body', async () => {
    const p = await PythonTestChanges.shopping('Dune', 1);
    await p.generateTests(); await p.implementBasket(1); await p.rememberDriverBody('addBook');
    p.addOperation('observation price(title: Text) returns Number');
    p.addExample('Dune costs ten', 'price("Dune") => 10');
    await p.updateTests(); await p.expectDriverBodyUnchanged('addBook');
    await p.runTests(); p.expectUnimplemented('price');
  });
  it('removes one generated scenario and retains its sibling and shared layers', async () => {
    const p = await PythonTestChanges.fromSource('examples { example "one": 1 => 1\nexample "two": 2 => 2 }');
    await p.generateTests(); await p.rememberSharedLayers();
    await p.deleteScenario('one'); p.expectApplied(); p.expectNoScenarioAssociation('one');
    await p.expectSharedLayersUnchanged(); await p.runTests(); p.expectPassed(['two']);
    await p.deleteScenario('one'); p.expectUnchanged(); p.expectNoScenarioAssociation('one');
  });
  it('refuses to discard a handwritten scenario explanation', async () => {
    const p = await PythonTestChanges.shopping('Dune', 1); await p.generateTests();
    await p.addScenarioComment('a shopper can add an available book', 'Keep my explanation.');
    await p.rememberAllFiles(); await p.deleteScenario('a shopper can add an available book');
    p.expectProblem('handwritten-removal'); await p.expectAllFilesUnchanged();
  });
  it('removes an untouched examples file while keeping the real implementation', async () => {
    const p = await PythonTestChanges.shopping('Dune', 1);
    await p.generateTests(); await p.implementBasket(1); await p.rememberSharedLayers();
    await p.deleteOnlyExamplesGroup(); p.expectApplied(); await p.expectAcceptanceFileAbsent();
    p.expectNoScenarioAssociation('a shopper can add an available book');
    await p.expectSharedLayersUnchanged(); await p.deleteOnlyExamplesGroup(); p.expectUnchanged();
  });
  it('refuses to retire a generated test that an unmodeled native caller still uses', async () => {
    const p = await PythonTestChanges.fromSource('examples { example "one": 1 => 1 }');
    await p.generateTests(); await p.addNativeCallerOfExample('one'); await p.rememberAllFiles();
    await p.deleteScenario('one'); p.expectProblem('native-reference-conflict'); await p.expectAllFilesUnchanged();
  });
});
