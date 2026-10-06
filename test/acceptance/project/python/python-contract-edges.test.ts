import { afterEach, describe, it } from 'vitest';
import { PythonContractEdges } from '../../../dsl/project/python/python-contract-edges.js';

afterEach(() => PythonContractEdges.dispose(), 30_000);
describe('Python contracts retain explicit names, identities and native limitations', { timeout: 240_000 }, () => {
  it('requires explicit readable names and actual opaque imports', async () => {
    const p = await PythonContractEdges.create();
    p.source('opaque type URL\nclass `Store Game` {}');
    await p.rememberProject(); await p.buildContracts();
    p.expectMissingMappings(['URL', 'Store Game']); await p.expectProjectUnchanged();
    p.mapURLToParseResult(); p.name('Store Game', 'StoreGame');
    await p.buildContracts(); p.expectApplied();
    await p.run('import store.contracts as contracts\nfrom urllib.parse import ParseResult\nprint(contracts.StoreGame.__name__)\nprint(contracts.ParseResult is ParseResult)\nprint(hasattr(contracts, "URL"))');
    p.expectOutput('StoreGame\nTrue\nFalse');
  });

  it('reports a manual signature conflict rather than accepting a new generated baseline', async () => {
    const p = await PythonContractEdges.create();
    p.source('type Snapshot { title: Text }\nclass StoreGame { public save\ncapability save(snapshot: Snapshot) returns Nothing }');
    await p.buildContracts(); p.expectApplied();
    await p.changeNativeParameter('snapshot: Snapshot', 'snapshot: bytes'); await p.rememberProject();
    p.change('type Snapshot { title: Text }\nclass StoreGame { public save\ncapability save(snapshot: Text) returns Nothing }');
    await p.updateContracts(); p.expectSignatureConflict('src/store/contracts.py'); await p.expectProjectUnchanged();
  });

  it('repeats a build without edits or identity drift', async () => {
    const p = await PythonContractEdges.create();
    p.source('class StoreGame { public save\ncapability save(title: Text) returns Nothing }');
    await p.buildContracts(); p.expectApplied(); await p.rememberProject();
    await p.buildContracts(); p.expectNoAppliedPaths(); p.expectIdentityUnchanged(); await p.expectProjectUnchanged();
  });

  it('uses aliases and generic records through native declarations and consumers', async () => {
    const p = await PythonContractEdges.create();
    p.source('type Pair<T> = [T, T]\ntype Envelope<T> { value: T }');
    await p.buildContracts(); p.expectApplied();
    await p.checkConsumer('from store.contracts import Pair, Envelope\npair: Pair[float] = (1.0, 2.0)\nenvelope: Envelope[str] = {"value": "Dune"}\n');
    await p.search('Pair'); p.expectNativeUse('src/consumer.py', 'Pair[float]', 'Pair');
    await p.search('Envelope'); p.expectNativeUse('src/consumer.py', 'Envelope[str]', 'Envelope');
  });

  it('reports an analyzer limitation for a valid newer Python alias without rewriting it', async () => {
    const p = await PythonContractEdges.create();
    p.source('class StoreGame {}'); await p.buildContracts(); p.expectApplied();
    await p.file('src/pair.py', '# 🧺 A user-authored alias.\r\n\r\ntype Pair[T] = tuple[T, T]\r\n'); await p.expectValidPython('src/pair.py');
    await p.search('StoreGame'); p.expectAnalyzerLimitation('src/pair.py', 'type Pair');
    await p.expectFileText('src/pair.py', '# 🧺 A user-authored alias.\r\n\r\ntype Pair[T] = tuple[T, T]\r\n');
  });
});
