import type { Inspection, Item } from './inspection.js';
import { isNodeId, propertyNames, type Model, type ModelNode, type NodeId, type NodeKind } from './model.js';

/** Presents indexed model facts as readable views; child access stays lazy. */
export class QueryInspection implements Inspection {
  private readonly views = new Map<NodeId, Item>();
  constructor(private readonly model: Model) {}
  query<K extends NodeKind>(kind: K): Iterable<Item<K>> {
    const nodes = this.model.nodes(kind);
    const inspection = this;
    return { *[Symbol.iterator]() { for (const node of nodes) yield inspection.read(node.id, kind); } };
  }
  read(id: NodeId): Item;
  read<K extends NodeKind>(id: NodeId, kind: K): Item<K>;
  read(id: NodeId, kind?: NodeKind): Item {
    const node = kind === undefined ? this.model.node(id) : this.model.node(id, kind);
    let view = this.views.get(id);
    if (!view) { view = this.present(node); this.views.set(id, view); }
    return view;
  }
  private present(node: ModelNode): Item {
    const view: Record<string, unknown> = { id: node.id, kind: node.kind, origin: node.origin };
    const property = (name: string, get: () => unknown): void => { Object.defineProperty(view, name, { enumerable: true, get }); };
    for (const key of propertyNames(node)) {
      if (key === 'id' || key === 'kind' || key === 'origin' || node.kind === 'promises' && key === 'content') continue;
      property(key, () => {
        const value = (node as unknown as Record<string, unknown>)[key];
        if (key === 'name' && isNodeId(value)) return this.model.node(value, 'name').decoded;
        if (node.kind === 'reference' && key === 'segments') return node.segments.map(id => this.model.node(id, 'name').decoded);
        return this.expand(value);
      });
    }
    if ('name' in node && isNodeId(node.name)) {
      // Replace the generic child projection with the declaration's readable name.
      const name = this.model.node(node.name, 'name');
      property('nameOrigin', () => name.origin);
    }
    if (node.kind === 'reference') {
      property('segmentOrigins', () => node.segments.map(id => this.model.node(id, 'name').origin));
      property('resolution', () => this.model.resolution(node.id));
    }
    if (node.kind === 'promises') {
      property('text', () => this.model.node(node.content, 'string-literal').value);
      property('textOrigin', () => this.model.node(node.content).origin);
    }
    return view as unknown as Item;
  }
  private expand(value: unknown): unknown {
    if (isNodeId(value)) {
      return this.read(value);
    }
    if (Array.isArray(value)) return value.map(item => this.expand(item));
    if (value && typeof value === 'object' && 'kind' in value && value.kind === 'available' && 'node' in value) {
      return { kind: 'available', content: this.read(value.node as NodeId) };
    }
    return value;
  }
}
