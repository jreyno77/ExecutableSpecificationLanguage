import type { Inspection, InspectionKind, InspectionNode } from '../inspection.js';
import type { NodeId, Range } from './contracts.js';

export function nodeKey(id: NodeId): string { return JSON.stringify([id.sourceId, id.ordinal]); }
export function copyNodeId(id: NodeId): NodeId { return { sourceId: id.sourceId, ordinal: id.ordinal }; }
export function copyRange(range: Range): Range {
  return { sourceId: range.sourceId, start: { ...range.start }, end: { ...range.end } };
}

/** Syntactic ownership edges, including authored names and reference segments. */
export function children(node: InspectionNode): readonly NodeId[] {
  const p = node.payload;
  switch (p.kind) {
    case 'name': case 'string-literal': case 'number-literal': case 'boolean-literal': return [];
    case 'reference': return p.segments;
    case 'use': return [...p.imports, p.locator];
    case 'import-item': return [p.imported, ...(p.alias ? [p.alias] : [])];
    case 'include': case 'requires-package': return [p.locator];
    case 'examples-attachment': return [p.subject, p.locator];
    case 'concept': case 'component': case 'class': case 'interface': return [p.name, ...p.members];
    case 'record-type-declaration': return [p.name, ...p.typeParameters, ...p.fields];
    case 'alias-type-declaration': return [p.name, ...p.typeParameters, p.targetType];
    case 'opaque-type-declaration': return [p.name, ...p.typeParameters];
    case 'field': case 'parameter': return [p.name, p.declaredType, ...(p.defaultValue ? [p.defaultValue] : [])];
    case 'local': return [p.declaration];
    case 'extend': return [p.target, ...p.members];
    case 'depends-on': case 'public': return p.references;
    case 'construction': return p.parameters;
    case 'capability': case 'function': case 'setup': case 'action': case 'observation': case 'check':
      return [p.name, ...p.parameters, ...(p.returnType ? [p.returnType] : []), ...(p.body ? [p.body] : [])];
    case 'contract-body': case 'helper-body': case 'check-body': return p.members;
    case 'promises': case 'requires': case 'ensures': return [p.content];
    case 'examples': return [...(p.subject ? [p.subject] : []), ...p.members];
    case 'fixture': return [p.name, p.declaredType, p.value];
    case 'let': return [p.name, p.value];
    case 'do': case 'return': case 'assert': return [p.expression];
    case 'scenario': return [p.title, ...p.steps];
    case 'given': case 'when': case 'then': return [...(p.capture ? [p.capture] : []), p.content];
    case 'example': return [p.title, p.actual, p.expected];
    case 'prose-expectation': return [p.text];
    case 'interaction': return [p.title, ...p.parameters, ...p.members];
    case 'participant': return [p.name, p.declaredType];
    case 'message': return [p.sender, p.receiver, p.operation, ...p.arguments, ...(p.capture ? [p.capture] : [])];
    case 'named-type': return [p.reference, ...p.arguments];
    case 'tuple-type': return p.elements;
    case 'optional-type': case 'grouped-type': case 'grouped-expression': return [p.inner];
    case 'union-type': return p.alternatives;
    case 'literal-type': return [p.value];
    case 'name-expression': return [p.reference];
    case 'member-expression': return [p.receiver, p.member];
    case 'call-expression': return [p.callee, ...p.arguments];
    case 'record-expression': return [...(p.declaredType ? [p.declaredType] : []), ...p.entries];
    case 'record-entry': return [p.name, p.value];
    case 'list-expression': return p.elements;
    case 'unary-expression': return [p.operand];
    case 'binary-expression': return [p.left, p.right];
  }
}

/** A call-local index. It owns no parser and retains no Inspection provider. */
export class SourceIndex {
  readonly nodes: readonly InspectionNode[];
  readonly roots: readonly InspectionNode[];
  private readonly byId = new Map<string, InspectionNode>();
  private readonly parents = new Map<string, NodeId>();

  constructor(inspection: Inspection) {
    const candidates: InspectionNode[] = [];
    // These are all grammar top-level forms. Nested candidates are removed by
    // their actual child edges, not inferred from source ranges or spelling.
    const rootKinds = [
      'use', 'include', 'examples-attachment', 'concept', 'component', 'class', 'interface',
      'record-type-declaration', 'alias-type-declaration', 'opaque-type-declaration',
      'function', 'extend', 'examples', 'interaction',
    ] as const;
    for (const kind of rootKinds) candidates.push(...inspection.nodes(kind));
    const visit = (node: InspectionNode): void => {
      const key = nodeKey(node.id);
      if (this.byId.has(key)) return;
      this.byId.set(key, node);
      for (const child of children(node)) {
        this.parents.set(nodeKey(child), node.id);
        visit(inspection.node(child));
      }
    };
    for (const candidate of candidates) visit(candidate);
    this.nodes = [...this.byId.values()].sort((a, b) => a.id.ordinal - b.id.ordinal);
    this.roots = this.nodes.filter(node => !this.parents.has(nodeKey(node.id)));
  }

  node(id: NodeId): InspectionNode {
    const node = this.byId.get(nodeKey(id));
    if (!node) throw new Error('Accepted source contains an unreachable node handle.');
    return node;
  }
  of<K extends InspectionKind>(kind: K): readonly InspectionNode<K>[] {
    return this.nodes.filter(node => node.payload.kind === kind) as InspectionNode<K>[];
  }
  parent(id: NodeId): InspectionNode | undefined {
    const parent = this.parents.get(nodeKey(id));
    return parent ? this.node(parent) : undefined;
  }
  name(id: NodeId): string {
    const node = this.node(id);
    if (node.payload.kind !== 'name') throw new Error('Accepted source requires a name handle.');
    return node.payload.decoded;
  }
  reference(id: NodeId): readonly string[] {
    const node = this.node(id);
    if (node.payload.kind !== 'reference') throw new Error('Accepted source requires a reference handle.');
    return node.payload.segments.map(segment => this.name(segment));
  }
}
