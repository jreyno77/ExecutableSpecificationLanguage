import { expect } from 'vitest';
import type { AcceptedSource, SourceDescription } from '../../src/grammar/source.js';
import { childrenOf, nodeFor, readSyntax } from '../driver/syntax-reading.js';

export function readAcceptedSource(text: string, sourceId = 'memory:example'): AcceptedSource {
  const result = readSyntax(text, sourceId);
  expect(result.status, result.status === 'rejected' ? JSON.stringify(result.diagnostics) : '').toBe('accepted');
  if (result.status !== 'accepted') throw new Error('Expected accepted source');
  expect(result.document).toEqual({ sourceId, text });
  return result;
}
export function expectRejectedSyntax(text: string): void {
  const result = readSyntax(text);
  expect(result.status).toBe('rejected');
  if (result.status !== 'rejected') throw new Error('Expected malformed syntax to be rejected');
  expect(result.diagnostics.length).toBeGreaterThan(0);
}
export function expectNavigableSourceForest(source: SourceDescription): void {
  const parents = new Map<number, number>();
  for (const [index, node] of source.nodes.entries()) {
    expect(node.id).toEqual({ sourceId: source.sourceId, ordinal: index });
    for (const childId of childrenOf(node)) {
      const child = nodeFor(source, childId);
      expect(child.range.start.offset).toBeGreaterThanOrEqual(node.range.start.offset);
      expect(child.range.end.offset).toBeLessThanOrEqual(node.range.end.offset);
      expect(parents.has(childId.ordinal)).toBe(false);
      parents.set(childId.ordinal, index);
    }
  }
  expect(parents.size + source.roots.length).toBe(source.nodes.length);
}
