import { describe, it } from 'vitest';
import { VisitorInspection } from '../support/visitor-inspection.js';

describe('An analysis author inspects source through visitors', () => {
  it('SI-01: keeps capabilities, inputs and name locations in authored order', () => {
    const inspection = new VisitorInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability startup(configurations: SystemConfig)
  capability saveGame(snapshot: PlayerStateSnapshot)
}`);

    inspection.collectCapabilities();

    inspection.expectCapabilities([
      { name: 'startup', inputs: [{ name: 'configurations', type: ['SystemConfig'] }],
        sourceId: 'store.expec', at: { line: 2, column: 3 },
        nameAt: { line: 2, column: 14 }, nameEnd: { line: 2, column: 21 } },
      { name: 'saveGame', inputs: [{ name: 'snapshot', type: ['PlayerStateSnapshot'] }],
        sourceId: 'store.expec', at: { line: 3, column: 3 },
        nameAt: { line: 3, column: 14 }, nameEnd: { line: 3, column: 22 } },
    ]);
  });

  it('SI-02: includes a capability inside a local concept without a separate discovery walk', () => {
    const inspection = new VisitorInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability startup()
  local concept Storage {
    capability save(snapshot: PlayerStateSnapshot)
  }
}`);

    inspection.collectCapabilities();

    inspection.expectCapabilities([
      { name: 'startup', inputs: [], sourceId: 'store.expec', at: { line: 2, column: 3 },
        nameAt: { line: 2, column: 14 }, nameEnd: { line: 2, column: 21 } },
      { name: 'save', inputs: [{ name: 'snapshot', type: ['PlayerStateSnapshot'] }],
        sourceId: 'store.expec', at: { line: 4, column: 5 },
        nameAt: { line: 4, column: 16 }, nameEnd: { line: 4, column: 20 } },
    ]);
  });

  it('SI-03: retains every nested type occurrence and its argument links', () => {
    const inspection = new VisitorInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability merge(left: List<Pair<Number>>, right: List<Pair<Number>>)
}`);

    inspection.collectTypeUses();

    inspection.expectTypeUses([
      { segments: ['List'], arguments: [['Pair']], sourceId: 'store.expec', at: { line: 2, column: 26 } },
      { segments: ['Pair'], arguments: [['Number']], sourceId: 'store.expec', at: { line: 2, column: 31 } },
      { segments: ['Number'], arguments: [], sourceId: 'store.expec', at: { line: 2, column: 36 } },
      { segments: ['List'], arguments: [['Pair']], sourceId: 'store.expec', at: { line: 2, column: 53 } },
      { segments: ['Pair'], arguments: [['Number']], sourceId: 'store.expec', at: { line: 2, column: 58 } },
      { segments: ['Number'], arguments: [], sourceId: 'store.expec', at: { line: 2, column: 63 } },
    ]);
    inspection.expectDistinctTypeOccurrences(6);
  });

  it('SI-04: lets an independent consumer read promise text and its locations', () => {
    const inspection = new VisitorInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability saveGame(snapshot: PlayerStateSnapshot) {
    promises "A snapshot is saved"
  }
}`);

    inspection.collectPromises();

    inspection.expectPromises([
      { text: 'A snapshot is saved', sourceId: 'store.expec',
        at: { line: 3, column: 5 }, textAt: { line: 3, column: 14 } },
    ]);
  });

  it('SI-05: independent analyses can repeat in either order without changing source', () => {
    const inspection = new VisitorInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability startup(configurations: SystemConfig)
  capability saveGame(snapshot: PlayerStateSnapshot)
}`);

    inspection.collectCapabilities();
    inspection.collectTypeUses();
    inspection.expectCapabilityNames(['startup', 'saveGame']);
    inspection.expectTypeNames([['SystemConfig'], ['PlayerStateSnapshot']]);

    inspection.collectTypeUses();
    inspection.collectCapabilities();
    inspection.expectCapabilityNames(['startup', 'saveGame']);
    inspection.expectTypeNames([['SystemConfig'], ['PlayerStateSnapshot']]);
    inspection.expectSourceUnchanged();
  });

  it('SI-05: new reads remain separate from earlier revisions of the same source', () => {
    const earlier = new VisitorInspection();
    earlier.sourceIs('store.expec', 'concept StoreGame { capability saveGame(snapshot: PlayerStateSnapshot) }');
    const revised = new VisitorInspection();
    revised.sourceIs('store.expec', 'concept StoreGame { capability saveDraft(snapshot: PlayerStateSnapshot) }');
    const another = new VisitorInspection();
    another.sourceIs('other.expec', 'concept Storage { capability save(snapshot: Text) }');

    revised.collectCapabilities();
    earlier.collectCapabilities();
    another.collectCapabilities();

    earlier.expectCapabilityNames(['saveGame']);
    revised.expectCapabilityNames(['saveDraft']);
    another.expectCapabilities([
      { name: 'save', inputs: [{ name: 'snapshot', type: ['Text'] }], sourceId: 'other.expec',
        at: { line: 1, column: 19 }, nameAt: { line: 1, column: 30 }, nameEnd: { line: 1, column: 34 } },
    ]);
    earlier.expectSourceUnchanged();
    revised.expectSourceUnchanged();
    another.expectSourceUnchanged();
  });

  it('SI-06: reports an empty result when no capability is authored', () => {
    const inspection = new VisitorInspection();
    inspection.sourceIs('store.expec', 'concept StoreGame {}');

    inspection.collectCapabilities();

    inspection.expectCapabilities([]);
  });

  it('SI-06: preserves syntax rejection instead of manufacturing an inspectable description', () => {
    const inspection = new VisitorInspection();
    inspection.sourceIs('store.expec', 'concept StoreGame {');

    inspection.expectRejectedSource('unexpected-token', { line: 1, column: 20 });
  });

  it('keeps a quoted dot inside one decoded reference segment', () => {
    const inspection = new VisitorInspection();
    inspection.sourceIs('store.expec', 'type Alias = `State.Snapshot`');

    inspection.collectTypeUses();

    inspection.expectTypeUses([
      { segments: ['State.Snapshot'], arguments: [], sourceId: 'store.expec', at: { line: 1, column: 14 } },
    ]);
  });

  it('preserves the order of independently authored promise clauses', () => {
    const inspection = new VisitorInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability startup() returns Nothing {
    promises "The main page is visible"
  }
  capability saveGame() returns Nothing {
    promises "A snapshot of the game is saved"
  }
}`);

    inspection.collectPromises();

    inspection.expectPromises([
      { text: 'The main page is visible', sourceId: 'store.expec',
        at: { line: 3, column: 5 }, textAt: { line: 3, column: 14 } },
      { text: 'A snapshot of the game is saved', sourceId: 'store.expec',
        at: { line: 6, column: 5 }, textAt: { line: 6, column: 14 } },
    ]);
  });

  it('keeps two differently typed inputs in their authored parameter order', () => {
    const inspection = new VisitorInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability transfer(origin: Cart, destination: Storage)
}`);

    inspection.collectCapabilities();

    inspection.expectCapabilities([
      { name: 'transfer', inputs: [{ name: 'origin', type: ['Cart'] }, { name: 'destination', type: ['Storage'] }],
        sourceId: 'store.expec', at: { line: 2, column: 3 },
        nameAt: { line: 2, column: 14 }, nameEnd: { line: 2, column: 22 } },
    ]);
  });
});
