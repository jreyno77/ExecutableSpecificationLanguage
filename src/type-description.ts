import type { NodeId } from './inspection.js';
import type { DeferredReference, ProblemLocation, ResolutionProblem } from './index.js';

declare const identity: unique symbol;
export type TypeId = { readonly [identity]: true };
export type TypeFact<T> =
  | { readonly status: 'known'; readonly value: T }
  | { readonly status: 'invalid'; readonly problems: readonly (ResolutionProblem | TypeProblem)[]; readonly deferred: readonly DeferredReference[] }
  | { readonly status: 'deferred'; readonly requirements: readonly DeferredReference[] };
export interface TypeProblem {
  readonly code: 'wrong-type-argument-count' | 'circular-alias' | 'invalid-nothing-use' | 'required-after-default' | 'private-type-exposure';
  readonly message: string;
  readonly at: ProblemLocation;
  readonly related: readonly ProblemLocation[];
}
export type TypeDescription =
  | { readonly kind: 'builtin' | 'declared'; readonly declaration: NodeId; readonly arguments: readonly TypeId[] }
  | { readonly kind: 'parameter'; readonly declaration: NodeId }
  | { readonly kind: 'alias'; readonly declaration: NodeId; readonly arguments: readonly TypeId[]; readonly target: TypeFact<TypeId> }
  | { readonly kind: 'tuple'; readonly elements: readonly TypeId[] }
  | { readonly kind: 'union'; readonly alternatives: readonly TypeId[] }
  | { readonly kind: 'optional'; readonly inner: TypeId }
  | { readonly kind: 'literal'; readonly expression: NodeId };
export class TypeQueryError extends Error {
  override readonly name = 'TypeQueryError';
  constructor(readonly code: 'unknown-type' | 'wrong-kind', readonly typeId: TypeId, message: string) { super(message); }
}
