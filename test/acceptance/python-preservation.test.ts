import { afterEach, describe, it } from 'vitest';
import { PythonEvolution } from '../dsl/python-preservation.js';

afterEach(() => PythonEvolution.dispose());
describe('Python contracts evolve around handwritten implementation', { timeout: 240_000 }, () => {
  it('adds a capability while retaining the existing save behavior', async () => {
    const p = await PythonEvolution.create();
    p.source('class StoreGame { public save\ncapability save(title: Text) returns Nothing }'); await p.generate();
    await p.implementSave('self.saved = title  # Keep this implementation.');
    p.change('class StoreGame { public save, reset\ncapability save(title: Text) returns Nothing\ncapability reset() returns Nothing }');
    await p.update(); p.expectApplied(); await p.expectSaveImplementationKept('self.saved = title  # Keep this implementation.');
    await p.run('from store.contracts import StoreGame\ngame = StoreGame()\ngame.save("Dune")\nprint(game.saved)\ntry:\n    game.reset()\nexcept NotImplementedError:\n    print("reset needs implementation")');
    p.expectOutput('Dune\nreset needs implementation');
  });
});
