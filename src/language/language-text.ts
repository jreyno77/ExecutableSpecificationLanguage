import type { Item } from '../model/inspection-item.js';

/** Canonical authored syntax, without execution, resolution or default expansion. */
export function language(node: Item): string {
  const generics = 'typeParameters' in node && node.typeParameters.length ? '<' + node.typeParameters.map(parameter => name(parameter.name)).join(', ') + '>' : '';
  switch (node.kind) {
    case 'name': return name(node.decoded);
    case 'reference': return node.segments.map(name).join('.');
    case 'named-type': return language(node.reference) + (node.arguments.length ? '<' + node.arguments.map(language).join(', ') + '>' : '');
    case 'grouped-type': case 'grouped-expression': return '(' + language(node.inner) + ')';
    case 'optional-type': return language(node.inner) + '?';
    case 'tuple-type': return '[' + node.elements.map(language).join(', ') + ']';
    case 'union-type': return node.alternatives.map(language).join(' | ');
    case 'literal-type': return (node.negative ? '-' : '') + language(node.value);
    case 'string-literal': return JSON.stringify(node.value);
    case 'number-literal': return node.token;
    case 'boolean-literal': return String(node.value);
    case 'name-expression': return language(node.reference);
    case 'member-expression': return language(node.receiver) + '.' + language(node.member);
    case 'call-expression': return language(node.callee) + '(' + node.arguments.map(language).join(', ') + ')';
    case 'unary-expression': return node.operator + (node.operator === 'not' ? ' ' : '') + language(node.operand);
    case 'binary-expression': return language(node.left) + ' ' + node.operator + ' ' + language(node.right);
    case 'list-expression': return '[' + node.elements.map(language).join(', ') + ']';
    case 'record-expression': return (node.declaredType ? language(node.declaredType) + ' ' : '') + '{ ' + node.entries.map(language).join(', ') + ' }';
    case 'record-entry': return name(node.name) + ': ' + language(node.value);
    case 'parameter': case 'field': return name(node.name) + ': ' + language(node.declaredType) + (node.defaultValue ? ' = ' + language(node.defaultValue) : '');
    case 'participant': return 'participant ' + name(node.name) + ': ' + language(node.declaredType);
    case 'construction': return 'construction(' + node.parameters.map(language).join(', ') + ')';
    case 'concept': case 'component': case 'class': case 'interface': return node.kind + ' ' + name(node.name);
    case 'record-type-declaration': return (node.error ? 'error ' : '') + 'type ' + name(node.name) + generics + ' {\n' + node.fields.map(field => '  ' + language(field)).join('\n') + '\n}';
    case 'alias-type-declaration': return 'type ' + name(node.name) + generics + ' = ' + language(node.targetType);
    case 'opaque-type-declaration': return 'opaque type ' + name(node.name) + generics;
    case 'type-parameter': return name(node.name);
    case 'local': return 'local ' + language(node.declaration);
    case 'function': case 'capability': case 'setup': case 'action': case 'observation': case 'check':
      return node.kind + ' ' + name(node.name) + '(' + node.parameters.map(language).join(', ') + ')'
        + (node.returnType ? ' returns ' + language(node.returnType) : '')
        + (node.failures.length ? ' fails with ' + node.failures.map(language).join(', ') : '')
        + (node.body.kind === 'available' ? ' {\n' + node.body.content.members.map(member => '  ' + language(member)).join('\n') + '\n}' : '');
    case 'promises': return 'promises ' + JSON.stringify(node.text);
    case 'requires': case 'ensures': return node.kind + ' ' + language(node.content);
    case 'let': return 'let ' + name(node.name) + ' = ' + language(node.value);
    case 'do': case 'return': case 'assert': return node.kind + ' ' + language(node.expression);
    case 'fixture': return 'fixture ' + name(node.name) + ': ' + language(node.declaredType) + ' = ' + language(node.value);
    case 'prose-expectation': return 'satisfies ' + language(node.text);
    case 'example': return 'example ' + language(node.title) + ': ' + language(node.actual) + ' => ' + language(node.expected);
    case 'scenario': return 'scenario ' + language(node.title) + ' {\n' + node.steps.map(step => '  ' + language(step)).join('\n') + '\n}';
    case 'given': case 'when': return node.kind + ' ' + (node.capture ? language(node.capture) + ' = ' : '') + language(node.content);
    case 'then': return 'then ' + language(node.content);
    case 'interaction': return 'interaction ' + language(node.title) + '(' + node.parameters.map(language).join(', ') + ')';
    case 'message': return 'message ' + language(node.sender) + ' -> ' + language(node.receiver) + '.' + language(node.operation)
      + '(' + node.arguments.map(language).join(', ') + ')' + (node.capture ? ' as ' + language(node.capture) : '');
    case 'examples': return 'examples' + (node.subject ? ' for ' + language(node.subject) : '');
    default: throw new UnsupportedLanguage(node);
  }
}
export class UnsupportedLanguage extends Error {
  constructor(readonly item: Item) { super('Cannot describe authored syntax for ' + item.kind + '.'); }
}
const keywords = new Set('use from include concept component class interface depends on requires package for build runtime test public construction capability function returns local extend type opaque examples fixture setup action observation check scenario given when then example satisfies interaction participant message as let do return assert promises ensures or and not true false'.split(' '));
function name(value: string): string {
  return /^[A-Za-z_][A-Za-z_0-9]*$/.test(value) && !keywords.has(value) ? value : '`' + value.replace(/[\\`]/g, '\\$&') + '`';
}
