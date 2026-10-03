import type { Item } from './inspection-item.js';
import type { IdentifiedSpecification } from './specification-identity.js';
import type { NodeId } from './model.js';
import { typeLabel } from './output-projection.js';
import { hash } from './project-files.js';

export const nativeKey = (id: string): string => 's_' + hash(Buffer.from(id));
export const metadata = (data: object): string => '# expec-uml: ' + Buffer.from(JSON.stringify({ format: 1, outputId: 'uml', ...data })).toString('base64url');
export interface DiagramSubject { id: string; name: string; kind: string; owner?: string | undefined }
export interface Drawing { view: 'structure' | 'interaction'; id?: string; text: string; subjects: DiagramSubject[] }
const kinds = new Set(['concept', 'component', 'class', 'interface', 'record-type-declaration', 'alias-type-declaration', 'opaque-type-declaration', 'function']);
const quote = JSON.stringify;

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
    const visit = (item: Item, argument = false): void => {
      if (item.kind === 'named-type') {
        if (item.reference.resolution.status !== 'bound') throw new TypeError('Diagram types must be resolved.');
        const target = inspection.read(item.reference.resolution.target);
        if (target.origin.kind !== 'builtin' && target.kind !== 'type-parameter') {
          declaration(target);
          const source = nativeKey(current.id(root.id)), destination = nativeKey(current.id(target.id));
          const incoming = role === 'input' || role === 'construction';
          const edgeRole = role === 'failure' && argument ? 'failure-type-argument' : role;
          const edgeLabel = role === 'failure' && argument ? 'failure type argument: ' + typeLabel(item) + ' in ' + typeLabel(type) : label;
          edges.push(metadata({ view: 'structure', edge: { subject: current.id(owner.id), owner: current.id(root.id), role: edgeRole } }) + '\n'
            + (incoming ? destination + ' -> ' + source : source + ' -> ' + destination) + ': ' + quote(edgeLabel));
        }
        for (const child of item.arguments) visit(child, true);
      } else for (const child of inspection.children(item.id)) visit(child, argument);
    };
    visit(type);
  };
  const signature = (item: Item<'capability' | 'function' | 'construction'>, root: Item): string[] => {
    const id = identity(item, current.id(root.id)), operation = item.kind === 'construction' ? 'construction' : item.name;
    const parameters = item.parameters.map(parameter => { identity(parameter, id); return parameter.name + ': ' + typeLabel(parameter.declaredType); });
    for (const parameter of item.parameters) {
      const plain = parameter.declaredType.kind === 'named-type' && !parameter.declaredType.arguments.length;
      references(parameter.declaredType, item, root, item.kind === 'construction' ? 'construction' : 'input', item.kind === 'construction'
        ? 'construction input: ' + parameter.name + ': ' + typeLabel(parameter.declaredType)
        : (plain ? '' : 'input type: ') + operation + '.' + parameter.name + ': ' + typeLabel(parameter.declaredType));
    }
    const result = item.kind !== 'construction' && item.returnType ? typeLabel(item.returnType) : 'unspecified';
    if (item.kind !== 'construction') {
      if (item.returnType) references(item.returnType, item, root, 'output', (item.returnType.kind === 'named-type' && !item.returnType.arguments.length ? '' : 'output type: ') + operation + ' result: ' + result);
      for (const failure of item.failures) references(failure, item, root, 'failure', 'may fail with ' + typeLabel(failure));
      if (item.body.kind === 'available') for (const [index, promise] of item.body.content.members.filter(member => member.kind === 'promises').entries()) {
        nodes.push(nativeKey(id) + '_promise_' + index + ': ' + quote('Unverified intent: ' + promise.text) + ' {shape: page}');
      }
    }
    return [metadata({ view: 'structure', member: id, owner: nativeKey(current.id(root.id)), parameters: item.parameters.map(parameter => current.id(parameter.id)) }),
      quote(operation + '(' + parameters.join(', ') + ')') + ': ' + (/^\w+$/.test(result) ? result : quote(item.kind === 'construction' ? 'construction' : result))];
  };
  const declaration = (item: Item): void => {
    if (rendered.has(item.id) || !kinds.has(item.kind)) return; rendered.add(item.id);
    const owner = ownerOf(item), id = identity(item, owner && kinds.has(owner.kind) ? current.id(owner.id) : undefined), contents: string[] = [], label = qualified(item);
    const kind = item.origin.kind === 'external' ? 'external ' + item.kind.replace('-type-declaration', ' type')
      : item.kind === 'record-type-declaration' && item.error ? 'error type' : item.kind.replace('-type-declaration', ' type');
    if (item.kind === 'function') contents.push(...signature(item, item));
    else if (item.kind === 'record-type-declaration') for (const field of item.fields) {
      const node = field.kind === 'local' ? field.declaration : field;
      if (node.kind === 'field') {
        identity(node, id); contents.push(metadata({ view: 'structure', member: current.id(node.id), owner: nativeKey(id), parameters: [] }), quote(node.name) + ': ' + quote(typeLabel(node.declaredType)));
        references(node.declaredType, node, item, 'field', 'field: ' + node.name + ': ' + typeLabel(node.declaredType));
      } else declaration(node);
    }
    else if (item.kind === 'alias-type-declaration') { contents.push(quote('alias') + ': ' + quote(item.name + parameters(item.typeParameters) + ' = ' + typeLabel(item.targetType))); references(item.targetType, item, item, 'alias', 'alias of ' + typeLabel(item.targetType)); }
    else if (item.kind === 'concept' || item.kind === 'component' || item.kind === 'class' || item.kind === 'interface') {
      const selected = new Set(item.members.flatMap(member => member.kind === 'public' ? member.references.flatMap(reference => reference.resolution.status === 'bound' ? [reference.resolution.target] : []) : []));
      for (const member of item.members) {
        if (member.kind === 'capability' && selected.has(member.id) || member.kind === 'construction') contents.push(...signature(member, item));
        else if (member.kind === 'depends-on') for (const reference of member.references) {
          if (reference.resolution.status !== 'bound') throw new TypeError('Diagram dependencies must be resolved.');
          const target = inspection.read(reference.resolution.target); declaration(target);
          edges.push(metadata({ view: 'structure', edge: { subject: id, owner: id, role: 'dependency' } }) + '\n' + nativeKey(id) + ' -> ' + nativeKey(current.id(target.id)) + ': ' + quote(label + ' depends on ' + qualified(target) + ' (dependency)'));
        } else if (member.kind === 'local') declaration(member.declaration); else if (kinds.has(member.kind)) declaration(member);
      }
    }
    nodes.push(metadata({ view: 'structure', definition: id, kind, name: label, ...owner && kinds.has(owner.kind) ? { owner: current.id(owner.id) } : {} }) + '\n' + nativeKey(id) + ': ' + quote('«' + (inspection.parent(item.id)?.kind === 'local' ? 'local ' : '') + kind + '»\n' + label + (item.origin.kind === 'external' ? '\nfrom ' + item.origin.module : '')) + ' {\n  shape: class\n'
      + ('typeParameters' in item && item.typeParameters.length ? '  "type parameters": ' + quote(parameters(item.typeParameters)) + '\n' : '')
      + contents.map(line => '  ' + line).join('\n') + '\n}');
  };
  for (const root of inspection.roots()) if (root.origin.kind === 'source') declaration(root);
  return { view: 'structure', subjects, text: metadata({ view: 'structure' }) + '\n' + nodes.join('\n') + '\n' + edges.join('\n')
    + '\nexpec_legend: "Declared contracts: inputs toward consumer; outputs toward result.\\nDependencies and fields do not imply ownership or runtime calls." {shape: text}\n' };
}
const parameters = (items: readonly Item<'type-parameter'>[]): string => items.length ? '<' + items.map(item => item.name).join(', ') + '>' : '';

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
