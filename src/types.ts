import type { NodeId } from './model.js';
import type { TypeFact } from './type-description.js';

declare const identity: unique symbol;
export type TypeId = { readonly [identity]: true };
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

/** Owns type identities and shapes; source interpretation and compatibility belong to callers. */
export class Types {
  private readonly descriptions = new Map<TypeId, TypeDescription>();
  private readonly interned = new Map<string, TypeId>();
  private readonly ordinals = new Map<NodeId | TypeId, number>();

  describe(type: TypeId): TypeDescription {
    const description = this.descriptions.get(type);
    if (!description) throw new TypeQueryError('unknown-type', type, 'This type space did not issue the handle.');
    return description;
  }

  intern(description: TypeDescription): TypeId {
    const children = 'arguments' in description ? description.arguments : 'elements' in description ? description.elements
      : 'alternatives' in description ? description.alternatives : 'inner' in description ? [description.inner] : [];
    for (const child of children) this.describe(child);
    if (description.kind === 'alias' && description.target.status === 'known') this.describe(description.target.value);
    const parts = 'declaration' in description ? [description.declaration, ...children]
      : 'expression' in description ? [description.expression] : children;
    const key = description.kind + ':' + parts.map(id => {
      if (!this.ordinals.has(id)) this.ordinals.set(id, this.ordinals.size);
      return this.ordinals.get(id);
    }).join(',');
    const existing = this.interned.get(key);
    if (existing) return existing;
    const captured: TypeDescription = description.kind === 'alias'
      ? { ...description, arguments: Object.freeze([...description.arguments]), target: capture(description.target) }
      : 'arguments' in description ? { ...description, arguments: Object.freeze([...description.arguments]) }
      : 'elements' in description ? { ...description, elements: Object.freeze([...description.elements]) }
      : 'alternatives' in description ? { ...description, alternatives: Object.freeze([...description.alternatives]) }
      : { ...description };
    const id = Object.freeze({}) as TypeId;
    this.interned.set(key, id);
    this.descriptions.set(id, Object.freeze(captured));
    return id;
  }

  unionOf(alternatives: readonly TypeId[]): TypeId {
    if (!alternatives.length) throw new RangeError('A union requires at least one alternative.');
    const distinct = [...new Set(alternatives)];
    for (const type of distinct) this.describe(type);
    return distinct.length === 1 ? distinct[0]! : this.intern({ kind: 'union', alternatives: distinct });
  }
}

function capture<T>(fact: TypeFact<T>): TypeFact<T> {
  return Object.freeze(fact.status === 'known' ? { ...fact } : fact.status === 'deferred'
    ? { ...fact, requirements: Object.freeze([...fact.requirements]) }
    : { ...fact, problems: Object.freeze([...fact.problems]), deferred: Object.freeze([...fact.deferred]) });
}
