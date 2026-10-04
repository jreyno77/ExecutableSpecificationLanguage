import { describe, it } from 'vitest';
import { PythonQueries } from '../dsl/python-query.js';

describe('current Python declarations and their actual consumers', { timeout: 120_000 }, () => {
  it('reads every associated file with handwritten bodies and fresh changes', async () => {
    const p = await PythonQueries.connect();
    const game = 'from store.state import Snapshot\n# Keep the handwritten state.\nclass StoreGame:\n    def save(self, snapshot: Snapshot) -> None:\n        self._snapshot = snapshot\n';
    const state = 'class Snapshot:\n    title: str\n    def copy(self) -> "Snapshot":\n        return self\n';
    await p.file('src/store/__init__.py', ''); await p.file('src/store/game.py', game); await p.file('src/store/state.py', state);
    p.mapClass('StoreGame', 'src/store/game.py', 'StoreGame'); p.mapClass('StoreGame', 'src/store/state.py', 'Snapshot');
    await p.read('StoreGame'); p.expectReadFiles({ 'src/store/game.py': game, 'src/store/state.py': state }); p.rememberRead();
    await p.replaceInFile('src/store/game.py', 'self._snapshot = snapshot', 'self._snapshot = snapshot.copy()');
    await p.read('StoreGame');
    p.expectReadFiles({ 'src/store/game.py': game.replace('self._snapshot = snapshot', 'self._snapshot = snapshot.copy()'), 'src/store/state.py': state });
    p.expectReadFiles({ 'src/store/game.py': game, 'src/store/state.py': state }, true);
  });

  it('finds all typed consumers beyond a capped project-reference search', async () => {
    const p = await PythonQueries.connect(); await p.typedConsumers(42);
    await p.search('StoreGame.save');
    p.expectIncomingCallers(42, ['src/alias.py', 'src/reexport_caller.py']);
  });

  it('keeps an override distinct from the inherited declaration', async () => {
    const p = await PythonQueries.connect();
    await p.file('src/store.py', 'class StoreGame:\n    def save(self, snapshot: str) -> None:\n        pass\nclass Child(StoreGame):\n    def save(self, snapshot: str) -> None:\n        pass\nclass Inherited(StoreGame):\n    pass\n');
    await p.file('src/caller.py', 'from store import StoreGame, Child, Inherited\ndef use(child: Child, base: StoreGame, inherited: Inherited) -> None:\n    child.save("Dune")\n    base.save("Other")\n    inherited.save("Other")\n');
    p.mapMethod('Child.save', 'src/store.py', 'Child', 'save'); await p.search('Child.save');
    p.expectDefinition('src/store.py', 'Child', 'save'); p.expectOnlyIncomingStatement('child.save("Dune")');
  });

  it('limits native relationships when a custom hook controls member lookup', async () => {
    const p = await PythonQueries.connect();
    await p.file('src/store.py', 'class StoreGame:\n    def save(self, snapshot: str) -> None:\n        pass\n    def __getattribute__(self, name: str) -> object:\n        return object.__getattribute__(self, name)\n');
    await p.file('src/caller.py', 'from store import StoreGame\ndef launch(game: StoreGame) -> None:\n    game.save("Dune")\n');
    p.mapMethod('StoreGame.save', 'src/store.py', 'StoreGame', 'save'); await p.search('StoreGame.save');
    p.expectLookupLimited('src/store.py', '__getattribute__');
  });
  it('reports actual outgoing dependencies absent from the specification', async () => {
    const p = await PythonQueries.connect();
    p.source('concept a {}\nconcept b {}\nconcept c {}\nconcept StoreGame { depends on a, b, c }');
    await p.file('src/dependencies.py', 'class a: pass\nclass b: pass\nclass c: pass\nclass d: pass\n');
    await p.file('src/store.py', 'from dependencies import a, b, d\nclass StoreGame:\n    def start(self) -> None:\n        a()\n        b()\n        d()\n');
    p.mapDeclaredClass('a', 'src/dependencies.py'); p.mapDeclaredClass('b', 'src/dependencies.py'); p.mapDeclaredClass('c', 'src/dependencies.py');
    p.mapDeclaredClass('StoreGame', 'src/store.py'); await p.searchDeclared('StoreGame'); p.compareDependencies(['a', 'b', 'c']);
    p.expectDependencyComparison({ matched: ['a', 'b'], missing: ['c'], unexpected: ['d'] });
  });

  it('returns original CRLF and non-BMP locations without rewriting comments', async () => {
    const p = await PythonQueries.connect();
    p.source('class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing }');
    const store = '# 🛒 save stays in this comment\r\nclass StoreGame:\r\n    def save(self, snapshot: str) -> None:\r\n        self._snapshot = snapshot\r\n';
    const caller = 'from store import StoreGame\r\ngame = StoreGame()\r\nnote = "🛒";      game.save("Dune") # save stays in this comment\r\n';
    await p.file('src/store.py', store); await p.file('src/caller.py', caller); await p.adoptStore('src/store.py');
    p.mapMethod('StoreGame.save', 'src/store.py', 'StoreGame', 'save'); await p.search('StoreGame.save');
    p.expectUseTextAt('save', { file: 'src/caller.py', line: 3, utf16Column: 24 });
    await p.renameSave();
    await p.expectFile('src/store.py', store.replace('def save(', 'def saveGame('));
    await p.expectFile('src/caller.py', caller.replace('game.save(', 'game.saveGame('));
  });
});

