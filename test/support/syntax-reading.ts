import { expect } from 'vitest';
import { AntlrSyntaxReader } from '../../src/grammar/reader.js';
import type { AcceptedSource, ReadResult, SourceDescription, SourceNode, SourceNodeId, SourcePayload } from '../../src/grammar/source.js';

export function readSyntax(text: string, sourceId = 'memory:example'): ReadResult {
  return new AntlrSyntaxReader().read({ sourceId, text });
}

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

type NodeOfKind<Kind extends SourcePayload['kind']> = SourceNode & { payload: SourcePayload & { kind: Kind } };
export function nodesOfKind<Kind extends SourcePayload['kind']>(source: SourceDescription, kind: Kind): NodeOfKind<Kind>[] {
  return source.nodes.filter((node): node is NodeOfKind<Kind> => node.payload.kind === kind);
}
export function nodeFor(source: SourceDescription, id: SourceNodeId): SourceNode {
  const node = source.nodes[id.ordinal];
  if (!node) throw new Error(`The source description is missing node ${id.ordinal}.`);
  return node;
}

export function expectNavigableSourceForest(source: SourceDescription): void {
  const childrenOf = (node: SourceNode): SourceNodeId[] => Object.entries(node.payload).flatMap(([key, value]) => {
    if (key === 'operatorRange') return [];
    const values = Array.isArray(value) ? value : [value];
    return values.filter((value): value is SourceNodeId => typeof value === 'object' && value !== null && 'ordinal' in value);
  });
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
