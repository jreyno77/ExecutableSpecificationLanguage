import { describe, it } from 'vitest';
import { PythonCallableQueries } from '../dsl/python-callables.js';

describe('public Python callable identity', { timeout: 300_000 }, () => {
it('exposes one implemented callable and refuses unfamiliar decoration in public lookup', async () => {
  const p = await PythonCallableQueries.connect();
  const source = 'from typing import overload\nclass StoreGame:\n    @overload\n    def save(self, title: str) -> str: ...\n    @overload\n    def save(self, title: int) -> str: ...\n    def save(self, title: str | int) -> str:\n        return str(title)\n';
  await p.file('src/store.py', source);
  await p.file('src/caller.py', 'from store import StoreGame\ngame = StoreGame()\ngame.save("Dune")\ngame.save(7)\n');
  p.mapMethod('StoreGame.save', 'src/store.py', 'StoreGame', 'save');

  await p.read('StoreGame.save'); p.expectReadFiles({ 'src/store.py': source });
  await p.search('StoreGame.save');
  p.expectDefinition('src/store.py', 'StoreGame', 'save');
  p.expectIncomingStatements(['game.save("Dune")', 'game.save(7)']); p.expectComplete();

  await p.file('src/store.py', 'def decorate(fn):\n    return fn\nclass StoreGame:\n    @decorate\n    def save(self, title: str | int) -> str:\n        return str(title)\n');
  await p.search('StoreGame.save'); p.expectLookupLimited('src/store.py', 'decorate');
});
});
