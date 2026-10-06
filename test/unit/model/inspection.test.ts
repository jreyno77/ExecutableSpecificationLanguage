import { describe, expect, it } from 'vitest';
import { QueryError, type NodeId } from '../../../src/index.js';
import { capabilityNames, inspectText } from '../../driver/model/query-inspection.js';

describe('an inspection caller consumes independent queries', () => {
  it('obtains fresh iterators from the same iterable and can replay it', () => {
    const inspection = inspectText('concept StoreGame { capability startup()\n  capability saveGame() }');
    const capabilities = inspection.query('capability');
    const first = capabilities[Symbol.iterator]();
    const second = capabilities[Symbol.iterator]();

    expect(first.next().value!.name).toBe('startup');
    expect(capabilityNames({ [Symbol.iterator]: () => second })).toEqual(['startup', 'saveGame']);
    expect(first.next().value!.name).toBe('saveGame');
    expect(first.next().done).toBe(true);
    expect(capabilityNames(capabilities)).toEqual(['startup', 'saveGame']);
  });

  it('interleaves different requests without consuming one another', () => {
    const inspection = inspectText('concept StoreGame { capability startup(config: SystemConfig)\n  capability saveGame(snapshot: PlayerStateSnapshot) }');
    const capabilities = inspection.query('capability')[Symbol.iterator]();
    const types = inspection.query('named-type')[Symbol.iterator]();

    expect(capabilities.next().value!.name).toBe('startup');
    expect(types.next().value!.reference.segments).toEqual(['SystemConfig']);
    expect(capabilities.next().value!.name).toBe('saveGame');
    expect(types.next().value!.reference.segments).toEqual(['PlayerStateSnapshot']);
    expect(types.next().done).toBe(true);
    expect(capabilities.next().done).toBe(true);
  });

  it('can abandon iteration and start a complete request after a caller exception', () => {
    const inspection = inspectText('concept StoreGame { capability startup()\n  capability saveGame() }');
    const failure = new Error('consumer failed');
    expect(() => { for (const _capability of inspection.query('capability')) throw failure; }).toThrow(failure);

    expect(capabilityNames(inspection.query('capability'))).toEqual(['startup', 'saveGame']);
  });

  it('preserves decoded names and separate reference segments', () => {
    const inspection = inspectText('concept `Store Game` { capability save(snapshot: Models.`Player State`) }');
    const concept = Array.from(inspection.query('concept'))[0]!;
    const type = Array.from(inspection.query('named-type'))[0]!;

    expect(concept.name).toBe('Store Game');
    expect(type.reference.segments).toEqual(['Models', 'Player State']);
    expect(inspection.read(concept.id)).toEqual(concept);
  });

  it('retains Unicode-scalar offsets and exclusive name ends', () => {
    const inspection = inspectText('concept `🛒 Store` {}', 'unicode.expec');
    const concept = Array.from(inspection.query('concept'))[0]!;

    expect(concept.name).toBe('🛒 Store');
    expect(concept.nameOrigin.kind === 'source' ? concept.nameOrigin.range : undefined).toEqual({
      sourceId: 'unicode.expec', start: { offset: 8, line: 1, column: 9 }, end: { offset: 17, line: 1, column: 18 },
    });
  });
});

describe('an inspection caller receives checked access errors', () => {
  it('distinguishes a wrong node kind from missing syntax or semantic errors', () => {
    const inspection = inspectText('concept StoreGame {}');
    const concept = Array.from(inspection.query('concept'))[0]!;
    const name = Array.from(inspection.query('name'))[0]!;
    expect(() => inspection.read(name.id, 'capability')).toThrowError(QueryError);
    expect(() => inspection.read(name.id, 'capability')).toThrowError(expect.objectContaining({
      code: 'unexpected-kind', nodeId: name.id, expectedKind: 'capability', actualKind: 'name',
    }));
    expect(() => inspection.read(concept.id, 'name')).toThrowError(expect.objectContaining({
      code: 'unexpected-kind', expectedKind: 'name', actualKind: 'concept',
    }));
    expect(() => inspection.read(concept.id, 'reference')).toThrowError(expect.objectContaining({
      code: 'unexpected-kind', expectedKind: 'reference', actualKind: 'concept',
    }));
  });

  it('rejects a handle from another inspection', () => {
    const inspection = inspectText('concept StoreGame {}', 'store.expec');
    const other = inspectText('concept Storage {}', 'storage.expec');
    const foreign = Array.from(other.query('concept'))[0]!.id;

    expect(() => inspection.read(foreign)).toThrowError(expect.objectContaining({ code: 'foreign-node', nodeId: foreign }));
  });

  it('rejects raw source identifiers instead of treating them as inspection handles', () => {
    const inspection = inspectText('concept StoreGame {}');
    expect(() => inspection.read({ sourceId: 'store.expec', ordinal: 100 } as unknown as NodeId)).toThrowError(expect.objectContaining({ code: 'missing-node' }));
    expect(() => inspection.read({ sourceId: 'store.expec', ordinal: -1 } as unknown as NodeId, 'name')).toThrowError(expect.objectContaining({ code: 'missing-node' }));
    expect(() => inspection.read({ sourceId: 'store.expec', ordinal: 0.5 } as unknown as NodeId, 'reference')).toThrowError(expect.objectContaining({ code: 'missing-node' }));
    expect(() => inspection.read({ sourceId: 'store.expec', ordinal: NaN } as unknown as NodeId, 'reference')).toThrowError(expect.objectContaining({ code: 'missing-node' }));
  });
});
