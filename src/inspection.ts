import type { Item } from './inspection-item.js';
import type { NodeId, NodeKind } from './model.js';

/** Readable views preserve authored facts and expose known identities through read(). */
export interface Inspection {
  parent(id: NodeId): Item | undefined;
  query<K extends NodeKind>(kind: K): Iterable<Item<K>>;
  read(id: NodeId): Item;
  read<K extends NodeKind>(id: NodeId, kind: K): Item<K>;
}
