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
export class DescriptionInspection implements Inspection {
  constructor(private readonly description: InspectionInput) {}

  nodes<K extends InspectionKind>(kind: K): Iterable<InspectionNode<K>> {
    const description = this.description;
    // The reader already supplies preorder. A fresh generator per iterator makes
    // each request replayable without indexing or sharing iteration progress.
    return {
      *[Symbol.iterator]() {
        for (const node of description.nodes) {
          if (node.payload.kind === kind) yield node as InspectionNode<K>;
        }
      },
    };
  }

  node(id: Readonly<SourceNodeId>): InspectionNode;
  node<K extends InspectionKind>(id: Readonly<SourceNodeId>, expectedKind: K): InspectionNode<K>;
  node(id: Readonly<SourceNodeId>, expectedKind?: InspectionKind): InspectionNode {
    if (id.sourceId !== this.description.sourceId) {
      throw new InspectionError('foreign-source', id,
        `Node belongs to "${id.sourceId}", not "${this.description.sourceId}".`);
    }
    const node = Number.isInteger(id.ordinal) && id.ordinal >= 0
      ? this.description.nodes[id.ordinal] : undefined;
    if (!node) {
      throw new InspectionError('missing-node', id,
        `No node at ordinal ${id.ordinal} in "${id.sourceId}".`);
    }
    if (expectedKind !== undefined && node.payload.kind !== expectedKind) {
      throw new InspectionError('unexpected-kind', id,
        `Expected ${expectedKind}, found ${node.payload.kind} at ordinal ${id.ordinal}.`,
        expectedKind, node.payload.kind);
    }
    // The derived public union expands grouped kind discriminants; runtime data
    // is the same source node. The checked overload establishes its narrower kind.
    return node as InspectionNode;
  }

  name(id: Readonly<SourceNodeId>): string {
    return this.node(id, 'name').payload.decoded;
  }

  reference(id: Readonly<SourceNodeId>): readonly string[] {
    return this.node(id, 'reference').payload.segments.map(segment => this.name(segment));
  }
}
