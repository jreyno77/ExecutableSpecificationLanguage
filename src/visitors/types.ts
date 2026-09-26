import type { SourceDescription, SourceNodeId, SourcePayload, SourceRange } from '../grammar/source.js';

type ReadonlyValue<T> = T extends object ? { readonly [P in keyof T]: ReadonlyValue<T[P]> } : T;
export type VisitorKind = SourcePayload['kind'];
export type VisitorInput = ReadonlyValue<SourceDescription>;

// Some reader variants group kinds (for example capability | function).
// Distribute over both unions so each callback still receives its precise kind.
type PayloadFor<P, K> = P extends { kind: infer Kind }
  ? K extends Kind ? Omit<P, 'kind'> & { kind: K } : never : never;

export type VisitorNode<K extends VisitorKind = VisitorKind> = {
  readonly id: ReadonlyValue<SourceNodeId>;
  readonly range: ReadonlyValue<SourceRange>;
  readonly payload: ReadonlyValue<PayloadFor<SourcePayload, K>>;
};

export interface VisitorContext {
  node(id: SourceNodeId): VisitorNode;
  node<K extends VisitorKind>(id: SourceNodeId, expectedKind: K): VisitorNode<K>;
  name(id: SourceNodeId): string;
  reference(id: SourceNodeId): readonly string[];
}

export type Visitor<K extends VisitorKind = VisitorKind> =
  (node: VisitorNode<K>, context: VisitorContext) => void;

export type Visitors = { [K in VisitorKind]?: Visitor<K> };