import { describe, expect, it } from 'vitest';
import { InspectionError } from '../../src/index.js';
import { capabilityNames, inspectText } from '../support/query-inspection.js';

describe('an inspection caller consumes independent queries', () => {
  it('obtains fresh iterators from the same iterable and can replay it', () => {
    const inspection = inspectText('concept StoreGame { capability startup()\n  capability saveGame() }');
    const capabilities = inspection.nodes('capability');
    const first = capabilities[Symbol.iterator]();
    const second = capabilities[Symbol.iterator]();

    expect(inspection.name(first.next().value!.payload.name)).toBe('startup');
    expect(capabilityNames(inspection, { [Symbol.iterator]: () => second })).toEqual(['startup', 'saveGame']);
    expect(inspection.name(first.next().value!.payload.name)).toBe('saveGame');
    expect(first.next().done).toBe(true);
    expect(capabilityNames(inspection, capabilities)).toEqual(['startup', 'saveGame']);
  });

  it('interleaves different requests without consuming one another', () => {
    const inspection = inspectText('concept StoreGame { capability startup(config: SystemConfig)\n  capability saveGame(snapshot: PlayerStateSnapshot) }');
    const capabilities = inspection.nodes('capability')[Symbol.iterator]();
    const types = inspection.nodes('named-type')[Symbol.iterator]();

    expect(inspection.name(capabilities.next().value!.payload.name)).toBe('startup');
    expect(inspection.reference(types.next().value!.payload.reference)).toEqual(['SystemConfig']);
    expect(inspection.name(capabilities.next().value!.payload.name)).toBe('saveGame');
    expect(inspection.reference(types.next().value!.payload.reference)).toEqual(['PlayerStateSnapshot']);
    expect(types.next().done).toBe(true);
    expect(capabilities.next().done).toBe(true);
  });

  it('can abandon iteration and start a complete request after a caller exception', () => {
    const inspection = inspectText('concept StoreGame { capability startup()\n  capability saveGame() }');
    const failure = new Error('consumer failed');
    expect(() => {
      for (const _capability of inspection.nodes('capability')) throw failure;
    }).toThrow(failure);

    expect(capabilityNames(inspection, inspection.nodes('capability'))).toEqual(['startup', 'saveGame']);
  });

  it('preserves decoded names and separate reference segments', () => {
    const inspection = inspectText('concept `Store Game` { capability save(snapshot: Models.`Player State`) }');
    const concept = Array.from(inspection.nodes('concept'))[0]!;
    const type = Array.from(inspection.nodes('named-type'))[0]!;

    expect(inspection.name(concept.payload.name)).toBe('Store Game');
    expect(inspection.reference(type.payload.reference)).toEqual(['Models', 'Player State']);
    expect(inspection.node(type.id)).toEqual(type);
  });

  it('retains Unicode-scalar offsets and exclusive name ends', () => {
    const inspection = inspectText('concept `🛒 Store` {}', 'unicode.expec');
    const concept = Array.from(inspection.nodes('concept'))[0]!;
    const name = inspection.node(concept.payload.name, 'name');

    expect(name.payload.decoded).toBe('🛒 Store');
    expect(name.range).toEqual({
      sourceId: 'unicode.expec',
      start: { offset: 8, line: 1, column: 9 },
      end: { offset: 17, line: 1, column: 18 },
    });
  });
});

describe('an inspection caller receives checked access errors', () => {
  it('distinguishes a wrong node kind from missing syntax or semantic errors', () => {
    const inspection = inspectText('concept StoreGame {}');
    const concept = Array.from(inspection.nodes('concept'))[0]!;
    expect(() => inspection.node(concept.payload.name, 'capability')).toThrowError(InspectionError);
    expect(() => inspection.node(concept.payload.name, 'capability')).toThrowError(expect.objectContaining({
      code: 'unexpected-kind', nodeId: concept.payload.name, expectedKind: 'capability', actualKind: 'name',
    }));
    expect(() => inspection.name(concept.id)).toThrowError(expect.objectContaining({
      code: 'unexpected-kind', expectedKind: 'name', actualKind: 'concept',
    }));
    expect(() => inspection.reference(concept.id)).toThrowError(expect.objectContaining({
      code: 'unexpected-kind', expectedKind: 'reference', actualKind: 'concept',
    }));
  });

  it('rejects an identifier from another source even when its ordinal exists here', () => {
    const inspection = inspectText('concept StoreGame {}', 'store.expec');
    const other = inspectText('concept Storage {}', 'storage.expec');
    const foreign = Array.from(other.nodes('concept'))[0]!.id;

    expect(() => inspection.node(foreign)).toThrowError(expect.objectContaining({
      code: 'foreign-source', nodeId: foreign,
    }));
  });

  it('rejects absent, negative and fractional ordinals instead of returning undefined', () => {
    const inspection = inspectText('concept StoreGame {}');
    expect(() => inspection.node({ sourceId: 'store.expec', ordinal: 100 })).toThrowError(expect.objectContaining({ code: 'missing-node' }));
    expect(() => inspection.name({ sourceId: 'store.expec', ordinal: -1 })).toThrowError(expect.objectContaining({ code: 'missing-node' }));
    expect(() => inspection.reference({ sourceId: 'store.expec', ordinal: 0.5 })).toThrowError(expect.objectContaining({ code: 'missing-node' }));
    expect(() => inspection.node({ sourceId: 'store.expec', ordinal: NaN })).toThrowError(expect.objectContaining({ code: 'missing-node' }));
  });
});
