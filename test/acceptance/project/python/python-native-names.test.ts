import { afterEach, describe, it } from 'vitest';
import { PythonDelivery } from '../../../dsl/project/python/python-output.js';

afterEach(() => PythonDelivery.dispose(), 30_000);
describe('Python names belong to their native lexical scope', { timeout: 30_000 }, () => {
  it('refuses a capability that replaces declared construction', async () => {
    const p = await PythonDelivery.create();
    p.source('class StoreGame { construction(title: Text)\npublic __init__\ncapability __init__(copies: Number) returns Nothing }');
    await p.rememberProject(); await p.planContracts();
    p.expectNameConflict('plan', 'capability __init__');
    await p.buildContracts(); p.expectNameConflict('write', 'capability __init__');
    await p.expectProjectUnchanged();
  });

  it('refuses two parameters mapped into one argument name', async () => {
    const p = await PythonDelivery.create();
    p.source('function save(title: Text, copies: Number) returns Nothing');
    p.mapNames({ title: 'same', copies: 'same' });
    await p.rememberProject(); await p.planContracts();
    p.expectNameConflict('plan', 'copies: Number');
    await p.buildContracts(); p.expectNameConflict('write', 'copies: Number');
    await p.expectProjectUnchanged();
  });

  it('refuses two capabilities mapped into one method name', async () => {
    const p = await PythonDelivery.create();
    p.source('class StoreGame { public save, reset\ncapability save() returns Nothing\ncapability reset() returns Nothing }');
    p.mapNames({ save: 'same', reset: 'same' });
    await p.rememberProject(); await p.planContracts();
    p.expectNameConflict('plan', 'capability reset');
    await p.buildContracts(); p.expectNameConflict('write', 'capability reset');
    await p.expectProjectUnchanged();
  });

  it('allows the same argument name in separate callable scopes', async () => {
    const p = await PythonDelivery.create();
    p.source('function save(title: Text) returns Nothing\nfunction reset(title: Text) returns Nothing');
    await p.planContracts(); p.expectContractObligations('plan', []);
    await p.buildContracts(); p.expectContractObligations('write', []);
    await p.checkConsumer('from store.contracts import save, reset\nsave("Dune")\nreset("Dune")');
    p.expectNativeTypecheckPassed();
  });
});
