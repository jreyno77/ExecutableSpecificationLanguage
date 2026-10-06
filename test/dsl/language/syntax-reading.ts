import { expect } from 'vitest';
import type { Model, ModelNode, NodeId } from '../../../src/index.js';
import { modelOf, readSyntax } from '../../driver/language/syntax-reading.js';
export { readSyntax } from '../../driver/language/syntax-reading.js';

export function readAcceptedSource(text: string, sourceId = 'memory:example') {
  const result = readSyntax(text, sourceId);
  expect(result.status, result.status === 'rejected' ? JSON.stringify(result.diagnostics) : '').toBe('accepted');
  if (result.status !== 'accepted') throw new Error('Expected accepted source');
  expect(result.document.source).toEqual({ sourceId, text });
  return { ...result, model: modelOf(result.document) };
}

export function expectRejectedSyntax(text: string): void {
  const result = readSyntax(text);
  expect(result.status).toBe('rejected');
  if (result.status !== 'rejected') throw new Error('Expected malformed syntax to be rejected');
  expect(result.diagnostics.length).toBeGreaterThan(0);
}

export function sourceRange(node: ModelNode) {
  if (node.origin.kind !== 'source') throw new Error('Expected an authored source location');
  return node.origin.range;
}

export function expectNavigableSourceForest(model: Model): void {
  const visited = new Set<NodeId>();
  let ordinal = 0;
  const visit = (id: NodeId, parent?: NodeId) => {
    const node = model.node(id);
    expect(visited.has(id)).toBe(false);
    visited.add(id);
    if (node.origin.kind !== 'source') throw new Error('Expected source provenance');
    expect(node.origin.node.ordinal).toBe(ordinal++);
    expect(model.parent(id)).toBe(parent);
    if (parent) {
      const container = sourceRange(model.node(parent));
      expect(sourceRange(node).start.offset).toBeGreaterThanOrEqual(container.start.offset);
      expect(sourceRange(node).end.offset).toBeLessThanOrEqual(container.end.offset);
    }
    for (const child of model.children(id)) visit(child, id);
  };
  for (const root of model.roots()) visit(root);
}
