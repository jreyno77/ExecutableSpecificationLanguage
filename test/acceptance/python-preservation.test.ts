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
  it('renames the actual method uses while preserving aliases, comments and unrelated methods', async () => {
    const p = await PythonEvolution.create();
    p.source('class StoreGame { public save\ncapability save(title: Text) returns Nothing }'); await p.generate();
    await p.implementSave('self.saved = title  # Keep this implementation.');
    const launcher = '# 🛒 save stays in this comment\r\nfrom store.contracts import StoreGame as Game\r\nclass Other:\r\n    def save(self, title: str) -> str:\r\n        return title\r\ndef launch() -> None:\r\n    game: Game = Game()\r\n    callback = game.save\r\n    callback("Dune")\r\n    print(game.saved)\r\n    print(Other().save("Other"))\r\n';
    await p.file('src/launcher.py', launcher);
    p.renameCapability('save', 'saveGame', 'class StoreGame { public saveGame\ncapability saveGame(title: Text) returns Nothing }');
    await p.update(); p.expectApplied();
    await p.expectFileText('src/launcher.py', launcher.replace('callback = game.save', 'callback = game.saveGame'));
    await p.run('from launcher import launch\nlaunch()'); p.expectOutput('Dune\nOther');
  });
});
