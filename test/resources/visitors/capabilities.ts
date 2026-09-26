import { visit, type VisitorInput } from '../../../src/index.js';

export function capabilitiesIn(description: VisitorInput) {
  const result: Array<{
    name: string;
    inputs: Array<{ name: string; type: readonly string[] }>;
    sourceId: string;
    at: { line: number; column: number };
    nameAt: { line: number; column: number };
    nameEnd: { line: number; column: number };
  }> = [];
  visit(description, {
    capability(node, context) {
      const name = context.node(node.payload.name, 'name');
      result.push({
        name: context.name(name.id),
        inputs: node.payload.parameters.map(id => {
          const parameter = context.node(id, 'parameter');
          const type = context.node(parameter.payload.declaredType, 'named-type');
          return { name: context.name(parameter.payload.name), type: context.reference(type.payload.reference) };
        }),
        sourceId: node.range.sourceId,
        at: { line: node.range.start.line, column: node.range.start.column },
        nameAt: { line: name.range.start.line, column: name.range.start.column },
        nameEnd: { line: name.range.end.line, column: name.range.end.column },
      });
    },
  });
  return result;
}