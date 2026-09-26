import { describe, it } from 'vitest';
import { QueryInspection } from '../support/query-inspection.js';

describe('an analysis author inspects declared source through queries', () => {
  it('keeps capabilities and their inputs in authored order with declaration and name locations', () => {
    const inspection = new QueryInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability startup(configurations: SystemConfig)
  capability saveGame(snapshot: PlayerStateSnapshot)
}`);

    inspection.collectCapabilities();

    inspection.expectCapabilities([
      { name: 'startup', inputs: ['configurations: SystemConfig'], sourceId: 'store.expec',
        declarationAt: { line: 2, column: 3 }, nameAt: { line: 2, column: 14 }, nameEndsAt: { line: 2, column: 21 } },
      { name: 'saveGame', inputs: ['snapshot: PlayerStateSnapshot'], sourceId: 'store.expec',
        declarationAt: { line: 3, column: 3 }, nameAt: { line: 3, column: 14 }, nameEndsAt: { line: 3, column: 22 } },
    ]);
    inspection.expectSourceUnchanged();
  });

  it('preserves differently named capability inputs in their declared order', () => {
    const inspection = new QueryInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability transfer(origin: Cart, destination: Storage)
}`);

    inspection.collectCapabilities();

    inspection.expectCapabilities([
      { name: 'transfer', inputs: ['origin: Cart', 'destination: Storage'], sourceId: 'store.expec',
        declarationAt: { line: 2, column: 3 }, nameAt: { line: 2, column: 14 }, nameEndsAt: { line: 2, column: 22 } },
    ]);
  });


  it('finds capabilities inside a local concept without consumer recursion', () => {
    const inspection = new QueryInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability startup()
  local concept Storage {
    capability save(snapshot: PlayerStateSnapshot)
  }
}`);

    inspection.collectCapabilities();

    inspection.expectCapabilities([
      { name: 'startup', inputs: [], sourceId: 'store.expec',
        declarationAt: { line: 2, column: 3 }, nameAt: { line: 2, column: 14 }, nameEndsAt: { line: 2, column: 21 } },
      { name: 'save', inputs: ['snapshot: PlayerStateSnapshot'], sourceId: 'store.expec',
        declarationAt: { line: 4, column: 5 }, nameAt: { line: 4, column: 16 }, nameEndsAt: { line: 4, column: 20 } },
    ]);
  });

  it('keeps every nested generic occurrence with its location and argument links', () => {
    const inspection = new QueryInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability merge(left: List<Pair<Number>>, right: List<Pair<Number>>)
}`);

    inspection.collectNamedTypes();

    inspection.expectNamedTypes([
      { name: 'List', at: { line: 2, column: 26 }, arguments: ['Pair'] },
      { name: 'Pair', at: { line: 2, column: 31 }, arguments: ['Number'] },
      { name: 'Number', at: { line: 2, column: 36 }, arguments: [] },
      { name: 'List', at: { line: 2, column: 53 }, arguments: ['Pair'] },
      { name: 'Pair', at: { line: 2, column: 58 }, arguments: ['Number'] },
      { name: 'Number', at: { line: 2, column: 63 }, arguments: [] },
    ]);
    inspection.expectDistinctTypeOccurrences(6);
  });

  it('adds an independent promise-text consumer using the public inspection API', () => {
    const inspection = new QueryInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability saveGame(snapshot: PlayerStateSnapshot) {
    promises "A snapshot is saved"
  }
}`);

    inspection.collectPromises();

    inspection.expectPromises([
      { text: 'A snapshot is saved', clauseAt: { line: 3, column: 5 }, textAt: { line: 3, column: 14 } },
    ]);
  });

  it('repeats independent analyses in either order without changing source or prior results', () => {
    const inspection = new QueryInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability startup(configurations: SystemConfig)
  capability saveGame(snapshot: PlayerStateSnapshot)
}`);

    inspection.collectCapabilities();
    inspection.collectNamedTypes();
    inspection.expectCapabilityNames(['startup', 'saveGame']);
    inspection.expectTypeNames(['SystemConfig', 'PlayerStateSnapshot']);

    inspection.collectNamedTypes();
    inspection.collectCapabilities();
    inspection.expectCapabilityNames(['startup', 'saveGame']);
    inspection.expectTypeNames(['SystemConfig', 'PlayerStateSnapshot']);
    inspection.expectSourceUnchanged();
  });

  it('keeps separate documents and later reads independent', () => {
    const original = new QueryInspection();
    original.sourceIs('store.expec', `concept StoreGame {
  capability saveGame(snapshot: PlayerStateSnapshot)
}`);
    const other = new QueryInspection();
    other.sourceIs('storage.expec', `concept Storage {
  capability load(key: Text)
}`);
    const revised = new QueryInspection();
    revised.sourceIs('store.expec', `concept StoreGame {
  capability saveDraft(snapshot: PlayerStateSnapshot)
}`);

    revised.collectCapabilities();
    other.collectCapabilities();
    other.collectNamedTypes();
    original.collectNamedTypes();
    original.collectCapabilities();

    original.expectCapabilityNames(['saveGame']);
    original.expectTypeNames(['PlayerStateSnapshot']);
    other.expectCapabilities([
      { name: 'load', inputs: ['key: Text'], sourceId: 'storage.expec',
        declarationAt: { line: 2, column: 3 }, nameAt: { line: 2, column: 14 }, nameEndsAt: { line: 2, column: 18 } },
    ]);
    other.expectTypeNames(['Text']);
    revised.expectCapabilityNames(['saveDraft']);
    original.expectSourceUnchanged();
    other.expectSourceUnchanged();
    revised.expectSourceUnchanged();
  });

  it('reports no capabilities when none are declared', () => {
    const inspection = new QueryInspection();
    inspection.sourceIs('store.expec', 'concept StoreGame {}');

    inspection.collectCapabilities();

    inspection.expectCapabilities([]);
  });

  it('preserves reader rejection instead of manufacturing inspectable source', () => {
    const inspection = new QueryInspection();
    inspection.sourceIs('store.expec', 'concept StoreGame {');

    inspection.expectRejectedWithDiagnostics();
    inspection.expectSourceUnchanged();
  });
});
