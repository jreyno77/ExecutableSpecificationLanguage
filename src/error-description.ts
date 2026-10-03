import type { Item } from './inspection-item.js';
import type { NodeId } from './model.js';
import type { TypeCatalog, TypedSlot } from './type-catalog.js';
import { failures, type TypeFact, type TypeProblem } from './type-description.js';
import { TypeQueryError, type TypeId } from './types.js';

export interface ErrorDescription {
  readonly declaration: NodeId;
  readonly codes: readonly string[];
  readonly fields: readonly TypedSlot[];
}
type Code = { value: string; at: Item };
type Catalog = Pick<TypeCatalog, 'describe' | 'fields' | 'typeOf' | 'inspection'>;

/** Interprets domain-error facts through the same nominal types and field slots. */
export class ErrorDescriptions {
  private readonly descriptions = new Map<TypeId, TypeFact<ErrorDescription>>();
  readonly #catalog: Catalog;
  constructor(catalog: Catalog) { this.#catalog = catalog; }

  error(type: TypeId): TypeFact<ErrorDescription> {
    const cached = this.descriptions.get(type);
    if (cached) return cached;
    let meaning = this.#catalog.describe(type);
    while (meaning.kind === 'alias') {
      if (meaning.target.status !== 'known') return meaning.target;
      meaning = this.#catalog.describe(meaning.target.value);
    }
    const node = meaning.kind === 'declared' ? this.#catalog.inspection.read(meaning.declaration) : undefined;
    if (node?.kind !== 'record-type-declaration' || !node.error) throw new TypeQueryError('wrong-kind', type, 'Expected a declared error type.');
    const shape = this.#catalog.fields(type);
    if (shape.status !== 'known') return shape;
    if (shape.value.kind !== 'available') throw new Error('An error record must expose its fields.');
    const fields = shape.value.fields, code = fields.filter(slot => this.#catalog.inspection.read(slot.declaration, 'field').name === 'code');
    let codes: TypeFact<readonly Code[]>;
    if (code.length !== 1) codes = invalid(node, 'An error type requires exactly one code field.', true);
    else {
      const field = this.#catalog.inspection.read(code[0]!.declaration, 'field'), fact = this.#catalog.typeOf(field.declaredType.id);
      codes = field.hasDefault ? invalid(field, 'An error code must be supplied explicitly.', true)
        : fact.status === 'known' ? this.codes(fact.value, field.declaredType) : fact;
    }
    const duplicates: TypeFact<never>[] = [], seen = new Map<string, Item>();
    if (codes.status === 'known') for (const code of codes.value) {
      const previous = seen.get(code.value);
      if (previous) duplicates.push(invalid(code.at, 'An error code is repeated.', false, previous));
      else seen.set(code.value, code.at);
    }
    const codeFailure = failures([codes, ...duplicates]);
    const result: TypeFact<ErrorDescription> = codeFailure
      ? failures([codeFailure, ...fields.map(slot => slot.type)])!
      : { status: 'known', value: { declaration: node.id, codes: [...seen.keys()], fields } };
    this.descriptions.set(type, result);
    return result;
  }

  private codes(type: TypeId, at: Item): TypeFact<readonly Code[]> {
    const meaning = this.#catalog.describe(type);
    if (meaning.kind === 'alias') return meaning.target.status === 'known' ? this.codes(meaning.target.value, at) : meaning.target;
    if (meaning.kind === 'union') {
      const parts = meaning.alternatives.map(type => this.codes(type, at));
      return failures(parts) ?? { status: 'known', value: parts.flatMap(part => part.status === 'known' ? part.value : []) };
    }
    if (meaning.kind === 'literal') {
      const literal = this.#catalog.inspection.read(meaning.expression, 'literal-type');
      return literal.value.kind === 'string-literal' && literal.value.value.trim()
        ? { status: 'known', value: [{ value: literal.value.value, at: literal }] }
        : invalid(literal, 'An error code must be nonblank text.');
    }
    return invalid(at, 'An error code requires a closed set of text literals.');
  }
}
function invalid(at: Item, message: string, name = false, related?: Item): TypeFact<never> {
  const problem: TypeProblem = { code: 'invalid-error-code', message,
    at: name && 'nameOrigin' in at ? at.nameOrigin : at.origin, related: related ? [related.origin] : [] };
  return { status: 'invalid', problems: [problem], deferred: [] };
}
