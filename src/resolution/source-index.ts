import { children, type InspectionKind, type InspectionNode, type ModuleInspection, type NodeId } from '../inspection.js';

/** Index common containment once; consumers never need to distinguish producers. */
export class SourceIndex {
  readonly locator: string;
  readonly nodes: readonly InspectionNode[];
  readonly roots: readonly InspectionNode[];
  private readonly byId = new Map<NodeId, InspectionNode>();
  private readonly parents = new Map<NodeId, NodeId>();

  constructor(inspection: ModuleInspection) {
    this.locator = inspection.locator;
    const visit = (node: InspectionNode): void => {
      if (this.byId.has(node.id)) return;
      this.byId.set(node.id, node);
      for (const child of children(node)) {
        this.parents.set(child, node.id);
        visit(inspection.node(child));
      }
    };
    this.roots = [...inspection.roots()].map(id => inspection.node(id));
    for (const root of this.roots) visit(root);
    this.nodes = [...this.byId.values()];
  }

  node(id: NodeId): InspectionNode {
    const node = this.byId.get(id);
    if (!node) throw new Error('Accepted source contains an unreachable node handle.');
    return node;
  }
  of<K extends InspectionKind>(kind: K): readonly InspectionNode<K>[] {
    return this.nodes.filter(node => node.payload.kind === kind) as InspectionNode<K>[];
  }
  parent(id: NodeId): InspectionNode | undefined {
    const parent = this.parents.get(id);
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
