import type { Inspection, SourceNodeId } from '../../src/index.js';

// Describes syntax through public links. It does not resolve or validate types.
export function describeType(source: Inspection, id: Readonly<SourceNodeId>): string {
  const type = source.node(id, 'named-type');
  const name = source.reference(type.payload.reference).join('.');
  const argumentsText = type.payload.arguments.map(argument => describeType(source, argument));
  return name + (argumentsText.length ? `<${argumentsText.join(', ')}>` : '');
}
