import type { AstNode } from 'langium';
import type { ExpecAstType } from '../language/langium/generated/ast.js';
import type { SourceNodeId, SourceRange } from '../language/grammar/source.js';
import type { ResolutionProblem } from '../compiler/resolution/problem.js';
import type { DeferredReference } from '../compiler/resolution/reference-resolver.js';

export const builtinNames = ['Text', 'Number', 'Boolean', 'List', 'Nothing'] as const;
export type BuiltinName = typeof builtinNames[number];
declare const identity: unique symbol;
export type NodeId = { readonly [identity]: true };
const identities = new WeakSet<object>();
export function createNodeId(): NodeId { const id = Object.freeze({}) as NodeId; identities.add(id); return id; }
export function isNodeId(value: unknown): value is NodeId { return typeof value === 'object' && value !== null && identities.has(value); }

export type Origin =
  | { readonly kind: 'source'; readonly module: string; readonly node: Readonly<SourceNodeId>; readonly range: SourceRange }
  | { readonly kind: 'external'; readonly module: string; readonly path: readonly (string | number)[] }
  | { readonly kind: 'builtin'; readonly name: BuiltinName };
export type ReferenceLookup = { readonly kind: 'builtin' | 'type-parameter' } | { readonly kind: 'module'; readonly locator: string };
export type ReferenceResolution =
  | { readonly status: 'not-analyzed' }
  | { readonly status: 'bound'; readonly target: NodeId }
  | { readonly status: 'invalid'; readonly problems: readonly ResolutionProblem[] }
  | { readonly status: 'deferred'; readonly requirement: DeferredReference };
export type CallableBody = { readonly kind: 'absent' } | { readonly kind: 'available'; readonly node: NodeId } | { readonly kind: 'unavailable' };

type Kebab<S extends string> = S extends `${infer First}${infer Rest}`
  ? `${Lowercase<First>}${Rest extends Uncapitalize<Rest> ? '' : '-'}${Kebab<Rest>}` : S;
export type LanguageNode = Exclude<Extract<ExpecAstType[keyof ExpecAstType], AstNode>, { $type: 'Source' }>;
export type KindOf<T extends AstNode> = T extends { kind: infer K extends string } ? K : Kebab<T['$type']>;
export type NodeKind = KindOf<LanguageNode> | 'type-parameter' | 'builtin-type';
export type LanguageFields<K extends NodeKind, T = LanguageNode> = T extends LanguageNode
  ? K extends KindOf<T> ? Omit<T, keyof AstNode | 'kind'> : never : never;
type Links<T> = T extends AstNode ? NodeId : T extends readonly (infer E)[] ? readonly Links<E>[]
  : T extends object ? { readonly [P in keyof T]: Links<T[P]> } : T;
type Fields<K extends NodeKind> =
  K extends 'type-parameter' | 'builtin-type' ? { readonly name: NodeId }
  : K extends 'reference' ? { readonly segments: readonly NodeId[]; readonly lookup?: ReferenceLookup }
  : K extends 'name' ? { readonly decoded: string; readonly quoted?: boolean }
  : K extends 'field' | 'parameter' ? Links<LanguageFields<K>> & { readonly hasDefault: boolean }
  : K extends 'capability' | 'function' | 'setup' | 'action' | 'observation' | 'check'
    ? Omit<Links<LanguageFields<K>>, 'body'> & { readonly body: CallableBody }
  : K extends 'unary-expression' | 'binary-expression' ? Links<LanguageFields<K>> & { readonly operatorRange: SourceRange }
  : Links<LanguageFields<K>>;
export type ModelNode<K extends NodeKind = NodeKind> = K extends NodeKind
  ? { readonly id: NodeId; readonly kind: K; readonly origin: Origin } & Fields<K> : never;

export interface Model {
  roots(): readonly NodeId[];
  nodes<K extends NodeKind>(kind: K): readonly ModelNode<K>[];
  node(id: NodeId): ModelNode;
  node<K extends NodeKind>(id: NodeId, kind: K): ModelNode<K>;
  children(id: NodeId): readonly NodeId[];
  parent(id: NodeId): NodeId | undefined;
  resolution(reference: NodeId): ReferenceResolution;
}
export interface ModuleModel extends Model { readonly locator: string }
export type QueryErrorCode = 'foreign-node' | 'missing-node' | 'unexpected-kind' | 'not-analyzed';
export class QueryError extends Error {
  override readonly name = 'QueryError';
  constructor(readonly code: QueryErrorCode, readonly nodeId: NodeId, message: string,
    readonly expectedKind?: NodeKind, readonly actualKind?: NodeKind) { super(message); }
}

/** Internal data-field discovery also supports models implemented with class getters. */
export function propertyNames(value: object): string[] {
  const names = new Set<string>();
  for (let current: object | null = value; current && current !== Object.prototype; current = Object.getPrototypeOf(current) as object | null) {
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(current))) {
      if (name !== 'constructor' && (descriptor.get || typeof descriptor.value !== 'function')) names.add(name);
    }
  }
  return [...names];
}
