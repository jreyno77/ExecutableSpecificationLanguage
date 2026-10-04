import { describe, it } from 'vitest';
import { PythonNativeLookup } from '../dsl/python-callables.js';

describe('native Python callable identity and coverage', { timeout: 45_000 }, () => {
it('reports an unfamiliar method decorator without executing it', async () => {
  const n = await PythonNativeLookup.fromFiles({
    'src/store.py': 'def decorate(fn):\n    raise RuntimeError("inspection executed application decorator")\nclass StoreGame:\n    @decorate\n    def save(self, title: str) -> None:\n        pass\n',
    'src/caller.py': 'from store import StoreGame\ndef launch(game: StoreGame) -> None:\n    game.save("Dune")\n',
  });
  await n.inspect();
  n.expectLookupLimitation('src/store.py', 'decorate', { line: 4 });
  n.expectNoApplicationException('inspection executed application decorator');
});

it('does not treat a same-spelled application decorator as a builtin', async () => {
  const n = await PythonNativeLookup.fromFiles({
    'src/store.py': 'def staticmethod(fn):\n    return fn\nclass StoreGame:\n    @staticmethod\n    def save(self, title: str) -> None:\n        pass\n',
  });
  await n.inspect();
  n.expectLookupLimitation('src/store.py', 'staticmethod', { line: 4 });
});

it('uses actual builtin static, class and property decorator identities', async () => {
  const n = await PythonNativeLookup.fromFiles({
    'src/store.py': 'from builtins import staticmethod as static\nclass StoreGame:\n    @static\n    def title() -> str:\n        return "Dune"\n    @classmethod\n    def create(cls) -> "StoreGame":\n        return cls()\n    @property\n    def copies(self) -> int:\n        return 1\n',
    'src/caller.py': 'from store import StoreGame\ngame = StoreGame.create()\nprint(StoreGame.title())\nprint(game.copies)\n',
  });
  await n.inspect();
  n.expectNoLookupProblems();
  n.expectUseTarget('src/caller.py', 'create', { line: 2 }, 'src/store.py', 'create', { line: 7 });
  n.expectUseTarget('src/caller.py', 'title', { line: 3 }, 'src/store.py', 'title', { line: 4 });
  n.expectUseTarget('src/caller.py', 'copies', { line: 4 }, 'src/store.py', 'copies', { line: 10 });
});

it('selects the single concrete overload implementation and its own parameters', async () => {
  const n = await PythonNativeLookup.fromFiles({
    'src/store.py': 'from typing import overload as signature\nclass StoreGame:\n    @signature\n    def save(self, title: str) -> str: ...\n    @signature\n    def save(self, title: int) -> str: ...\n    def save(self, title: str | int) -> str:\n        return str(title)\n',
    'src/caller.py': 'from store import StoreGame\ngame = StoreGame()\ngame.save("Dune")\ngame.save(7)\n',
  });
  await n.inspect();
  n.expectNoLookupProblems();
  n.expectMethodDeclarations('src/store.py', ['StoreGame', 'save'], [{ line: 7, token: 'save' }]);
  n.expectParameterDeclarations('src/store.py', ['StoreGame', 'save', 'title'], [{ line: 7, token: 'title' }]);
  n.expectUseTargets('src/caller.py', 'save', [{ line: 3 }, { line: 4 }], 'src/store.py', 'save', { line: 7 });
});

it('does not certify overload wrappers without a concrete implementation', async () => {
  const n = await PythonNativeLookup.fromFiles({
    'src/store.py': 'from typing import overload\nclass StoreGame:\n    @overload\n    def save(self, title: str) -> str: ...\n    @overload\n    def save(self, title: int) -> str: ...\n',
    'src/caller.py': 'from store import StoreGame\ndef launch(game: StoreGame) -> str:\n    return game.save("Dune")\n',
  });
  await n.inspect();
  n.expectLookupLimitation('src/store.py', 'save', { lines: [4, 6] });
});

it('does not choose among multiple concrete definitions of an overload family', async () => {
  const n = await PythonNativeLookup.fromFiles({
    'src/store.py': 'from typing import overload\nclass StoreGame:\n    @overload\n    def save(self, title: str) -> str: ...\n    @overload\n    def save(self, title: int) -> str: ...\n    def save(self, title: str | int) -> str:\n        return str(title)\n    def save(self, title: str | int) -> str:\n        return "Other"\n',
    'src/caller.py': 'from store import StoreGame\ngame = StoreGame()\ngame.save("Dune")\n',
  });
  await n.inspect();
  n.expectLookupLimitation('src/store.py', 'save', { lines: [7, 9] });
});

it('does not certify an implementation overwritten by later overload stubs', async () => {
  const n = await PythonNativeLookup.fromFiles({
    'src/store.py': 'from typing import overload\nclass StoreGame:\n    def save(self, title: str | int) -> str:\n        return str(title)\n    @overload\n    def save(self, title: str) -> str: ...\n    @overload\n    def save(self, title: int) -> str: ...\n',
    'src/caller.py': 'from store import StoreGame\ngame = StoreGame()\ngame.save("Dune")\n',
  });
  await n.inspect();
  n.expectLookupLimitation('src/store.py', 'save', { lines: [3, 6, 8] });
});

it('limits lookup when a resolved class alias replaces a method', async () => {
  const n = await PythonNativeLookup.fromFiles({
    'src/store.py': 'class StoreGame:\n    def save(self, title: str) -> None:\n        pass\ndef replacement(self, title: str) -> None:\n    raise RuntimeError("replacement must not execute")\nAlias = StoreGame\nAlias.save = replacement\n',
    'src/caller.py': 'from store import StoreGame\ndef launch(game: StoreGame) -> None:\n    game.save("Dune")\n',
  });
  await n.inspect();
  n.expectLookupLimitation('src/store.py', 'save', { line: 7 });
  n.expectNoApplicationException('replacement must not execute');
});

it('limits lookup when an instance replaces its known method', async () => {
  const n = await PythonNativeLookup.fromFiles({
    'src/store.py': 'class StoreGame:\n    def save(self, title: str) -> None:\n        pass\ndef replacement(title: str) -> None:\n    pass\ngame = StoreGame()\ngame.save = replacement\ngame.save("Dune")\n',
  });
  await n.inspect();
  n.expectLookupLimitation('src/store.py', 'save', { line: 7 });
});

it('limits an unfamiliar decorator on a module function without executing it', async () => {
  const n = await PythonNativeLookup.fromFiles({
    'src/store.py': 'def decorate(fn):\n    raise RuntimeError("module decorator must not execute")\n@decorate\ndef save(title: str) -> str:\n    return title\n',
    'src/caller.py': 'from store import save\nsave("Dune")\n',
  });
  await n.inspect();
  n.expectLookupLimitation('src/store.py', 'decorate', { line: 3 });
  n.expectNoApplicationException('module decorator must not execute');
});

it('limits an unfamiliar class decorator affecting the selected receiver', async () => {
  const n = await PythonNativeLookup.fromFiles({
    'src/store.py': 'def decorate(cls):\n    raise RuntimeError("class decorator must not execute")\n@decorate\nclass StoreGame:\n    def save(self, title: str) -> str:\n        return title\n',
    'src/caller.py': 'from store import StoreGame\ndef launch(game: StoreGame) -> str:\n    return game.save("Dune")\n',
  });
  await n.inspect();
  n.expectLookupLimitation('src/store.py', 'decorate', { line: 3 });
  n.expectNoApplicationException('class decorator must not execute');
});

it('limits a method replacement inside a destructured assignment target', async () => {
  const n = await PythonNativeLookup.fromFiles({
    'src/store.py': 'class StoreGame:\n    def save(self, title: str) -> None:\n        pass\ndef replacement(self, title: str) -> None:\n    pass\nAlias = StoreGame\n(Alias.save, other) = (replacement, 1)\n',
    'src/caller.py': 'from store import StoreGame\ndef launch(game: StoreGame) -> None:\n    game.save("Dune")\n',
  });
  await n.inspect();
  n.expectLookupLimitation('src/store.py', 'save', { line: 7 });
});

it('recognizes the actual native pytest fixture decorator through an alias', async () => {
  const n = await PythonNativeLookup.fromFiles({
    'src/fixtures.py': 'from pytest import fixture as native_fixture\n@native_fixture\ndef shopping() -> object:\n    raise RuntimeError("inspection must not acquire a fixture")\n',
  });
  await n.inspect();
  n.expectNoLookupProblems();
  n.expectNoApplicationException('inspection must not acquire a fixture');
});

it('retains ordinary mutable application fields', async () => {
  const n = await PythonNativeLookup.fromFiles({
    'src/store.py': 'class StoreGame:\n    def save(self, title: str) -> None:\n        self.title = title\n',
    'src/caller.py': 'from store import StoreGame\ngame = StoreGame()\ngame.save("Dune")\n',
  });
  await n.inspect();
  n.expectNoLookupProblems();
  n.expectUseTarget('src/caller.py', 'save', { line: 3 }, 'src/store.py', 'save', { line: 2 });
});
});
