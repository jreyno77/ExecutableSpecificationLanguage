import { afterEach, describe, it } from 'vitest';
import { PythonContractChanges } from '../../../dsl/project/python/python-contract-changes.js';

afterEach(() => PythonContractChanges.dispose(), 30_000);
describe('evolving complete Python contracts', { timeout: 240_000 }, () => {
  it('requires update when recreating a deleted contract whose promise changed', async () => {
    const p = await PythonContractChanges.fromSource('class StoreGame {}\nclass Receipt { public save\ncapability save() returns Nothing { promises "Saved to disk" } }');
    await p.generate(); await p.deleteClass('Receipt'); p.expectApplied();
    p.revise('class StoreGame {}\nclass Receipt { public save\ncapability save() returns Nothing { promises "Saved to a database" } }');
    await p.rememberFiles(); await p.requestCreation(); p.expectProblem('use-update'); await p.expectFilesUnchanged();
  });
  it('requires update when a retained promise changes without changing the native signature', async () => {
    const p = await PythonContractChanges.fromSource('class StoreGame { public save\ncapability save(title: Text) returns Nothing { promises "Saved to disk" } }');
    await p.generate();
    p.revise('class StoreGame { public save\ncapability save(title: Text) returns Nothing { promises "Saved to a database" } }');
    await p.rememberFiles(); await p.requestCreation(); p.expectProblem('use-update'); await p.expectFilesUnchanged();
  });
  it('checks its own rendered view when insertion follows a skipped contract change', async () => {
    const p = await PythonContractChanges.fromSource('class StoreGame { public save\ncapability save(title: Text) returns Nothing { promises "Saved to disk" } }');
    await p.generate();
    p.revise('class StoreGame { public save\ncapability save(title: Text) returns Nothing { promises "Saved to a database" } }');
    p.skipOutput(); await p.rememberFiles();
    await p.insert(); p.expectProblem('not-addition-only'); await p.expectFilesUnchanged();
  });
  it('adds an independent class while retaining the existing application', async () => {
    const p = await PythonContractChanges.fromSource('class StoreGame { public save\ncapability save(title: Text) returns Nothing }');
    await p.generate(); await p.implementSave('self.saved = title');
    p.revise('class StoreGame { public save\ncapability save(title: Text) returns Nothing }\nclass Receipt {}');
    await p.insert(); p.expectApplied(); await p.expectSaveBody('self.saved = title');
    await p.run('from store.contracts import StoreGame, Receipt\ngame = StoreGame()\ngame.save("Dune")\nprint(game.saved)\nprint(type(Receipt()).__name__)');
    p.expectOutput('Dune\nReceipt');
  });
  it('renames the identified class while retaining an imported alias and real behavior', async () => {
    const p = await PythonContractChanges.fromSource('class StoreGame { public save\ncapability save(title: Text) returns Nothing }');
    await p.generate(); await p.implementSave('self.saved = title');
    await p.addAliasedCaller('StoreGame', 'Game');
    p.renameClass('StoreGame', 'StoreFront', 'class StoreFront { public save\ncapability save(title: Text) returns Nothing }');
    await p.update(); p.expectApplied(); p.expectSameClassIdentity('StoreFront');
    await p.expectAliasedCaller('StoreFront', 'Game'); await p.expectSaveBody('self.saved = title');
    await p.runAliasedCaller('Dune'); p.expectOutput('Dune');
  });
  it('deletes an unused generated class without removing its sibling or handwritten neighbor', async () => {
    const p = await PythonContractChanges.fromSource('class StoreGame {}\nclass Receipt {}');
    await p.generate(); await p.addNeighbor('Keep this independent function.');
    await p.deleteClass('Receipt'); p.expectApplied(); p.expectNoAssociation('Receipt');
    await p.expectClassAbsent('Receipt'); await p.expectClassPresent('StoreGame');
    await p.expectNeighbor('Keep this independent function.');
    await p.deleteClass('Receipt'); p.expectUnchanged();
    await p.generate(); p.expectOriginalClassIdentity('Receipt'); await p.expectClassPresent('Receipt');
  });
  it('refuses to delete an implemented class', async () => {
    const p = await PythonContractChanges.fromSource('class StoreGame { public save\ncapability save(title: Text) returns Nothing }');
    await p.generate(); await p.implementSave('self.saved = title'); await p.rememberFiles();
    await p.deleteClass('StoreGame'); p.expectProblem('output-conflict'); await p.expectFilesUnchanged();
  });
  it('refuses class deletion while an unmodeled caller uses a member', async () => {
    const p = await PythonContractChanges.fromSource('class StoreGame { public save\ncapability save(title: Text) returns Nothing }');
    await p.generate(); await p.addMemberCaller('StoreGame', 'save'); await p.rememberFiles();
    await p.deleteClass('StoreGame'); p.expectProblem('native-reference-conflict');
    await p.expectProblemAt('native-reference-conflict', 'src/launcher.py', 'save'); await p.expectFilesUnchanged();
  });
  it('distinguishes an unknown contract identity from a completed deletion', async () => {
    const p = await PythonContractChanges.fromSource('class StoreGame {}');
    await p.generate(); await p.rememberFiles(); await p.deleteIdentifier('never-owned');
    p.expectProblem('not-found'); await p.expectFilesUnchanged();
  });
});
