import { visit, type VisitorInput, type VisitorNode } from '../../../src/index.js';

export function typeUsesIn(description: VisitorInput) {
  const result: Array<{
    id: VisitorNode['id'];
    segments: readonly string[];
    arguments: Array<readonly string[]>;
    sourceId: string;
    at: { line: number; column: number };
  }> = [];
  visit(description, {
    'named-type'(node, context) {
      result.push({
        id: node.id,
        segments: context.reference(node.payload.reference),
        arguments: node.payload.arguments.map(id =>
          context.reference(context.node(id, 'named-type').payload.reference)),
        sourceId: node.range.sourceId,
        at: { line: node.range.start.line, column: node.range.start.column },
      });
    },
  });
  return result;
}