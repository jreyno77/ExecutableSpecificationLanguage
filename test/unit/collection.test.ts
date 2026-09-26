import { describe, expect, it } from 'vitest';
import { collect, InspectionError, type Collector } from '../../src/index.js';
import { inspectText } from '../support/query-inspection.js';

const names: Collector<'capability', string> = {
  kind: 'capability',
  project: (node, inspection) => inspection.name(node.payload.name),
};

describe('an analysis author collects projected observations', () => {
  it('projects each matching declaration once in authored order', () => {
    const inspection = inspectText(`concept StoreGame {
  capability startup()
  local concept Storage {
    capability save()
  }
}`);

    const observations = collect(inspection, {
      kind: 'capability',
      project: (node, source) => ({ name: source.name(node.payload.name), line: node.range.start.line }),
    });

    expect(observations).toEqual([{ name: 'startup', line: 2 }, { name: 'save', line: 4 }]);
  });

  it('returns an empty array without projecting when the kind is absent', () => {
    const inspection = inspectText('concept StoreGame {}');

    const observations = collect(inspection, {
      kind: 'capability',
      project: () => { throw new Error('No capability should be projected'); },
    });

    expect(observations).toEqual([]);
  });

  it('lets callers change one result array without affecting later collection', () => {
    const inspection = inspectText('concept StoreGame { capability save() }');

    const first = collect(inspection, names);
    first.push('caller addition');
    const second = collect(inspection, names);

    expect(first).toEqual(['save', 'caller addition']);
    expect(second).toEqual(['save']);
    expect(second).not.toBe(first);
  });

  it('propagates the projection exception immediately and leaves later collection usable', () => {
    const inspection = inspectText('concept StoreGame { capability save() }');
    const failure = new Error('consumer failure');

    let caught: unknown;
    try {
      collect(inspection, { kind: 'capability', project: () => { throw failure; } });
    } catch (error) { caught = error; }

    expect(caught).toBe(failure);
    expect(collect(inspection, names)).toEqual(['save']);
  });

  it('preserves checked-access errors from the projection', () => {
    const inspection = inspectText('concept StoreGame { capability save() }');

    expect(() => collect(inspection, {
      kind: 'capability',
      project: (node, source) => source.node(node.payload.name, 'capability'),
    })).toThrowError(expect.objectContaining({
      code: 'unexpected-kind', expectedKind: 'capability', actualKind: 'name',
    }));
    expect(() => collect(inspection, {
      kind: 'capability',
      project: node => { throw new InspectionError('missing-node', node.id, 'Missing requested data'); },
    })).toThrowError(InspectionError);
  });
});
