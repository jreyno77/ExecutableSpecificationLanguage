import type { AstNode } from 'langium';
import type { Callable } from './langium/generated/ast.js';
import type { KindOf, LanguageFields, ModelNode, NodeId, NodeKind, Origin, ReferenceLookup, ReferenceResolution } from './model.js';

/** Readable views preserve authored facts and expose known identities through read(). */
export interface Inspection {
  query<K extends NodeKind>(kind: K): Iterable<Item<K>>;
  read(id: NodeId): Item;
  read<K extends NodeKind>(id: NodeId, kind: K): Item<K>;
}

type Views<T> = T extends AstNode ? Item<Extract<KindOf<T>, NodeKind>>
  : T extends readonly (infer E)[] ? readonly Views<E>[]
  : T extends object ? { readonly [P in keyof T]: Views<T[P]> } : T;
type Named<T> = T extends { name: AstNode } ? Omit<Views<T>, 'name'> & { readonly name: string; readonly nameOrigin: Origin } : Views<T>;
export type Body = { readonly kind: 'absent' } | { readonly kind: 'available'; readonly content: Item<KindOf<NonNullable<Callable['body']>>> } | { readonly kind: 'unavailable' };
type Details<K extends NodeKind> =
  K extends 'name' ? Pick<ModelNode<'name'>, 'decoded' | 'quoted'>
  : K extends 'unary-expression' | 'binary-expression' ? Named<LanguageFields<K>> & Pick<ModelNode<K>, 'operatorRange'>
  : K extends 'builtin-type' | 'type-parameter' ? { readonly name: string; readonly nameOrigin: Origin }
  : K extends 'reference' ? { readonly segments: readonly string[]; readonly segmentOrigins: readonly Origin[]; readonly lookup?: ReferenceLookup; readonly resolution: ReferenceResolution }
  : K extends 'promises' ? { readonly text: string; readonly textOrigin: Origin }
  : K extends 'capability' | 'function' | 'setup' | 'action' | 'observation' | 'check' ? Omit<Named<LanguageFields<K>>, 'body'> & { readonly body: Body }
  : K extends 'field' | 'parameter' ? Named<LanguageFields<K>> & { readonly hasDefault: boolean }
  : Named<LanguageFields<K>>;
export type Item<K extends NodeKind = NodeKind> = K extends NodeKind
  ? { readonly id: NodeId; readonly kind: K; readonly origin: Origin } & Details<K> : never;
