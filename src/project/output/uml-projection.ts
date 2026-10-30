import type { Item } from '../../model/inspection-item.js';
import type { IdentifiedSpecification } from '../../model/specification-identity.js';
import type { NodeId } from '../../model/model.js';
import { typeLabel } from './output-projection.js';
import { hash } from '../connection/project-files.js';

export const nativeKey = (id: string): string => 's_' + hash(Buffer.from(id));
export const metadata = (data: object): string => '# expec-uml: ' + Buffer.from(JSON.stringify({ format: 1, outputId: 'uml', ...data })).toString('base64url');
export interface DiagramSubject { id: string; name: string; kind: string; owner?: string | undefined }
export interface Drawing { view: 'structure' | 'interaction'; id?: string; text: string; subjects: DiagramSubject[] }
const kinds = new Set(['concept', 'component', 'class', 'interface', 'function']);
const quote = JSON.stringify;
const wrapPromise = (text: string): string => text.split('\n').flatMap(line => {
  const lines: string[] = [];
  while (line.length > 60) {
    const space = line.lastIndexOf(' ', 60);
    if (space < 1) break;
    lines.push(line.slice(0, space)); line = line.slice(space + 1);
  }
  return [...lines, line];
}).join('\n');

/** Writes native diagram statements from checked declarations; it does not resolve or execute them. */
export function structure(current: IdentifiedSpecification): Drawing {
  const inspection = current.specification.inspection, subjects: DiagramSubject[] = [], nodes: string[] = [], edges: string[] = [], rendered = new Set<NodeId>();
  const name = (item: Item): string => 'name' in item ? item.name : item.kind;
  const identity = (item: Item, owner?: string): string => {
    const id = current.id(item.id);
    if (!subjects.some(subject => subject.id === id)) subjects.push({ id, name: name(item), kind: item.kind, ...(owner ? { owner } : {}) });
    return id;
  };
  const ownerOf = (item: Item): Item | undefined => { const parent = inspection.parent(item.id); return parent?.kind === 'local' ? inspection.parent(parent.id) : parent; };
  const qualified = (item: Item): string => { const parent = ownerOf(item); return parent && kinds.has(parent.kind) ? qualified(parent) + '.' + name(item) : name(item); };
  const references = (type: Item, owner: Item, root: Item, role: string, label: string): void => {
    const visit = (item: Item): void => {
      if (item.kind === 'named-type') {
        if (item.reference.resolution.status !== 'bound') throw new TypeError('Diagram types must be resolved.');
        const target = inspection.read(item.reference.resolution.target);
        if (target.origin.kind !== 'builtin' && kinds.has(target.kind)) {
          declaration(target);
          const source = nativeKey(current.id(root.id)), destination = nativeKey(current.id(target.id));
          const incoming = role === 'input' || role === 'construction';
          edges.push(metadata({ view: 'structure', edge: { subject: current.id(owner.id), owner: current.id(root.id), role } }) + '\n'
            + (incoming ? destination + ' -> ' + source : source + ' -> ' + destination) + ': ' + quote(label));
        }
        for (const child of item.arguments) visit(child);
      } else for (const child of inspection.children(item.id)) visit(child);
    };
    visit(type);
  };
  const signature = (item: Item<'capability' | 'function' | 'construction'>, root: Item, visibility?: 'public' | 'internal'): string[] => {
    const id = identity(item, current.id(root.id)), operation = item.kind === 'construction' ? 'construction' : item.name;
    const parameters = item.parameters.map(parameter => { identity(parameter, id); return parameter.name; });
    for (const parameter of item.parameters) {
      references(parameter.declaredType, item, root, item.kind === 'construction' ? 'construction' : 'input', item.kind === 'construction'
        ? 'construction input: ' + parameter.name : 'input: ' + operation + '.' + parameter.name);
    }
    if (item.kind !== 'construction') {
      if (item.returnType) references(item.returnType, item, root, 'output', 'result: ' + operation);
    }
    const promises = item.kind !== 'construction' && item.body.kind === 'available'
      ? item.body.content.members.filter(member => member.kind === 'promises') : [];
    return [metadata({ view: 'structure', member: id, owner: nativeKey(current.id(root.id)), name: operation, parameters: item.parameters.map(parameter => current.id(parameter.id)) }),
      quote((visibility === 'internal' ? '-' : /^[+-]/.test(operation) ? '+' : '') + operation + '(' + parameters.join(', ') + ')') + ': ""',
      ...promises.length ? [quote('Promises · ' + operation) + ': ""',
        ...promises.flatMap((promise, index) => wrapPromise(promise.text).split('\n').map((line, part) =>
          quote(operation + ' · ' + (index + 1) + (part ? ' · ' + (part + 1) : '')) + ': ' + quote(line)))] : []];
  };
  const declaration = (item: Item): void => {
    if (rendered.has(item.id) || !kinds.has(item.kind)) return; rendered.add(item.id);
    const owner = ownerOf(item), id = identity(item, owner && kinds.has(owner.kind) ? current.id(owner.id) : undefined), contents: string[] = [], label = qualified(item);
    const kind = item.origin.kind === 'external' ? 'external ' + item.kind.replace('-type-declaration', ' type')
      : item.kind === 'record-type-declaration' && item.error ? 'error type' : item.kind.replace('-type-declaration', ' type');
    if (item.kind === 'function') contents.push(...signature(item, item));
    else if (item.kind === 'concept' || item.kind === 'component' || item.kind === 'class' || item.kind === 'interface') {
      const selected = new Set(item.members.flatMap(member => member.kind === 'public' ? member.references.flatMap(reference => reference.resolution.status === 'bound' ? [reference.resolution.target] : []) : []));
      for (const member of item.members) {
        if (member.kind === 'capability') contents.push(...signature(member, item, selected.has(member.id) ? 'public' : 'internal'));
        else if (member.kind === 'construction') contents.push(...signature(member, item));
        else if (member.kind === 'depends-on') for (const reference of member.references) {
          if (reference.resolution.status !== 'bound') throw new TypeError('Diagram dependencies must be resolved.');
          const target = inspection.read(reference.resolution.target);
          if (!kinds.has(target.kind)) continue;
          declaration(target);
          edges.push(metadata({ view: 'structure', edge: { subject: id, owner: id, role: 'dependency' } }) + '\n' + nativeKey(id) + ' -> ' + nativeKey(current.id(target.id)) + ': ' + quote(label + ' depends on ' + qualified(target) + ' (dependency)'));
        } else if (member.kind === 'field') references(member.declaredType, member, item, 'field', 'field: ' + member.name);
        else if (member.kind === 'local') declaration(member.declaration); else if (kinds.has(member.kind)) declaration(member);
      }
    }
    nodes.push(metadata({ view: 'structure', definition: id, kind, name: label, ...owner && kinds.has(owner.kind) ? { owner: current.id(owner.id) } : {} }) + '\n' + nativeKey(id) + ': ' + quote('«' + (inspection.parent(item.id)?.kind === 'local' ? 'local ' : '') + kind + '»\n' + label + (item.origin.kind === 'external' ? '\nfrom ' + item.origin.module : '')) + ' {\n  shape: class\n'
      + contents.map(line => '  ' + line).join('\n') + '\n}');
  };
  for (const root of inspection.roots()) if (root.origin.kind === 'source') declaration(root);
  for (const kind of ['capability', 'function'] as const) for (const caller of inspection.query(kind)) {
    if (caller.origin.kind !== 'source' || caller.body.kind === 'unavailable') continue;
    const from = caller.kind === 'function' ? caller : ownerOf(caller);
    if (!from || !kinds.has(from.kind)) continue;
    for (const targetId of current.specification.calls(caller.id)) {
      const target = inspection.read(targetId), to = target.kind === 'function' ? target : ownerOf(target);
      if (!to || !kinds.has(to.kind)) throw new TypeError('A declared call needs architectural endpoints.');
      declaration(from); declaration(to);
      edges.push(metadata({ view: 'structure', edge: { subject: current.id(caller.id), owner: current.id(from.id), role: 'call', target: current.id(target.id) } }) + '\n'
        + nativeKey(current.id(from.id)) + ' -> ' + nativeKey(current.id(to.id)) + ': ' + quote(caller.name + ' calls ' + name(target)));
    }
  }
  return { view: 'structure', subjects, text: metadata({ view: 'structure' }) + '\ndirection: down\n' + nodes.join('\n') + '\n' + edges.join('\n')
    + '\nexpec_legend: "Declared architecture:\\n+ public; − internal (not published).\\nDependencies are declared relationships." {shape: text}\n' };
}

export function interactions(current: IdentifiedSpecification): Drawing[] {
  const specification = current.specification, inspection = specification.inspection;
  return [...inspection.query('interaction')].filter(node => node.origin.kind === 'source').map(interaction => {
    const id = current.id(interaction.id), subjects: DiagramSubject[] = [{ id, name: interaction.title.value, kind: 'interaction' }];
    const lines = [metadata({ view: 'interaction', interaction: id }), 'shape: sequence_diagram',
      'label: ' + quote(interaction.title.value + '\nDeclared communication — not observed execution'),
      'expec_title: ' + quote(interaction.title.value + '\nDeclared communication — not observed execution') + ' {shape: text; near: top-center}'];
    for (const participant of interaction.members.filter(item => item.kind === 'participant')) {
      const subject = current.id(participant.id); subjects.push({ id: subject, name: participant.name, kind: 'participant', owner: id });
      lines.push(metadata({ view: 'interaction', definition: subject, owner: id, type: participant.declaredType.kind === 'named-type' && participant.declaredType.reference.resolution.status === 'bound'
        ? current.id(participant.declaredType.reference.resolution.target) : undefined }), nativeKey(subject) + ': ' + quote(participant.name + ': ' + typeLabel(participant.declaredType)));
    }
    for (const [index, message] of interaction.members.filter(item => item.kind === 'message').entries()) {
      const fact = specification.message(message.id).value;
      if (!fact) throw new TypeError('Render only a checked authored communication.');
      const operation = inspection.read(fact.operation);
      if (operation.kind !== 'capability') throw new TypeError('Expected the selected message capability.');
      const label = (message.capture ? message.capture.decoded + ': ' + (operation.returnType ? typeLabel(operation.returnType) : 'unspecified') + ' = ' : '')
        + operation.name + '(' + message.arguments.map(expressionLabel).join(', ') + ')';
      lines.push(metadata({ view: 'interaction', message: { interaction: id, operation: current.id(operation.id), ordinal: index + 1 } }),
        nativeKey(current.id(fact.sender)) + ' -> ' + nativeKey(current.id(fact.receiver)) + ': ' + quote(label));
    }
    return { view: 'interaction', id, subjects, text: lines.join('\n') + '\n' };
  });
}
function expressionLabel(item: Item): string {
  switch (item.kind) {
    case 'number-literal': return item.token;
    case 'string-literal': return quote(item.value);
    case 'boolean-literal': return String(item.value);
    case 'name-expression': return item.reference.segments.join('.');
    case 'member-expression': return expressionLabel(item.receiver) + '.' + item.member.segments.join('.');
    case 'call-expression': return expressionLabel(item.callee) + '(' + item.arguments.map(expressionLabel).join(', ') + ')';
    case 'grouped-expression': return '(' + expressionLabel(item.inner) + ')';
    case 'unary-expression': return item.operator + (item.operator === 'not' ? ' ' : '') + expressionLabel(item.operand);
    case 'binary-expression': return '(' + expressionLabel(item.left) + ' ' + item.operator + ' ' + expressionLabel(item.right) + ')';
    case 'list-expression': return '[' + item.elements.map(expressionLabel).join(', ') + ']';
    case 'record-expression': return (item.declaredType ? typeLabel(item.declaredType) + ' ' : '') + '{ ' + item.entries.map(entry => entry.name + ': ' + expressionLabel(entry.value)).join(', ') + ' }';
    default: throw new TypeError('Cannot display checked argument ' + item.kind);
  }
}
