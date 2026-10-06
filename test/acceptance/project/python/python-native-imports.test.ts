import { afterEach, describe, it } from 'vitest';
import { PythonNativeImports } from '../../../dsl/project/python/python-native-imports.js';

afterEach(() => PythonNativeImports.dispose());
describe('Python contract imports require actual native type evidence', { timeout: 240_000 }, () => {
  it('refuses a provided native import whose member is unavailable', async () => {
    const p = await PythonNativeImports.create();
    p.source('opaque type URL\nfunction open(url: URL) returns Nothing');
    p.mapNativeImport('URL', 'urllib.parse', 'DefinitelyMissing');
    await p.rememberProject(); await p.planContracts(); await p.buildContracts();
    p.expectPlanRefused('unresolved-python-import', 'src/store/contracts.py');
    p.expectWriteRefused('unresolved-python-import', 'src/store/contracts.py');
    await p.expectProjectUnchanged();
  });

  it('accepts the same available native import and retains its actual identity', async () => {
    const p = await PythonNativeImports.create();
    p.source('opaque type URL\nfunction open(url: URL) returns Nothing');
    p.mapNativeImport('URL', 'urllib.parse', 'ParseResult');
    await p.planContracts(); p.expectPlanAccepted();
    await p.buildContracts(); p.expectApplied();
    await p.checkConsumer('from store.contracts import open\nfrom urllib.parse import urlparse\nopen(urlparse("https://example.com"))');
    await p.run('import store.contracts as contracts\nfrom urllib.parse import ParseResult\nprint(contracts.ParseResult is ParseResult)');
    p.expectOutput('True');
  });

  it('refuses a present native type that cannot accept the declared generic argument', async () => {
    const p = await PythonNativeImports.create();
    p.source('opaque type URL<T>\nfunction open(url: URL<Text>) returns Nothing');
    p.mapNativeImport('URL', 'urllib.parse', 'ParseResult');
    await p.rememberProject(); await p.planContracts(); await p.buildContracts();
    p.expectPlanRefused('incompatible-native-import', 'src/store/contracts.py', 'ParseResult');
    p.expectWriteRefused('incompatible-native-import', 'src/store/contracts.py', 'ParseResult');
    await p.expectProjectUnchanged();
  });

  it('checks an unused mapped declaration before promising its generic arity', async () => {
    const p = await PythonNativeImports.create();
    p.source('opaque type URL<T>');
    p.mapNativeImport('URL', 'urllib.parse', 'ParseResult');
    await p.rememberProject(); await p.planContracts(); await p.buildContracts();
    p.expectPlanRefused('incompatible-native-import', 'src/store/contracts.py', 'ParseResult');
    p.expectWriteRefused('incompatible-native-import', 'src/store/contracts.py', 'ParseResult');
    await p.expectProjectUnchanged();
  });

  it('accepts the actual generic native declaration even before a callable uses it', async () => {
    const p = await PythonNativeImports.create();
    p.source('opaque type Titles<T>');
    p.mapNativeImport('Titles', 'collections.abc', 'Sequence');
    await p.planContracts(); p.expectPlanAccepted();
    await p.buildContracts(); p.expectApplied();
    await p.checkConsumer('from collections.abc import Sequence\ntitles: Sequence[str] = ["Dune"]');
    await p.run('import store.contracts as contracts\nfrom collections.abc import Sequence\nprint(contracts.Sequence is Sequence)');
    p.expectOutput('True');
  });

  it('does not treat an omitted required native type argument as a nongeneric mapping', async () => {
    const p = await PythonNativeImports.create();
    p.source('opaque type Titles');
    p.mapNativeImport('Titles', 'collections.abc', 'Sequence');
    await p.rememberProject(); await p.planContracts(); await p.buildContracts();
    p.expectPlanRefused('incompatible-native-import', 'src/store/contracts.py', 'Sequence');
    p.expectWriteRefused('incompatible-native-import', 'src/store/contracts.py', 'Sequence');
    await p.expectProjectUnchanged();
  });
});
