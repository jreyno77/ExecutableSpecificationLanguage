import { describe, expect, it } from 'vitest';
import { createNodeId, LangiumModel, LangiumReader, QueryInspection } from '../../src/index.js';

function read(text: string): QueryInspection {
  const result = new LangiumReader().read({ sourceId: 'contract.expec', text });
  if (result.status !== 'accepted') throw new Error('Expected valid source');
  return new QueryInspection(new LangiumModel('contract', result.document));
}

describe('authored containment', () => {
  it('finds the condition that contains an expression without following its references', () => {
    const inspection = read('function f() returns Number {\n ensures result > 0\n}');
    const condition = [...inspection.query('ensures')][0]!;
    expect(inspection.parent(condition.content.id)).toBe(condition);
    expect(inspection.parent(condition.id)?.kind).toBe('contract-body');
  });
  it('has no parent for a top-level declaration', () => {
    const inspection = read('function f() returns Number');
    expect(inspection.parent([...inspection.query('function')][0]!.id)).toBeUndefined();
  });
  it('rejects a node from outside the inspection', () => {
    expect(() => read('function f()').parent(createNodeId())).toThrow(expect.objectContaining({ code: 'foreign-node' }));
  });
});
