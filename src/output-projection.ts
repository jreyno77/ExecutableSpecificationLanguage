import type { Item } from './inspection-item.js';
import type { IdentifiedSpecification } from './specification-identity.js';
import type { NodeId } from './model.js';

/** The structural-list document format, also used to render the contract list. */
export interface ListedDeclaration {
  specId?: string;
  kind: string;
  name: string;
  signature?: string;
  promises?: string[];
  references: { role: 'dependency' | 'input' | 'output' | 'field' | 'construction' | 'use'; specId?: string; path?: string }[];
  members: ListedDeclaration[];
}
const roots = new Set(['concept', 'component', 'class', 'interface', 'record-type-declaration', 'alias-type-declaration', 'opaque-type-declaration', 'function']);
export function listDeclarations(current: IdentifiedSpecification): ListedDeclaration[] {
  const inspection = current.specification.inspection;
  const names = (node: Item): string => 'name' in node ? node.name : node.kind;
  const type = (node: Item): string => {
    switch (node.kind) {
      case 'named-type': return node.reference.segments.join('.') + (node.arguments.length ? '<' + node.arguments.map(type).join(', ') + '>' : '');
      case 'optional-type': return type(node.inner) + '?';
      case 'grouped-type': return '(' + type(node.inner) + ')';
      case 'tuple-type': return '[' + node.elements.map(type).join(', ') + ']';
      case 'union-type': return node.alternatives.map(type).join(' | ');
      case 'literal-type': return (node.negative ? '-' : '') + type(node.value);
      case 'string-literal': return JSON.stringify(node.value);
      case 'number-literal': return node.token;
      case 'boolean-literal': return String(node.value);
      default: throw new TypeError('Cannot describe a checked type as ' + node.kind);
    }
  };
  const references = (node: Item, role: ListedDeclaration['references'][number]['role']): ListedDeclaration['references'] => {
    const found = new Set<string>();
    const visit = (item: Item): void => {
      if (item.kind === 'reference') {
        if (item.resolution.status !== 'bound') throw new TypeError('A rendered reference must already be resolved.');
        const target = inspection.read(item.resolution.target);
        if (target.origin.kind !== 'builtin') found.add(current.id(target.id));
      } else for (const child of inspection.children(item.id)) visit(child);
    };
    visit(node); return [...found].map(specId => ({ role, specId }));
  };
  const describe = (node: Item, role: ListedDeclaration['references'][number]['role'] = 'field'): ListedDeclaration => {
    const result: ListedDeclaration = { specId: current.id(node.id), kind: node.kind.replace('-type-declaration', '-type'), name: names(node), references: [], members: [] };
    if (node.kind === 'capability' || node.kind === 'function') {
      result.signature = node.name + '(' + node.parameters.map(parameter => parameter.name + ': ' + type(parameter.declaredType)).join(', ') + ')'
        + (node.returnType ? ' returns ' + type(node.returnType) : '');
      result.members = node.parameters.map(parameter => describe(parameter, 'input'));
      if (node.returnType) result.references.push(...references(node.returnType, 'output'));
      result.promises = node.body.kind === 'available' ? node.body.content.members.filter(item => item.kind === 'promises').map(item => item.text) : [];
    } else if (node.kind === 'parameter' || node.kind === 'field') {
      result.signature = node.name + ': ' + type(node.declaredType); result.references = references(node.declaredType, role);
    } else if (node.kind === 'construction') {
      result.signature = 'construction(' + node.parameters.map(parameter => parameter.name + ': ' + type(parameter.declaredType)).join(', ') + ')';
      result.members = node.parameters.map(parameter => describe(parameter, 'construction'));
    } else if (node.kind === 'alias-type-declaration') {
      result.signature = node.name + parameters(node.typeParameters) + ' = ' + type(node.targetType);
      result.references = references(node.targetType, 'field'); result.members = node.typeParameters.map(parameter => describe(parameter));
    } else if (node.kind === 'record-type-declaration' || node.kind === 'opaque-type-declaration') {
      result.signature = node.name + parameters(node.typeParameters); result.members = node.typeParameters.map(parameter => describe(parameter));
      if (node.kind === 'record-type-declaration') result.members.push(...node.fields.map(field => describe(field.kind === 'local' ? field.declaration : field)));
    } else if (node.kind === 'concept' || node.kind === 'component' || node.kind === 'class' || node.kind === 'interface') {
      const publicIds = new Set<NodeId>(node.members.flatMap(member => member.kind === 'public'
        ? member.references.flatMap(reference => reference.resolution.status === 'bound' ? [reference.resolution.target] : []) : []));
      for (const member of node.members) {
        if (member.kind === 'depends-on') result.references.push(...member.references.flatMap(reference => references(reference, 'dependency')));
        else if (member.kind === 'construction' || member.kind === 'field' || member.kind === 'local') result.members.push(describe(member.kind === 'local' ? member.declaration : member));
        else if (member.kind === 'capability' || member.kind === 'function') { if (publicIds.has(member.id)) result.members.push(describe(member)); }
        else if (roots.has(member.kind)) result.members.push(describe(member));
      }
    }
    return result;
  };
  const parameters = (values: readonly Item<'type-parameter'>[]): string => values.length ? '<' + values.map(value => value.name).join(', ') + '>' : '';
  return [...inspection.roots()].filter(node => node.origin.kind === 'source' && roots.has(node.kind)).map(node => describe(node));
}
export function flatten(declaration: ListedDeclaration): ListedDeclaration[] { return [declaration, ...declaration.members.flatMap(flatten)]; }
export function anchor(id: string): string { return 'expec-' + Buffer.from(id).toString('hex'); }
