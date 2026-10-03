import { ErrorDescriptions, type ErrorDescription } from './error-description.js';
import { TypeCompatibility } from './type-compatibility.js';
import { TypeQueryError } from './types.js';
import { QueryError, type ModelNode, type NodeId } from './model.js';
import type { Types } from './types.js';
import type { Inspection } from './inspection.js';
import { QueryInspection } from './query-inspection.js';
import type { Resolution } from './resolution.js';
import type { DeferredReference } from './resolution/reference-resolver.js';
import { TypeDescriptions, failures, type TypeDescription, type TypeFact, type TypeId, type TypeProblem } from './type-description.js';

export interface TypedSlot { readonly declaration: NodeId; readonly type: TypeFact<TypeId> }
export type FieldShape = { readonly kind: 'available'; readonly fields: readonly TypedSlot[] } | { readonly kind: 'opaque' };
export type ResultDescription = { readonly kind: 'value'; readonly type: TypeId } | { readonly kind: 'none' } | { readonly kind: 'unspecified' };
export interface CallableDescription {
  readonly declaration: NodeId;
  readonly parameters: readonly TypedSlot[];
  readonly result: TypeFact<ResultDescription>;
  readonly failures: readonly TypeFact<TypeId>[];
  readonly problems: readonly TypeProblem[];
}
export interface ConstructionDescription {
  readonly declaration: NodeId;
  readonly parameters: readonly TypedSlot[];
  readonly problems: readonly TypeProblem[];
}
export interface TypeCatalog {
  readonly types: Types;
  readonly inspection: Inspection;
  typeDeclarations(): Iterable<NodeId>;
  callableDeclarations(): Iterable<NodeId>;
  declaredType(declaration: NodeId): TypeId;
  typeOf(expression: NodeId): TypeFact<TypeId>;
  describe(type: TypeId): TypeDescription;
  fields(type: TypeId): TypeFact<FieldShape>;
  error(type: TypeId): TypeFact<ErrorDescription>;
  callable(declaration: NodeId): CallableDescription;
  construction(owner: NodeId): TypeFact<ConstructionDescription | undefined>;
  readonly problems: readonly TypeProblem[];
  readonly deferred: readonly DeferredReference[];
}

export class TypeDescriber {
  describe(resolution: Resolution): TypeCatalog { return new DescribedCatalog(resolution); }
}

const ownerKinds = ['concept', 'component', 'class', 'interface'];

/** Signature facts are captured once beside the same inspected declarations. */
class DescribedCatalog extends TypeDescriptions implements TypeCatalog {
  readonly inspection: Inspection;
  private readonly declarations: NodeId[] = [];
  private readonly callables = new Map<NodeId, CallableDescription>();
  private readonly constructions = new Map<NodeId, TypeFact<ConstructionDescription | undefined>>();
  private readonly local = new Set<NodeId>();
  private readonly errors: ErrorDescriptions;

  constructor(resolution: Resolution) {
    super(resolution.model);
    this.inspection = new QueryInspection(resolution.model);
    this.errors = new ErrorDescriptions(this);
    for (const node of this.ordered) if (node.kind === 'record-type-declaration' && node.error) this.retain(this.error(this.declaredType(node.id)));
    const model = resolution.model;
    for (const node of model.nodes('local')) this.local.add(node.declaration);
    const publicCapabilities = new Set([...model.nodes('public')].flatMap(node => node.references.flatMap(id => {
      const resolution = model.resolution(id);
      return resolution.status === 'bound' ? [resolution.target] : [];
    })));
    for (const node of this.ordered) {
      const p = node;
      if ('typeParameters' in p || ownerKinds.includes(p.kind)) this.declarations.push(node.id);
      if ('parameters' in p && 'body' in p) {
        const signature = this.parameters(p.parameters);
        if (publicCapabilities.has(node.id)) {
          const expressions = [...p.parameters.map(id => model.node(id, 'parameter').declaredType), ...(p.returnType ? [p.returnType] : []), ...p.failures];
          for (const expression of expressions) for (const declaration of this.exposed(expression)) signature.problems.push({
            code: 'private-type-exposure', message: 'A public capability signature exposes a local type.',
            at: model.node(expression).origin, related: [model.node(declaration).origin],
          });
        }
        const declaredFailures = p.failures.map(id => this.failureType(id));
        const compatibility = new TypeCompatibility(this);
        for (let index = 0; index < declaredFailures.length; index++) {
          const fact = declaredFailures[index]!;
          if (fact.status !== 'known') continue;
          const previous = declaredFailures.slice(0, index).findIndex(prior => prior.status === 'known'
            && compatibility.assignable(prior.value, fact.value).value === true
            && compatibility.assignable(fact.value, prior.value).value === true);
          if (previous >= 0) declaredFailures[index] = { status: 'invalid', deferred: [], problems: [{
            code: 'duplicate-failure', message: 'This error type is already declared as a failure.',
            at: model.node(p.failures[index]!).origin, related: [model.node(p.failures[previous]!).origin],
          }] };
        }
        declaredFailures.forEach(fact => this.retain(fact));
        this.callables.set(node.id, { declaration: node.id, ...signature, failures: declaredFailures,
          result: p.returnType ? this.result(this.typeOf(p.returnType)) : { status: 'known', value: { kind: 'unspecified' } } });
        this.problems.push(...signature.problems);
      }
      if (ownerKinds.includes(p.kind) && 'members' in p) {
        const constructors = p.members.map(id => model.node(id)).filter((member): member is ModelNode<'construction'> => member.kind === 'construction');
        if (!constructors.length) this.constructions.set(node.id, { status: 'known', value: undefined });
        else {
          const descriptions = constructors.map(construction => ({ declaration: construction.id, ...this.parameters(construction.parameters) }));
          this.problems.push(...descriptions.flatMap(description => description.problems));
          if (constructors.length === 1) this.constructions.set(node.id, { status: 'known', value: descriptions[0]! });
          else {
            const origins = new Set(constructors.map(construction => construction.origin));
            const problems = resolution.problems.filter(problem => problem.code === 'duplicate-declaration' && problem.at.kind !== 'dependency' && origins.has(problem.at));
            if (!problems.length) throw new Error('Resolution must report duplicate construction.');
            this.constructions.set(node.id, { status: 'invalid', problems,
              deferred: [...new Set(descriptions.flatMap(description => description.parameters.flatMap(({ type }) =>
                type.status === 'deferred' ? type.requirements : type.status === 'invalid' ? type.deferred : [])))] });
          }
        }
      }
    }
  }

  error(type: TypeId): TypeFact<ErrorDescription> { return this.errors.error(type); }
  private failureType(expression: NodeId): TypeFact<TypeId> {
    const type = this.typeOf(expression);
    if (type.status !== 'known') return type;
    try {
      const error = this.error(type.value);
      return failures([error, ...(error.status === 'known' ? error.value.fields.map(field => field.type) : [])]) ?? type;
    } catch (error) {
      if (!(error instanceof TypeQueryError) || error.code !== 'wrong-kind') throw error;
      return { status: 'invalid', deferred: [], problems: [{ code: 'invalid-failure-type',
        message: 'A declared failure must name an error type.', at: this.model.node(expression).origin, related: [] }] };
    }
  }
  private retain(fact: TypeFact<unknown>): void {
    if (fact.status === 'invalid') for (const problem of fact.problems) {
      if (problem.code === 'invalid-error-code' || problem.code === 'invalid-failure-type' || problem.code === 'duplicate-failure') {
        if (!this.problems.includes(problem)) this.problems.push(problem);
      }
    }
    for (const requirement of fact.status === 'known' ? [] : fact.status === 'invalid' ? fact.deferred : fact.requirements) {
      if (!this.deferred.includes(requirement)) this.deferred.push(requirement);
    }
  }

  typeDeclarations(): Iterable<NodeId> { return this.declarations; }
  callableDeclarations(): Iterable<NodeId> { return this.callables.keys(); }
  callable(declaration: NodeId): CallableDescription {
    const node = this.model.node(declaration);
    const description = this.callables.get(declaration);
    if (!description) throw new QueryError('unexpected-kind', declaration, 'Expected a callable declaration.', undefined, node.kind);
    return description;
  }
  construction(owner: NodeId): TypeFact<ConstructionDescription | undefined> {
    const node = this.model.node(owner);
    const construction = this.constructions.get(owner);
    if (!construction) throw new QueryError('unexpected-kind', owner, 'Expected a concept, component, class or interface.', undefined, node.kind);
    return construction;
  }

  private parameters(ids: readonly NodeId[]): { parameters: TypedSlot[]; problems: TypeProblem[] } {
    let defaulted: ModelNode<'parameter'> | undefined;
    const problems: TypeProblem[] = [];
    const parameters = ids.map(id => {
      const node = this.model.node(id, 'parameter');
      if (node.hasDefault) defaulted ??= node;
      else if (defaulted) problems.push({ code: 'required-after-default', message: 'A required parameter follows a defaulted parameter.',
        at: node.origin, related: [defaulted.origin] });
      return { declaration: id, type: this.typeOf(node.declaredType) };
    });
    return { parameters, problems };
  }

  private result(fact: TypeFact<TypeId>): TypeFact<ResultDescription> {
    if (fact.status !== 'known') return fact;
    let type = this.describe(fact.value);
    while (type.kind === 'alias') {
      if (type.target.status !== 'known') return type.target;
      type = this.describe(type.target.value);
    }
    return { status: 'known', value: type.kind === 'builtin' && this.model.node(this.model.node(type.declaration, 'builtin-type').name, 'name').decoded === 'Nothing'
      ? { kind: 'none' } : { kind: 'value', type: fact.value } };
  }

  private exposed(expression: NodeId, seen = new Set<NodeId>(), found = new Set<NodeId>()): ReadonlySet<NodeId> {
    if (seen.has(expression)) return found;
    seen.add(expression);
    const p = this.model.node(expression);
    if (p.kind === 'named-type') {
      for (const argument of p.arguments) this.exposed(argument, seen, found);
      const resolution = this.model.resolution(p.reference);
      if (resolution.status === 'bound') {
        if (this.local.has(resolution.target)) found.add(resolution.target);
        const declaration = this.model.node(resolution.target);
        if (declaration.kind === 'alias-type-declaration') this.exposed(declaration.targetType, seen, found);
      }
    } else if (p.kind === 'tuple-type' || p.kind === 'union-type') {
      for (const child of p.kind === 'tuple-type' ? p.elements : p.alternatives) this.exposed(child, seen, found);
    } else if (p.kind === 'optional-type' || p.kind === 'grouped-type') this.exposed(p.inner, seen, found);
    return found;
  }
}
