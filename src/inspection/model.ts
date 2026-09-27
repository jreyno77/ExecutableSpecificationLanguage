import type { SourceDescription, SourceNodeId, SourcePayload, SourceRange } from '../grammar/source.js';
import type { BuiltinName } from './builtins.js';
import type { ResolutionProblem } from '../resolution/problem.js';
import type { DeferredReference } from '../resolution/reference.js';

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
