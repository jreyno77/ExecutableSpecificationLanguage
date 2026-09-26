import type { SourceDescription, SourceNodeId, SourcePayload, SourceRange } from '../grammar/source.js';

export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type SourceKind = SourcePayload['kind'];
// Distribute over both unions: existing payloads can group several node kinds.
type NarrowPayload<P, K> = P extends { kind: infer Kind } ? K extends Kind ? Omit<P, 'kind'> & { kind: K } : never : never;
export type SourceNodeOf<K extends SourceKind> = {
  readonly id: DeepReadonly<SourceNodeId>;
  readonly range: DeepReadonly<SourceRange>;
  readonly payload: DeepReadonly<NarrowPayload<SourcePayload, K>>;
};
export interface SourceLookup {
  node<K extends SourceKind>(id: SourceNodeId, kind: K): SourceNodeOf<K>;
  name(id: SourceNodeId): string;
  reference(id: SourceNodeId): readonly string[];
}
export class SourceInspectionError extends Error {
  constructor(message: string) { super(message); this.name = 'SourceInspectionError'; }
}
export function createSourceLookup(source: SourceDescription): SourceLookup {
  function node<K extends SourceKind>(id: SourceNodeId, kind: K): SourceNodeOf<K> {
    if (id.sourceId !== source.sourceId) {
      throw new SourceInspectionError(`Node belongs to ${id.sourceId}, not the inspected source ${source.sourceId}.`);
    }
    if (!Number.isInteger(id.ordinal) || id.ordinal < 0) {
      throw new SourceInspectionError(`Node ordinal ${id.ordinal} is not a non-negative integer.`);
    }
    const found = source.nodes[id.ordinal];
    if (!found || found.id.sourceId !== id.sourceId || found.id.ordinal !== id.ordinal) {
      throw new SourceInspectionError(`Node ${id.ordinal} does not exist in ${source.sourceId}.`);
    }
    if (found.payload.kind !== kind) {
      throw new SourceInspectionError(`Node ${id.ordinal} is ${found.payload.kind}; expected ${kind}.`);
    }
    // The identity and discriminant checks establish this generic, readonly view.
    return found as SourceNodeOf<K>;
  }
  function name(id: SourceNodeId): string {
    return node(id, 'name').payload.decoded;
  }
  function reference(id: SourceNodeId): readonly string[] {
    return node(id, 'reference').payload.segments.map(name);
  }
  return { node, name, reference };
}
