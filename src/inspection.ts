import type { SourceDescription, SourceNode, SourceNodeId, SourcePayload } from './grammar/source.js';

type ReadonlyView<T> = { readonly [P in keyof T]: ReadonlyView<T[P]> };
export type InspectionKind = SourcePayload['kind'];
export type InspectionInput = ReadonlyView<SourceDescription>;

// Distribute grouped discriminants too: CallableNode covers six different kinds.
type PayloadFor<K extends InspectionKind, P = SourcePayload> =
  P extends { kind: infer Kind } ? K extends Kind ? Omit<P, 'kind'> & { kind: K } : never : never;
export type InspectionNode<K extends InspectionKind = InspectionKind> =
  K extends InspectionKind ? ReadonlyView<Omit<SourceNode, 'payload'> & { payload: PayloadFor<K> }> : never;

export interface Inspection {
  nodes<K extends InspectionKind>(kind: K): Iterable<InspectionNode<K>>;
  node(id: Readonly<SourceNodeId>): InspectionNode;
  node<K extends InspectionKind>(id: Readonly<SourceNodeId>, expectedKind: K): InspectionNode<K>;
  name(id: Readonly<SourceNodeId>): string;
  reference(id: Readonly<SourceNodeId>): readonly string[];
}

export type InspectionErrorCode = 'foreign-source' | 'missing-node' | 'unexpected-kind';
export class InspectionError extends Error {
  override readonly name = 'InspectionError';
  constructor(
    readonly code: InspectionErrorCode,
    readonly nodeId: Readonly<SourceNodeId>,
    message: string,
    readonly expectedKind?: InspectionKind,
    readonly actualKind?: InspectionKind,
  ) { super(message); }
}

/** Inspect one accepted reader description. No resolution, I/O, or input mutation. */
export function inspect(_description: InspectionInput): Inspection {
  return {
    nodes: () => [],
    node: () => { throw new Error('Inspection lookup is not implemented'); },
    name: () => '',
    reference: () => [],
  };
}
