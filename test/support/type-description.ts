import type { Inspection, SourceNodeId } from '../../src/index.js';

export function describeReference(source: Inspection, id: Readonly<SourceNodeId>): string {
  return source.node(id, 'reference').payload.segments.map(segment => {
    const name = source.node(segment, 'name').payload;
    return name.quoted ? '`' + name.decoded.replaceAll('\\', '\\\\').replaceAll('`', '\\`') + '`' : name.decoded;
  }).join('.');
}

// A consumer presentation of syntax, not resolution or the original whitespace.
export function describeType(source: Inspection, id: Readonly<SourceNodeId>): string {
  const type = source.node(id).payload;
  const describe = (child: Readonly<SourceNodeId>) => describeType(source, child);
  switch (type.kind) {
    case 'named-type': {
      const argumentsText = type.arguments.map(describe);
      return describeReference(source, type.reference) + (argumentsText.length ? `<${argumentsText.join(', ')}>` : '');
    }
    case 'tuple-type': return `[${type.elements.map(describe).join(', ')}]`;
    case 'optional-type': return `${describe(type.inner)}?`;
    case 'union-type': return type.alternatives.map(describe).join(' | ');
    case 'grouped-type': return `(${describe(type.inner)})`;
    case 'literal-type': {
      const value = source.node(type.value).payload;
      switch (value.kind) {
        case 'string-literal': return JSON.stringify(value.value);
        case 'number-literal': return (type.negative ? '-' : '') + value.token;
        case 'boolean-literal': return String(value.value);
        default: throw new Error(`Expected a literal type value, found ${value.kind}`);
      }
    }
    default: throw new Error(`Expected a type description, found ${type.kind}`);
  }
}

