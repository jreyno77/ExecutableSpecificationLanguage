import { afterEach, describe, it } from 'vitest';
import { PythonInspection } from '../dsl/python-project.js';

afterEach(() => PythonInspection.dispose());

describe('a Python project answers actual native questions', { timeout: 120_000 }, () => {
  it('reads the whole associated file including private state and handwritten code', async () => {
    const p = await PythonInspection.connect();
    const code = '# 🛒 keep this comment\r\nclass StoreGame:\r\n    def save(self, title: str) -> None:\r\n        self._title = title\r\n';
    await p.file('src/game.py', code); p.mapMethod('save', 'src/game.py', 'StoreGame', 'save');
    await p.read('save'); p.expectWholeFile('src/game.py', code);
  });
  it('finds the typed native caller and keeps an unrelated same-named method separate', async () => {
    const p = await PythonInspection.connect();
    await p.file('src/game.py', 'class StoreGame:\n    def save(self, title: str) -> None:\n        self._title = title\nclass Other:\n    def save(self, title: str) -> None:\n        self._title = title\n');
    await p.file('src/caller.py', 'from game import StoreGame\ndef launch(game: StoreGame) -> None:\n    game.save("Dune")\n');
    await p.file('src/other.py', 'from game import Other\ndef launch(other: Other) -> None:\n    other.save("Dune")\n');
    await p.file('notes/unselected.py', 'this is not valid Python!!!');
    p.mapMethod('save', 'src/game.py', 'StoreGame', 'save'); await p.search('save');
    p.expectIncomingUse('src/caller.py', 'save'); p.expectNoIncomingUseFrom('src/other.py');
    p.expectUnmodeledCaller('src/caller.py', 'launch');
    p.expectInspectedFiles(['src/game.py', 'src/caller.py', 'src/other.py']);
  });
});
