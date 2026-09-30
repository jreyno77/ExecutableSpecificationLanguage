import { InspectionError, type InspectionNode, type NodeId } from './inspection.js';
import type { Resolution } from './resolution.js';
import type { DeferredReference } from './resolution/reference-resolver.js';
import { TypeDescriptions, type TypeDescription, type TypeFact, type TypeId, type TypeProblem } from './type-description.js';

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
  describe(inspection: Resolution): TypeCatalog { return new DescribedCatalog(inspection); }
}

const ownerKinds = ['concept', 'component', 'class', 'interface'];

/** Signature facts are captured once beside the same inspected declarations. */
class DescribedCatalog extends TypeDescriptions implements TypeCatalog {
  private readonly declarations: NodeId[] = [];
  private readonly callables = new Map<NodeId, CallableDescription>();
  private readonly constructions = new Map<NodeId, TypeFact<ConstructionDescription | undefined>>();
  private readonly local = new Set<NodeId>();

  constructor(inspection: Resolution) {
    super(inspection);
    for (const node of inspection.nodes('local')) this.local.add(node.payload.declaration);
    const publicCapabilities = new Set([...inspection.nodes('public')].flatMap(node => node.payload.references.flatMap(id => {
      const resolution = inspection.node(id, 'reference').payload.resolution;
      return resolution.status === 'bound' ? [resolution.target] : [];
    })));
    for (const node of this.ordered) {
      const p = node.payload;
      if ('typeParameters' in p || ownerKinds.includes(p.kind)) this.declarations.push(node.id);
      if ('parameters' in p && 'body' in p) {
        const signature = this.parameters(p.parameters);
        if (publicCapabilities.has(node.id)) {
          const expressions = [...p.parameters.map(id => inspection.node(id, 'parameter').payload.declaredType), ...(p.returnType ? [p.returnType] : [])];
          for (const expression of expressions) for (const declaration of this.exposed(expression)) signature.problems.push({
            code: 'private-type-exposure', message: 'A public capability signature exposes a local type.',
            at: inspection.node(expression).origin, related: [inspection.node(declaration).origin],
          });
        }
        this.callables.set(node.id, { declaration: node.id, ...signature,
          result: p.returnType ? this.result(this.typeOf(p.returnType)) : { status: 'known', value: { kind: 'unspecified' } } });
        this.problems.push(...signature.problems);
      }
      if (ownerKinds.includes(p.kind) && 'members' in p) {
        const constructors = p.members.map(id => inspection.node(id)).filter((member): member is InspectionNode<'construction'> => member.payload.kind === 'construction');
        if (!constructors.length) this.constructions.set(node.id, { status: 'known', value: undefined });
        else {
          const descriptions = constructors.map(construction => ({ declaration: construction.id, ...this.parameters(construction.payload.parameters) }));
          this.problems.push(...descriptions.flatMap(description => description.problems));
          if (constructors.length === 1) this.constructions.set(node.id, { status: 'known', value: descriptions[0]! });
          else {
            const origins = new Set(constructors.map(construction => construction.origin));
            const problems = inspection.problems.filter(problem => problem.code === 'duplicate-declaration' && problem.at.kind !== 'dependency' && origins.has(problem.at));
            if (!problems.length) throw new Error('Resolution must report duplicate construction.');
            this.constructions.set(node.id, { status: 'invalid', problems,
              deferred: [...new Set(descriptions.flatMap(description => description.parameters.flatMap(({ type }) =>
                type.status === 'deferred' ? type.requirements : type.status === 'invalid' ? type.deferred : [])))] });
          }
        }
      }
    }
  }

  typeDeclarations(): Iterable<NodeId> { return this.declarations; }
  callableDeclarations(): Iterable<NodeId> { return this.callables.keys(); }
  callable(declaration: NodeId): CallableDescription {
    const node = this.inspection.node(declaration);
    const description = this.callables.get(declaration);
    if (!description) throw new InspectionError('unexpected-kind', declaration, 'Expected a callable declaration.', undefined, node.payload.kind);
    return description;
  }
  construction(owner: NodeId): TypeFact<ConstructionDescription | undefined> {
    const node = this.inspection.node(owner);
    const construction = this.constructions.get(owner);
    if (!construction) throw new InspectionError('unexpected-kind', owner, 'Expected a concept, component, class or interface.', undefined, node.payload.kind);
    return construction;
  }

  private parameters(ids: readonly NodeId[]): { parameters: TypedSlot[]; problems: TypeProblem[] } {
    let defaulted: InspectionNode<'parameter'> | undefined;
    const problems: TypeProblem[] = [];
    const parameters = ids.map(id => {
      const node = this.inspection.node(id, 'parameter');
      if (node.payload.hasDefault) defaulted ??= node;
      else if (defaulted) problems.push({ code: 'required-after-default', message: 'A required parameter follows a defaulted parameter.',
        at: node.origin, related: [defaulted.origin] });
      return { declaration: id, type: this.typeOf(node.payload.declaredType) };
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
    return { status: 'known', value: type.kind === 'builtin' && this.inspection.name(this.inspection.node(type.declaration, 'builtin-type').payload.name) === 'Nothing'
      ? { kind: 'none' } : { kind: 'value', type: fact.value } };
  }

  private exposed(expression: NodeId, seen = new Set<NodeId>(), found = new Set<NodeId>()): ReadonlySet<NodeId> {
    if (seen.has(expression)) return found;
    seen.add(expression);
    const p = this.inspection.node(expression).payload;
    if (p.kind === 'named-type') {
      for (const argument of p.arguments) this.exposed(argument, seen, found);
      const resolution = this.inspection.node(p.reference, 'reference').payload.resolution;
      if (resolution.status === 'bound') {
        if (this.local.has(resolution.target)) found.add(resolution.target);
        const declaration = this.inspection.node(resolution.target).payload;
        if (declaration.kind === 'alias-type-declaration') this.exposed(declaration.targetType, seen, found);
      }
    } else if (p.kind === 'tuple-type' || p.kind === 'union-type') {
      for (const child of p.kind === 'tuple-type' ? p.elements : p.alternatives) this.exposed(child, seen, found);
    } else if (p.kind === 'optional-type' || p.kind === 'grouped-type') this.exposed(p.inner, seen, found);
    return found;
  }
}
