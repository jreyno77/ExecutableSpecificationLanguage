import type { SourceDescription, SourceNodeId, SourcePayload, SourceRange } from '../grammar/source.js';

export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type SourceKind = SourcePayload['kind'];
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
export function createSourceLookup(_source: SourceDescription): SourceLookup {
  throw new Error('Source inspection is not implemented yet.');
}
