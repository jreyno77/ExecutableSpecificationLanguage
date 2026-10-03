import type { NodeKind, ModelNode, ModuleModel, NodeId } from '../model.js';

/** Lexical analysis reads the model's indexed structural facts without rebuilding their schema. */
export class SourceIndex {
  readonly locator: string;
  readonly nodes: readonly ModelNode[];
  readonly roots: readonly ModelNode[];

  constructor(private readonly model: ModuleModel, private readonly omitted: ReadonlySet<NodeId> = new Set()) {
    this.locator = model.locator;
    this.roots = model.roots().filter(id => !omitted.has(id)).map(id => model.node(id));
    const nodes = new Map<NodeId, ModelNode>();
    const visit = (node: ModelNode): void => {
      if (nodes.has(node.id) || omitted.has(node.id)) return;
      nodes.set(node.id, node);
      for (const child of model.children(node.id)) visit(model.node(child));
    };
    for (const root of this.roots) visit(root);
    this.nodes = [...nodes.values()];
  }

  node(id: NodeId): ModelNode { return this.model.node(id); }
  of<K extends NodeKind>(kind: K): readonly ModelNode<K>[] { return this.model.nodes(kind).filter(node => !this.omitted.has(node.id)); }
  children(id: NodeId): readonly NodeId[] { return this.model.children(id).filter(child => !this.omitted.has(child)); }
  without(ids: ReadonlySet<NodeId>): SourceIndex { return new SourceIndex(this.model, ids); }
  parent(id: NodeId): ModelNode | undefined {
    const parent = this.model.parent(id);
    return parent ? this.model.node(parent) : undefined;
  }
  name(id: NodeId): string { return this.model.node(id, 'name').decoded; }
  reference(id: NodeId): readonly string[] {
    return this.model.node(id, 'reference').segments.map(segment => this.name(segment));
  }
}
