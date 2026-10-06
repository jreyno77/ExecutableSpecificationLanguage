import { afterEach, describe, it } from 'vitest';
import { PythonDelivery } from '../../../dsl/project/python/python-output.js';
import { PythonEvolution } from '../../../dsl/project/python/python-preservation.js';

afterEach(async () => { await PythonDelivery.dispose(); await PythonEvolution.dispose(); });
describe('Python preserves authored callable obligations', { timeout: 240_000 }, () => {
  it('retains authored conditions and prose in plans, writes and documentation', async () => {
    const p = await PythonDelivery.create();
    p.source('function save(copies: Number) returns Nothing { requires copies > 0\nensures true\npromises "Saved to disk." }');
    await p.planContracts(); await p.buildContracts();
    p.expectContractObligations('plan', [
      ['verification-required', 'save', 'requires copies > 0', 'requires copies > 0'],
      ['verification-required', 'save', 'ensures true', 'ensures true'],
      ['verification-required', 'save', 'Saved to disk.', 'promises "Saved to disk."'],
    ]);
    p.expectContractObligations('write', [
      ['verification-required', 'save', 'requires copies > 0', 'requires copies > 0'],
      ['verification-required', 'save', 'ensures true', 'ensures true'],
      ['verification-required', 'save', 'Saved to disk.', 'promises "Saved to disk."'],
    ]);
    await p.expectCallableDocumentation('save', ['requires copies > 0', 'ensures true', 'Saved to disk.']);
    await p.checkConsumer('from store.contracts import save\nsave(1.0)'); p.expectNativeTypecheckPassed();
  });

  it('updates the promise while retaining handwritten docstring, comment and implementation', async () => {
    const p = await PythonEvolution.create();
    p.source('class StoreGame { public save\ncapability save(title: Text) returns Nothing { promises "Saved to disk." } }');
    await p.generate();
    await p.implementSave('"""Keep this handwritten explanation."""\n        self.saved = title  # Keep this implementation.');
    p.change('class StoreGame { public save\ncapability save(title: Text) returns Nothing { promises "Persist using Supabase." } }');
    await p.update(); p.expectApplied();
    p.expectContractObligations('write', [['verification-required', 'save', 'Persist using Supabase.', 'promises "Persist using Supabase."']]);
    await p.expectCallableDocumentation('save', ['Persist using Supabase.']);
    await p.expectSaveImplementationKept('"""Keep this handwritten explanation."""');
    await p.expectSaveImplementationKept('self.saved = title  # Keep this implementation.');
    await p.run('from store.contracts import StoreGame\ngame = StoreGame()\ngame.save("Dune")\nprint(game.saved)'); p.expectOutput('Dune');
  });

  it('does not invent an authored obligation for an ordinary fully specified callable', async () => {
    const p = await PythonDelivery.create(); p.source('function save() returns Nothing');
    await p.planContracts(); p.expectContractObligations('plan', []);
    await p.buildContracts(); p.expectContractObligations('write', []);
    await p.run('from store.contracts import save\nsave()'); p.expectRaised('NotImplementedError', 'save');
  });
});
