import { visit, type VisitorInput } from '../../../src/index.js';

// A third analysis is entirely a consumer: it adds no reader or visitor machinery.
export function promisesIn(description: VisitorInput) {
  const result: Array<{
    text: string;
    sourceId: string;
    at: { line: number; column: number };
    textAt: { line: number; column: number };
  }> = [];
  visit(description, {
    promises(node, context) {
      const text = context.node(node.payload.content, 'string-literal');
      result.push({
        text: text.payload.value,
        sourceId: node.range.sourceId,
        at: { line: node.range.start.line, column: node.range.start.column },
        textAt: { line: text.range.start.line, column: text.range.start.column },
      });
    },
  });
  return result;
}