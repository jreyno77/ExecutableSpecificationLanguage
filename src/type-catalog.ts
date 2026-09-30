import type { NodeId } from './inspection.js';
import type { Resolution } from './resolution.js';
import type { DeferredReference } from './resolution/reference-resolver.js';
import type { TypeDescription, TypeFact, TypeId, TypeProblem } from './type-description.js';

export interface TypedSlot { readonly declaration: NodeId; readonly type: TypeFact<TypeId> }
export type FieldShape = { readonly kind: 'available'; readonly fields: readonly TypedSlot[] } | { readonly kind: 'opaque' };
export type ResultDescription = { readonly kind: 'value'; readonly type: TypeId } | { readonly kind: 'none' } | { readonly kind: 'unspecified' };
export interface CallableDescription {
  readonly declaration: NodeId;
  readonly parameters: readonly TypedSlot[];
  readonly result: TypeFact<ResultDescription>;
  readonly problems: readonly TypeProblem[];
}
export interface ConstructionDescription {
  readonly declaration: NodeId;
  readonly parameters: readonly TypedSlot[];
  readonly problems: readonly TypeProblem[];
}
export interface TypeCatalog {
  readonly inspection: Resolution;
  typeDeclarations(): Iterable<NodeId>;
  callableDeclarations(): Iterable<NodeId>;
  declaredType(declaration: NodeId): TypeId;
  typeOf(expression: NodeId): TypeFact<TypeId>;
  describe(type: TypeId): TypeDescription;
  fields(type: TypeId): TypeFact<FieldShape>;
  callable(declaration: NodeId): CallableDescription;
  construction(owner: NodeId): TypeFact<ConstructionDescription | undefined>;
  readonly problems: readonly TypeProblem[];
  readonly deferred: readonly DeferredReference[];
}

export class TypeDescriber {
  describe(inspection: Resolution): TypeCatalog {
    throw new Error('Type analysis is not implemented.');
  }
}
