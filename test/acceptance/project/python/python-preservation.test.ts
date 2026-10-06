import { afterEach, describe, it } from 'vitest';
import { PythonEvolution } from '../../../dsl/project/python/python-preservation.js';

afterEach(() => PythonEvolution.dispose());
describe('Python contracts evolve around handwritten implementation', { timeout: 240_000 }, () => {
  it('keeps an implemented default unverified without claiming it is missing', async () => {
    const p = await PythonEvolution.create();
    const source = 'class StoreGame { public save\ncapability save(title: Text = "Dune") returns Nothing }';
    p.source(source); await p.generate();
    await p.implementSave('self.saved = title'); await p.implementTitleDefault('Dune');
    p.change(source); await p.update(); p.expectDefaultUnverified('title', '"Dune"');
    await p.run('from store.contracts import StoreGame\ngame = StoreGame()\ngame.save()\nprint(game.saved)');
    p.expectOutput('Dune');
  });

  it('refuses a module-value move that would capture a local receiver', async () => {
    const p = await PythonEvolution.create();
    p.source('class StoreGame {}'); await p.generate();
    await p.file('src/launcher.py', 'import store.contracts\nclass Decoy:\n    class api:\n        pass\ndef module_value(destination: Decoy):\n    return store.contracts\n');
    p.relocate('destination.api'); await p.update(); p.expectRefused('native-binding-conflict');
    await p.expectFileAbsent('src/destination/api.py'); await p.expectFilePresent('src/store/contracts.py');
  });
  it('refuses a module move that would capture a local receiver', async () => {
    const p = await PythonEvolution.create();
    p.source('class StoreGame {}'); await p.generate();
    await p.file('src/launcher.py', 'import store.contracts\nclass Decoy:\n    class api:\n        class StoreGame:\n            pass\ndef start(destination: Decoy):\n    return store.contracts.StoreGame()\n');
    p.relocate('destination.api'); await p.update(); p.expectRefused('native-binding-conflict');
    await p.expectFileAbsent('src/destination/api.py'); await p.expectFilePresent('src/store/contracts.py');
  });
  it('moves a purely generated module and updates its actual native consumer', async () => {
    const p = await PythonEvolution.create();
    p.source('class StoreGame { public save\ncapability save(title: Text) returns Nothing }'); await p.generate();
    const launcher = '# Keep this import alias and comment.\nfrom store.contracts import StoreGame as Game\ndef start() -> Game:\n    return Game()\n';
    await p.file('src/launcher.py', launcher);
    p.relocate('store.api'); await p.update(); p.expectApplied();
    await p.expectFileAbsent('src/store/contracts.py'); await p.expectFileText('src/launcher.py', launcher.replace('store.contracts', 'store.api'));
    p.expectDefinitionFiles(['src/store/api.py']);
    await p.checkConsumer('from launcher import start\nfrom store.api import StoreGame\ngame: StoreGame = start()');
    await p.run('from launcher import start\ntry:\n    start().save("Dune")\nexcept NotImplementedError:\n    print("save needs implementation")'); p.expectOutput('save needs implementation');
  });
  it('refuses a module move that would relocate handwritten implementation', async () => {
    const p = await PythonEvolution.create();
    p.source('class StoreGame { public save\ncapability save(title: Text) returns Nothing }'); await p.generate();
    await p.implementSave('self.saved = title  # Keep this implementation.');
    p.relocate('store.api'); await p.update(); p.expectRefused('output-conflict');
    await p.expectFileAbsent('src/store/api.py'); await p.expectSaveImplementationKept('self.saved = title  # Keep this implementation.');
  });
  it('retires an unused generated capability and retains the implemented save capability', async () => {
    const p = await PythonEvolution.create();
    p.source('class StoreGame { public save, unused\ncapability save(title: Text) returns Nothing\ncapability unused() returns Nothing }'); await p.generate();
    await p.implementSave('self.saved = title  # Keep this implementation.');
    p.retireCapability('unused', 'class StoreGame { public save\ncapability save(title: Text) returns Nothing }');
    await p.update(); p.expectApplied();
    await p.run('from store.contracts import StoreGame\ngame = StoreGame()\ngame.save("Dune")\nprint(game.saved)\nprint(hasattr(game, "unused"))'); p.expectOutput('Dune\nFalse');
    p.retireCapability('save', 'class StoreGame {}'); await p.update(); p.expectRefused('output-conflict');
    await p.expectSaveImplementationKept('self.saved = title  # Keep this implementation.');
  });
  it('adopts the explicitly mapped shared file without changing its implementation or neighbors', async () => {
    const p = await PythonEvolution.create();
    p.source('class StoreGame { public save\ncapability save(title: Text) returns Nothing }');
    const existing = '# Keep the handwritten module.\nclass Other:\n    title = "Other"\n\nclass StoreGame:\n    def save(self, title: str) -> None:\n        self.saved = title  # Existing behavior.\n';
    await p.file('src/store/game.py', existing); await p.adoptStoreFile('src/store/game.py');
    p.expectDefinitionFiles(['src/store/game.py']);
    await p.expectFileText('src/store/game.py', existing);
    p.change('class StoreGame { public save, reset\ncapability save(title: Text) returns Nothing\ncapability reset() returns Nothing }');
    await p.update(); p.expectApplied();
    await p.run('from store.game import StoreGame, Other\ngame = StoreGame()\ngame.save("Dune")\nprint(game.saved)\nprint(Other.title)\ntry:\n    game.reset()\nexcept NotImplementedError:\n    print("reset needs implementation")');
    p.expectOutput('Dune\nOther\nreset needs implementation');
  });
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
  it('changes the declared input type and leaves the existing default and body for the author', async () => {
    const p = await PythonEvolution.create();
    p.source('class StoreGame { public save\ncapability save(title: Text = "Dune") returns Nothing }'); await p.generate();
    await p.implementSave('self.saved = title  # Keep this implementation.'); await p.implementTitleDefault('Dune');
    p.change('class StoreGame { public save\ncapability save(title: Number = 1) returns Nothing }');
    await p.update(); p.expectApplied(); await p.expectSaveParameter('title: float | Absent = choose_title()');
    await p.expectSaveImplementationKept('self.saved = title  # Keep this implementation.');
    await p.run('from store.contracts import StoreGame\ngame = StoreGame()\ngame.save()\nprint(game.saved)'); p.expectOutput('Dune');
  });
});
