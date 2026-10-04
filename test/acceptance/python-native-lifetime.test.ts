import { afterEach, describe, it } from 'vitest';
import { PythonNativeLifetime } from '../dsl/python-native-lifetime.js';

afterEach(() => PythonNativeLifetime.dispose());
describe('Python native evidence belongs to the actual query and write', { timeout: 240_000 }, () => {
  it('rejects changed selected environment bytes before a planned rename', async () => {
    const p = await PythonNativeLifetime.connect(); await p.installCatalog(); await p.planRename();
    await p.replaceCatalog(); await p.applyPlan();
    await p.expectStoppedWithoutEffects();
  });
  it('refuses an old capture after its selected catalog changes', async () => {
    const p = await PythonNativeLifetime.connect(); await p.installCatalog(); await p.capture();
    await p.replaceCatalog(); await p.searchCaptured('StoreGame');
    p.expectChangedCatalogRefused();
  });
  it('discards the actual native answer when its selected catalog changes during analysis', async () => {
    const p = await PythonNativeLifetime.connect(); await p.installCatalog(); await p.capture();
    await p.searchWhileCatalogChanges();
    await p.expectActualQueryFinished(); p.expectChangedCatalogRefused();
  });
  it('analyzes supplied editable bytes even when the caller retains the snapshot and version', async () => {
    const p = await PythonNativeLifetime.connect(); await p.generatedStore(); await p.capture();
    await p.searchGeneratedSave(); p.expectCoverageComplete(); p.expectNoIncomingCaller();
    p.supplySameCapture('from store.contracts import StoreGame, Snapshot\ngame: StoreGame = StoreGame()\ndef launch(snapshot: Snapshot) -> None:\n    game.save(snapshot)\n');
    await p.searchGeneratedSave(); p.expectCurrentCaller('save');
  });
  it('does not execute application or startup hooks or launch nested Python during a native query', async () => {
    const p = await PythonNativeLifetime.connect(); await p.installExecutionCanaries(); await p.capture();
    await p.inspectWithProcessObservation();
    await p.expectNoExecution();
  });
});
