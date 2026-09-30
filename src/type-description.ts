import { children, InspectionError, type InspectionNode, type NodeId } from './inspection.js';
import type { Resolution } from './resolution.js';
import type { DeferredReference } from './resolution/reference-resolver.js';
import type { ProblemLocation, ResolutionProblem } from './resolution/problem.js';
import type { FieldShape } from './type-catalog.js';

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

type Substitution = ReadonlyMap<NodeId, TypeId>;
const declarations = new Set(['concept', 'component', 'class', 'interface', 'record-type-declaration',
  'alias-type-declaration', 'opaque-type-declaration', 'type-parameter', 'builtin-type']);
const expressions = new Set(['named-type', 'tuple-type', 'union-type', 'optional-type', 'grouped-type', 'literal-type']);

/** Interprets finite syntax; nominal fields are substituted only when requested. */
export class TypeDescriptions {
  readonly ordered: readonly InspectionNode[];
  readonly parents = new Map<NodeId, NodeId>();
  readonly problems: TypeProblem[] = [];
  readonly deferred: DeferredReference[] = [];
  private readonly descriptions = new Map<TypeId, TypeDescription>();
  private readonly interned = new Map<string, TypeId>();
  private readonly ordinals = new Map<NodeId | TypeId, number>();
  private readonly findings = new Map<string, TypeProblem>();
  private readonly facts = new Map<NodeId, TypeFact<TypeId>>();

  constructor(readonly inspection: Resolution) {
    const nodes = new Map<NodeId, InspectionNode>();
    const visit = (id: NodeId): void => {
      if (nodes.has(id)) return;
      const node = inspection.node(id);
      nodes.set(id, node);
      for (const child of children(node)) { this.parents.set(child, id); visit(child); }
    };
    for (const root of inspection.roots()) visit(root);
    this.ordered = [...nodes.values()];
    for (const node of this.ordered) {
      if (declarations.has(node.payload.kind)) this.declaredType(node.id);
      if (expressions.has(node.payload.kind)) this.typeOf(node.id);
    }
    for (const fact of this.facts.values()) {
      const requirements = fact.status === 'deferred' ? fact.requirements : fact.status === 'invalid' ? fact.deferred : [];
      for (const requirement of requirements) if (!this.deferred.includes(requirement)) this.deferred.push(requirement);
    }
  }

  declaredType(declaration: NodeId): TypeId {
    const node = this.inspection.node(declaration);
    if (!declarations.has(node.payload.kind)) throw new InspectionError('unexpected-kind', declaration, 'Expected a type declaration.');
    const parameters = 'typeParameters' in node.payload ? node.payload.typeParameters : [];
    return this.apply(declaration, parameters.map(id => this.declaredType(id)), []);
  }
  typeOf(expression: NodeId): TypeFact<TypeId> {
    this.inspection.node(expression);
    let fact = this.facts.get(expression);
    if (!fact) { fact = this.evaluate(expression, new Map(), [], this.allowsNothing(expression)); this.facts.set(expression, fact); }
    return fact;
  }
  describe(type: TypeId): TypeDescription {
    const description = this.descriptions.get(type);
    if (!description) throw new TypeQueryError('unknown-type', type, 'This catalog did not issue the type handle.');
    return description;
  }
  fields(type: TypeId): TypeFact<FieldShape> {
    let meaning = this.describe(type);
    while (meaning.kind === 'alias') {
      if (meaning.target.status !== 'known') return meaning.target;
      meaning = this.describe(meaning.target.value);
    }
    if (meaning.kind !== 'declared') throw new TypeQueryError('wrong-kind', type, 'Expected a field-bearing declaration.');
    const declaration = this.inspection.node(meaning.declaration).payload;
    if (declaration.kind === 'opaque-type-declaration') return { status: 'known', value: { kind: 'opaque' } };
    const fields = ('fields' in declaration ? declaration.fields : 'members' in declaration ? declaration.members : [])
      .map(id => { const node = this.inspection.node(id); return node.payload.kind === 'local' ? node.payload.declaration : id; })
      .filter(id => this.inspection.node(id).payload.kind === 'field');
    const parameters = 'typeParameters' in declaration ? declaration.typeParameters : [];
    const arguments_ = meaning.arguments;
    const substitution = new Map(parameters.map((id, index) => [id, arguments_[index]!]));
    return { status: 'known', value: { kind: 'available', fields: fields.map(id => ({ declaration: id,
      type: this.evaluate(this.inspection.node(id, 'field').payload.declaredType, substitution, [], false) })) } };
  }

  private allowsNothing(id: NodeId): boolean {
    const parentId = this.parents.get(id);
    if (!parentId) return false;
    const parent = this.inspection.node(parentId).payload;
    return parent.kind === 'grouped-type' ? this.allowsNothing(parentId)
      : parent.kind === 'alias-type-declaration' || ('returnType' in parent && parent.returnType === id);
  }
  private key(prefix: string, ids: readonly (NodeId | TypeId)[]): string {
    return prefix + ':' + ids.map(id => {
      if (!this.ordinals.has(id)) this.ordinals.set(id, this.ordinals.size);
      return this.ordinals.get(id);
    }).join(',');
  }
  private intern(key: string, description: () => TypeDescription): TypeId {
    const existing = this.interned.get(key);
    if (existing) return existing;
    const id = Object.freeze({}) as TypeId;
    this.interned.set(key, id);
    this.descriptions.set(id, description());
    return id;
  }
  private apply(declaration: NodeId, arguments_: readonly TypeId[], aliases: readonly NodeId[]): TypeId {
    const p = this.inspection.node(declaration).payload;
    return this.intern(this.key('declaration', [declaration, ...arguments_]), () => {
      if (p.kind === 'type-parameter') return { kind: 'parameter', declaration };
      if (p.kind === 'alias-type-declaration') return { kind: 'alias', declaration, arguments: arguments_,
        target: this.evaluate(p.targetType, new Map(p.typeParameters.map((id, index) => [id, arguments_[index]!])), [...aliases, declaration], true) };
      return { kind: p.kind === 'builtin-type' ? 'builtin' : 'declared', declaration, arguments: arguments_ };
    });
  }
  private failure(code: TypeProblem['code'], id: NodeId, message: string, related: readonly NodeId[] = []): TypeFact<never> {
    const key = this.key(code, [id]);
    let problem = this.findings.get(key);
    if (!problem) {
      problem = { code, message, at: this.inspection.node(id).origin, related: related.map(id => this.inspection.node(id).origin) };
      this.findings.set(key, problem); this.problems.push(problem);
    }
    return { status: 'invalid', problems: [problem], deferred: [] };
  }
  private evaluate(id: NodeId, substitution: Substitution, aliases: readonly NodeId[], allowNothing: boolean): TypeFact<TypeId> {
    const p = this.inspection.node(id).payload;
    let fact: TypeFact<TypeId>;
    switch (p.kind) {
      case 'named-type': {
        const args = p.arguments.map(id => this.evaluate(id, substitution, aliases, false));
        const reference = this.inspection.node(p.reference, 'reference').payload.resolution;
        if (reference.status === 'not-analyzed') throw new InspectionError('not-analyzed', p.reference, 'Resolve the type reference before describing it.');
        if (reference.status === 'invalid') return failures([...args, { status: 'invalid', problems: reference.problems, deferred: [] }])!;
        if (reference.status === 'deferred') return failures([...args, { status: 'deferred', requirements: [reference.requirement] }])!;
        const target = this.inspection.node(reference.target).payload;
        const arity = 'typeParameters' in target ? target.typeParameters.length
          : target.kind === 'builtin-type' && this.inspection.name(target.name) === 'List' ? 1 : 0;
        if (arity !== args.length) args.push(this.failure('wrong-type-argument-count', id, `Expected ${arity} type arguments, received ${args.length}.`));
        const failed = failures(args);
        if (failed) return failed;
        if (target.kind === 'alias-type-declaration' && aliases.includes(reference.target)) return this.failure('circular-alias', id,
          'Transparent aliases form a cycle.', [...aliases.slice(aliases.indexOf(reference.target)), reference.target]);
        const type = substitution.get(reference.target) ?? this.apply(reference.target,
          args.map(arg => (arg as { status: 'known'; value: TypeId }).value), aliases);
        const description = this.describe(type);
        fact = description.kind === 'alias' && description.target.status !== 'known' ? description.target : { status: 'known', value: type };
        break;
      }
      case 'grouped-type': return this.evaluate(p.inner, substitution, aliases, allowNothing);
      case 'tuple-type': case 'union-type': {
        const parts = (p.kind === 'tuple-type' ? p.elements : p.alternatives).map(id => this.evaluate(id, substitution, aliases, false));
        const failed = failures(parts);
        if (failed) return failed;
        const types = parts.map(part => (part as { status: 'known'; value: TypeId }).value);
        fact = { status: 'known', value: this.intern(this.key(p.kind, types), () => p.kind === 'tuple-type'
          ? { kind: 'tuple', elements: types } : { kind: 'union', alternatives: types }) };
        break;
      }
      case 'optional-type': {
        const inner = this.evaluate(p.inner, substitution, aliases, false);
        if (inner.status !== 'known') return inner;
        fact = { status: 'known', value: this.intern(this.key('optional', [inner.value]), () => ({ kind: 'optional', inner: inner.value })) };
        break;
      }
      case 'literal-type': fact = { status: 'known', value: this.intern(this.key('literal', [id]), () => ({ kind: 'literal', expression: id })) }; break;
      default: throw new InspectionError('unexpected-kind', id, 'Expected a type expression.');
    }
    if (fact.status === 'known' && !allowNothing) {
      let meaning = this.describe(fact.value);
      while (meaning.kind === 'alias' && meaning.target.status === 'known') meaning = this.describe(meaning.target.value);
      if (meaning.kind === 'builtin' && this.inspection.name(this.inspection.node(meaning.declaration, 'builtin-type').payload.name) === 'Nothing') {
        return this.failure('invalid-nothing-use', id, 'Nothing is permitted only as a complete callable result or alias target.');
      }
    }
    return fact;
  }
}

/** Preserve all real causes when sibling inputs contain different failures. */
function failures(facts: readonly TypeFact<unknown>[]): Exclude<TypeFact<never>, { status: 'known' }> | undefined {
  const problems = [...new Set(facts.flatMap(fact => fact.status === 'invalid' ? fact.problems : []))];
  const deferred = [...new Set(facts.flatMap(fact => fact.status === 'invalid' ? fact.deferred : fact.status === 'deferred' ? fact.requirements : []))];
  return problems.length ? { status: 'invalid', problems, deferred } : deferred.length ? { status: 'deferred', requirements: deferred } : undefined;
}
