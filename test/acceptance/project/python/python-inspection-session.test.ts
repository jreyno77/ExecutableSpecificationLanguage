import { describe, it } from 'vitest';
import { PythonSessions } from '../../../dsl/project/python/python-inspection-session.js';

describe('an opened Python query retains only compatible answers', { timeout: 240_000 }, () => {
  it('reads and finds supplied code without repeating equivalent inspection', async () => {
    const p = await PythonSessions.connect();
    const store = '# Keep my explanation.\nclass StoreGame:\n    def save(self, title: str) -> None:\n        self.title = title\n';
    await p.file('src/store.py', store);
    await p.file('src/caller.py', 'from store import StoreGame\ndef launch(game: StoreGame) -> None:\n    game.save("Dune")\n');
    p.mapMethod('StoreGame.save', 'src/store.py', 'StoreGame', 'save'); await p.openQuery();
    await p.read('StoreGame.save'); p.expectWholeFile('src/store.py', store);
    await p.search('StoreGame.save'); p.expectDefinition('src/store.py', 'StoreGame', 'save'); p.expectOnlyIncomingStatement('game.save("Dune")');
    await p.read('StoreGame.save'); p.expectWholeFile('src/store.py', store);
    p.expectActualInspections({ base: 1 }); await p.expectKnownFilesUnchanged();
  });
  it('uses new supplied bytes despite retaining the capture and editable version', async () => {
    const p = await PythonSessions.connect();
    await p.file('src/store.py', 'class StoreGame:\n    def save(self, title: str) -> None:\n        pass\n');
    await p.file('src/caller.py', 'from store import StoreGame\ngame: StoreGame = StoreGame()\n');
    p.mapMethod('StoreGame.save', 'src/store.py', 'StoreGame', 'save'); await p.openQuery();
    await p.search('StoreGame.save'); p.expectNoIncomingUseFrom('src/caller.py'); p.rememberSearch();
    p.replaceSuppliedBytesKeepingCaptureAndVersion('src/caller.py', 'from store import StoreGame\ngame: StoreGame = StoreGame()\ngame.save("Dune")\n');
    await p.search('StoreGame.save'); p.expectOnlyIncomingStatement('game.save("Dune")');
    p.expectNoIncomingUseFrom('src/caller.py', true); p.expectSameCaptureAndVersion(); p.expectActualInspections({ base: 2 });
  });
  it('refuses its primed answer after selected native bytes change', async () => {
    const p = await PythonSessions.connect(); await p.installCatalog('class Book:\n    title: str\n');
    await p.file('src/store.py', 'from catalog import Book\nclass StoreGame:\n    def save(self, book: Book) -> None:\n        self.book = book\n');
    p.mapMethod('StoreGame.save', 'src/store.py', 'StoreGame', 'save'); await p.openQuery();
    await p.search('StoreGame.save'); p.expectCompleteObservations();
    await p.replaceCatalog('class Book:\n    title: int\n'); await p.search('StoreGame.save');
    p.expectNativeChangeRefusedAt('catalog/__init__.py'); p.expectActualInspections({ base: 1 });
  });
  it('keeps base inspection separate from generated-assertion integrity', async () => {
    const p = await PythonSessions.connect(); p.aShopperCanAddAnAvailableBook('Dune', 1);
    await p.generateTests(); await p.openScenarioOutput();
    await p.readScenario(); p.expectCompleteScenarioRead('test/acceptance/test_shopping.py');
    await p.searchScenario(); p.expectCompleteScenarioSearch(); p.expectActualInspections({ base: 1, integrity: 1 });
    await p.changeGeneratedQuantity(2); await p.readScenario();
    p.expectScenarioProblem('generated-tests-changed', 'test/acceptance/test_shopping.py'); await p.expectOnlyScenarioChanged();
  });
});