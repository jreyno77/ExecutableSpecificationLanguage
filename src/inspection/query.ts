import type { SourceDescription } from '../grammar/source.js';
import type { SourceKind, SourceLookup, SourceNodeOf } from './source-access.js';

export interface SourceInspection extends SourceLookup {
  nodes<K extends SourceKind>(kind: K): Iterable<SourceNodeOf<K>>;
}
export function inspectSource(_source: SourceDescription): SourceInspection {
  throw new Error('Source queries are not implemented yet.');
}
