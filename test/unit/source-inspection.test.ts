import { visitSource } from '../resources/inspection/visitor-candidate.js';
import { describe, expect, it } from 'vitest';
import { inspectSource, SourceInspectionError } from '../../src/index.js';
import { readSpecification } from '../support/source-inspection.js';

describe('Source inspection boundaries', () => {
  it('reports a foreign source identity as a lookup error', () => {
    const source = inspectSource(readSpecification('concept StoreGame {}'));
    expect(() => source.name({ sourceId: 'other.expec', ordinal: 1 })).toThrow(SourceInspectionError);
  });

  it('reports a wrong node category instead of returning an untyped payload', () => {
    const source = inspectSource(readSpecification('concept StoreGame {}'));
    const concept = [...source.nodes('concept')][0]!;
    expect(() => source.node(concept.id, 'name')).toThrow(SourceInspectionError);
  });

  it('rejects an invalid node ordinal', () => {
    const source = inspectSource(readSpecification('concept StoreGame {}'));
    expect(() => source.name({ sourceId: 'author.expec', ordinal: -1 })).toThrow(SourceInspectionError);
  });

  it('returns a fresh iterable for each request', () => {
    const source = inspectSource(readSpecification('concept First {}\nconcept Second {}'));
    const first = source.nodes('concept')[Symbol.iterator]();
    expect(source.name(first.next().value!.payload.name)).toBe('First');
    expect([...source.nodes('concept')].map(node => source.name(node.payload.name))).toEqual(['First', 'Second']);
    expect(source.name(first.next().value!.payload.name)).toBe('Second');
  });

  it('visits in source order regardless of handler registration order', () => {
    const source = readSpecification('type Snapshot { value: Text }\nconcept StoreGame {}');
    const seen: string[] = [];
    visitSource(source, {
      concept(node, lookup) { seen.push(lookup.name(node.payload.name)); },
      'record-type-declaration'(node, lookup) { seen.push(lookup.name(node.payload.name)); },
    });
    expect(seen).toEqual(['Snapshot', 'StoreGame']);
  });

  it('propagates a consumer failure and permits a later independent visit', () => {
    const source = readSpecification('concept StoreGame {}');
    const failure = new Error('Analysis failed');
    expect(() => visitSource(source, { concept() { throw failure; } })).toThrow(failure);
    const names: string[] = [];
    visitSource(source, { concept(node, lookup) { names.push(lookup.name(node.payload.name)); } });
    expect(names).toEqual(['StoreGame']);
  });

  it('can inspect a frozen reader result without mutation', () => {
    const source = readSpecification('concept StoreGame { capability save(snapshot: Text) returns Nothing }');
    function freeze(value: unknown): void {
      if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    }
    freeze(source);
    const queries = inspectSource(source);
    expect([...queries.nodes('capability')].map(node => queries.name(node.payload.name))).toEqual(['save']);
    const names: string[] = [];
    visitSource(source, { capability(node, lookup) { names.push(lookup.name(node.payload.name)); } });
    expect(names).toEqual(['save']);
  });

  it('preserves the original node identity and complete authored range', () => {
    const source = readSpecification('concept StoreGame {}');
    const query = [...inspectSource(source).nodes('concept')][0]!;
    expect(query.id).toEqual({ sourceId: 'author.expec', ordinal: 0 });
    expect(query.range).toEqual({
      sourceId: 'author.expec',
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 20, line: 1, column: 21 },
    });
    expect(query.id).toEqual(source.nodes[0]!.id);
    expect(query.range).toEqual(source.nodes[0]!.range);
    visitSource(source, {
      concept(node) {
        expect(node.id).toEqual(query.id);
        expect(node.range).toEqual(query.range);
      },
    });
  });
});
