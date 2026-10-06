import type { Model, NodeId } from '../../../src/model/model.js';

export function name(model: Model, id: NodeId): string { return model.node(id, 'name').decoded; }
export function written(model: Model, id: NodeId): readonly string[] {
  return model.node(id, 'reference').segments.map(id => name(model, id));
}
