import type { SourceDescription, SourceNodeId, SourcePayload, SourceRange } from './grammar/source.js';
import type { ResolutionProblem } from './resolution/problem.js';
import type { DeferredReference } from './resolution/reference-resolver.js';

/** Fixed language primitives, shared by inspection input and resolution. */
export const builtinNames = ['Text', 'Number', 'Boolean', 'List', 'Nothing'] as const;
export type BuiltinName = typeof builtinNames[number];

declare const identity: unique symbol;
export type NodeId = { readonly [identity]: true };
type ReadonlyData<T> = { readonly [P in keyof T]: ReadonlyData<T[P]> };
export type InspectionInput = ReadonlyData<SourceDescription>;
export type Origin =
  | { readonly kind: 'source'; readonly module: string; readonly node: Readonly<SourceNodeId>; readonly range: SourceRange }
  | { readonly kind: 'external'; readonly module: string; readonly path: readonly (string | number)[] }
  | { readonly kind: 'builtin'; readonly name: BuiltinName };
export type ReferenceLookup =
  | { readonly kind: 'builtin' }
  | { readonly kind: 'type-parameter' }
  | { readonly kind: 'module'; readonly locator: string };
export type ReferenceResolution =
  | { readonly status: 'not-analyzed' }
  | { readonly status: 'bound'; readonly target: NodeId }
  | { readonly status: 'invalid'; readonly problems: readonly ResolutionProblem[] }
  | { readonly status: 'deferred'; readonly requirement: DeferredReference };
export type CallableBody =
  | { readonly kind: 'absent' }
  | { readonly kind: 'available'; readonly node: NodeId }
  | { readonly kind: 'unavailable' };

type Handles<T> = T extends SourceNodeId ? NodeId : T extends readonly (infer E)[] ? readonly Handles<E>[]
  : T extends object ? { readonly [P in keyof T]: Handles<T[P]> } : T;
type SourceKind = SourcePayload['kind'];
export type InspectionKind = SourceKind | 'type-parameter' | 'builtin-type';
type SourcePayloadFor<K, P = SourcePayload> = P extends { kind: infer Kind }
  ? K extends Kind ? Handles<Omit<P, 'kind'>> & { readonly kind: K } : never : never;
type CommonPayload<K extends InspectionKind> =
  K extends 'reference' ? { readonly kind: K; readonly segments: readonly NodeId[]; readonly lookup?: ReferenceLookup; readonly resolution: ReferenceResolution }
  : K extends 'type-parameter' | 'builtin-type' ? { readonly kind: K; readonly name: NodeId }
  : K extends 'name' ? { readonly kind: K; readonly decoded: string; readonly quoted?: boolean }
  : K extends 'field' | 'parameter' ? SourcePayloadFor<K> & { readonly hasDefault: boolean }
  : K extends 'capability' | 'function' | 'setup' | 'action' | 'observation' | 'check'
    ? Omit<SourcePayloadFor<K>, 'body'> & { readonly body: CallableBody }
  : SourcePayloadFor<K>;
export type InspectionNode<K extends InspectionKind = InspectionKind> = K extends InspectionKind
  ? { readonly id: NodeId; readonly origin: Origin; readonly payload: CommonPayload<K> } : never;
export interface Inspection {
  roots(): Iterable<NodeId>;
  nodes<K extends InspectionKind>(kind: K): Iterable<InspectionNode<K>>;
  node(id: NodeId): InspectionNode;
  node<K extends InspectionKind>(id: NodeId, kind: K): InspectionNode<K>;
  name(id: NodeId): string;
  reference(id: NodeId): readonly string[];
}
export interface ModuleInspection extends Inspection { readonly locator: string }
export type InspectionErrorCode = 'foreign-node' | 'missing-node' | 'unexpected-kind' | 'not-analyzed';
export class InspectionError extends Error {
  override readonly name = 'InspectionError';
  constructor(readonly code: InspectionErrorCode, readonly nodeId: NodeId, message: string,
    readonly expectedKind?: InspectionKind, readonly actualKind?: InspectionKind) { super(message); }
}

const handles = new WeakSet<object>();
export function createNodeId(): NodeId {
  const id = Object.freeze({}) as NodeId;
  handles.add(id);
  return id;
}
/** Shared query mechanics for declared and enriched snapshot views. */
export class InspectionView implements Inspection {
  private readonly byId: ReadonlyMap<NodeId, InspectionNode>;
  constructor(private readonly rootIds: readonly NodeId[], private readonly orderedNodes: readonly InspectionNode[],
    private readonly unanalyzed: ReadonlySet<NodeId> = new Set()) {
    this.byId = new Map(orderedNodes.map(node => [node.id, node]));
  }
  roots(): Iterable<NodeId> { return this.rootIds; }
  nodes<K extends InspectionKind>(kind: K): Iterable<InspectionNode<K>> {
    const nodes = this.orderedNodes;
    return { *[Symbol.iterator]() { for (const node of nodes) if (node.payload.kind === kind) yield node as InspectionNode<K>; } };
  }
  node(id: NodeId): InspectionNode;
  node<K extends InspectionKind>(id: NodeId, kind: K): InspectionNode<K>;
  node(id: NodeId, kind?: InspectionKind): InspectionNode {
    const node = this.byId.get(id);
    if (!node) {
      const code = this.unanalyzed.has(id) ? 'not-analyzed' : typeof id === 'object' && id !== null && handles.has(id) ? 'foreign-node' : 'missing-node';
      throw new InspectionError(code, id, `The node is ${code} in this inspection.`);
    }
    if (kind !== undefined && node.payload.kind !== kind) throw new InspectionError('unexpected-kind', id,
      `Expected ${kind}, found ${node.payload.kind}.`, kind, node.payload.kind);
    return node;
  }
  name(id: NodeId): string { return this.node(id, 'name').payload.decoded; }
  reference(id: NodeId): readonly string[] { return this.node(id, 'reference').payload.segments.map(id => this.name(id)); }
}
