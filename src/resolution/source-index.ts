import type { NodeKind, ModelNode, ModuleModel, NodeId } from '../model.js';

/** Lexical analysis reads the model's indexed structural facts without rebuilding their schema. */
export class SourceIndex {
  readonly locator: string;
  readonly nodes: readonly ModelNode[];
  readonly roots: readonly ModelNode[];

  constructor(private readonly model: ModuleModel) {
    this.locator = model.locator;
    this.roots = model.roots().map(id => model.node(id));
    const nodes = new Map<NodeId, ModelNode>();
    const visit = (node: ModelNode): void => {
      if (nodes.has(node.id)) return;
      nodes.set(node.id, node);
      for (const child of model.children(node.id)) visit(model.node(child));
    };
    for (const root of this.roots) visit(root);
    this.nodes = [...nodes.values()];
  }

  node(id: NodeId): ModelNode { return this.model.node(id); }
  of<K extends NodeKind>(kind: K): readonly ModelNode<K>[] { return this.model.nodes(kind); }
  children(id: NodeId): readonly NodeId[] { return this.model.children(id); }
  parent(id: NodeId): ModelNode | undefined {
    const parent = this.model.parent(id);
    return parent ? this.model.node(parent) : undefined;
  }
  name(id: NodeId): string { return this.model.node(id, 'name').decoded; }
  reference(id: NodeId): readonly string[] {
    return this.model.node(id, 'reference').segments.map(segment => this.name(segment));
  }
}
