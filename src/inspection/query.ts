import type { SourceDescription } from '../grammar/source.js';
import { createSourceLookup, type SourceKind, type SourceLookup, type SourceNodeOf } from './source-access.js';

export interface SourceInspection extends SourceLookup {
  nodes<K extends SourceKind>(kind: K): Iterable<SourceNodeOf<K>>;
}
export function inspectSource(source: SourceDescription): SourceInspection {
  const lookup = createSourceLookup(source);
  return {
    ...lookup,
    *nodes<K extends SourceKind>(kind: K): Iterable<SourceNodeOf<K>> {
      for (const node of source.nodes) {
        if (node.payload.kind === kind) yield lookup.node(node.id, kind);
      }
    },
  };
}
