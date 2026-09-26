import type { SourceDescription } from '../grammar/source.js';
import type { SourceKind, SourceLookup, SourceNodeOf } from './source-access.js';

export type SourceVisitors = { [K in SourceKind]?: (node: SourceNodeOf<K>, source: SourceLookup) => void };
export function visitSource(_source: SourceDescription, _visitors: SourceVisitors): void {
  throw new Error('Source visitor is not implemented yet.');
}
