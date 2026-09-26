import type { SourceNodeId, SourceRange } from '../grammar/source.js';

type ReadonlyData<T> = { readonly [K in keyof T]: ReadonlyData<T[K]> };
export type NodeId = ReadonlyData<SourceNodeId>;
export type Range = ReadonlyData<SourceRange>;
declare const identity: unique symbol;
/** Opaque identity owned by one resolution report, never a cross-build identifier. */
export type DeclarationId = { readonly [identity]: true };
export type BuiltinName = 'Text' | 'Number' | 'Boolean' | 'List' | 'Nothing';
export type DeclarationKind =
  | 'concept' | 'component' | 'class' | 'interface'
  | 'record-type' | 'alias-type' | 'opaque-type' | 'type-parameter' | 'builtin-type'
  | 'capability' | 'function' | 'setup' | 'action' | 'observation' | 'check'
  | 'field' | 'parameter' | 'fixture' | 'participant';
export type DeclarationOrigin =
  | { readonly kind: 'source'; readonly node: NodeId; readonly range: Range }
  | { readonly kind: 'external'; readonly module: string; readonly declaration: string }
  | { readonly kind: 'builtin'; readonly name: BuiltinName };
export interface Declaration {
  readonly id: DeclarationId;
  readonly name: string;
  readonly kind: DeclarationKind;
  readonly owner?: DeclarationId;
  readonly origin: DeclarationOrigin;
}
export type ProblemLocation =
  | { readonly kind: 'source'; readonly range: Range }
  | { readonly kind: 'dependency'; readonly path: readonly (string | number)[] }
  | { readonly kind: 'builtin'; readonly name: BuiltinName };
export type ResolutionProblemCode =
  | 'unresolved-reference' | 'wrong-reference-kind' | 'ambiguous-reference'
  | 'duplicate-declaration' | 'inaccessible-reference' | 'unavailable-module'
  | 'unavailable-package' | 'invalid-dependency-catalog' | 'composition-required';
export interface ResolutionProblem {
  readonly code: ResolutionProblemCode;
  readonly message: string;
  readonly at: ProblemLocation;
  readonly related: readonly ProblemLocation[];
}
export type DeferredReason = 'receiver-type' | 'contextual-result' | 'ordered-scope' | 'composition' | 'interaction';
export interface DeferredReference {
  readonly occurrence: NodeId;
  readonly range: Range;
  readonly reason: DeferredReason;
  readonly requires: string;
}
export type ReferenceBinding =
  | { readonly status: 'bound'; readonly target: DeclarationId }
  | { readonly status: 'invalid'; readonly problems: readonly ResolutionProblem[] }
  | { readonly status: 'deferred'; readonly requirement: DeferredReference };
export interface Resolution {
  declarations(): Iterable<Declaration>;
  declaration(id: DeclarationId): Declaration;
  binding(occurrence: NodeId): ReferenceBinding;
  readonly problems: readonly ResolutionProblem[];
  readonly deferred: readonly DeferredReference[];
}
export type ResolutionQueryErrorCode = 'unknown-declaration' | 'foreign-source' | 'missing-node' | 'non-reference' | 'not-analyzed';
export class ResolutionQueryError extends Error {
  override readonly name = 'ResolutionQueryError';
  constructor(readonly code: ResolutionQueryErrorCode, message: string) { super(message); }
}
export type PackagePhase = 'build' | 'runtime' | 'test';
export type DependencyTarget =
  | { readonly kind: 'local'; readonly declaration: string }
  | { readonly kind: 'import'; readonly module: string; readonly path: readonly string[] }
  | { readonly kind: 'builtin'; readonly name: BuiltinName };
/** A required declaration link. Labels identify metadata, not an executable type schema. */
export interface DependencyLink {
  readonly label: string;
  readonly target: DependencyTarget;
}
export interface DependencyDeclaration {
  readonly id: string;
  readonly name: string;
  readonly kind: Exclude<DeclarationKind, 'builtin-type'>;
  readonly owner?: string;
  readonly local?: boolean;
  readonly links: readonly DependencyLink[];
}
export interface DependencyModule {
  readonly locator: string;
  readonly declarations: readonly DependencyDeclaration[];
  readonly exports: readonly { readonly path: readonly string[]; readonly declaration: string }[];
}
export interface DependencySnapshot {
  readonly modules: readonly DependencyModule[];
  readonly packages: readonly { readonly alias: string; readonly phases: readonly PackagePhase[] }[];
}

