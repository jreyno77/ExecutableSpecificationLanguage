import type { Item } from '../../../src/index.js';

export function describeReference(reference: Item<'reference'>): string {
  return reference.segments.map(segment => /^[A-Za-z_][A-Za-z_0-9]*$/.test(segment)
    ? segment : '`' + segment.replaceAll('\\', '\\\\').replaceAll('`', '\\`') + '`').join('.');
}

// A consumer presentation of authored structure, not resolution or original whitespace.
export function describeType(type: Item): string {
  switch (type.kind) {
    case 'named-type': {
      const argumentsText = type.arguments.map(describeType);
      return describeReference(type.reference) + (argumentsText.length ? `<${argumentsText.join(', ')}>` : '');
    }
    case 'tuple-type': return `[${type.elements.map(describeType).join(', ')}]`;
    case 'optional-type': return `${describeType(type.inner)}?`;
    case 'union-type': return type.alternatives.map(describeType).join(' | ');
    case 'grouped-type': return `(${describeType(type.inner)})`;
    case 'literal-type': {
      const value = type.value;
      switch (value.kind) {
        case 'string-literal': return JSON.stringify(value.value);
        case 'number-literal': return (type.negative ? '-' : '') + value.token;
        case 'boolean-literal': return String(value.value);
        default: throw new Error('Expected a literal type value');
      }
    }
    default: throw new Error(`Expected a type description, found ${type.kind}`);
  }
}
