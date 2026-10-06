import { fromFact, mergeChecks, type Check } from './checking.js';
import type { ValueScope } from './expression-checker.js';
import type { Item } from '../model/inspection-item.js';
import { QueryError, type NodeId } from '../model/model.js';
import type { TypeCatalog } from './type-catalog.js';
import type { TypeId } from './types.js';

/** Answers lexical and receiver questions without exposing the source model. */
export class ExpressionLookup {
  constructor(private readonly declarations: Pick<TypeCatalog, 'inspection' | 'types' | 'typeOf' | 'fields' | 'callable'>) {}

  target(reference: Item<'reference'>): Check<Item> {
    const current = this.declarations.inspection.read(reference.id, 'reference'), binding = current.resolution;
    if (binding.status === 'not-analyzed') throw new QueryError('not-analyzed', current.id, 'Resolve the reference before checking its expression.');
    return binding.status === 'bound' ? { value: this.declarations.inspection.read(binding.target), problems: [], deferred: [] }
      : binding.status === 'invalid' ? { problems: binding.problems, deferred: [] }
      : { problems: [], deferred: [binding.requirement] };
  }

  value(reference: Item<'reference'>, scope?: ValueScope): Check<TypeId> {
    reference = this.declarations.inspection.read(reference.id, 'reference');
    const found = this.target(reference), binding = reference.resolution;
    if (found.problems.length) return mergeChecks(found);
    if (binding.status === 'deferred' && !['ordered-scope', 'contextual-result'].includes(binding.requirement.reason)) return mergeChecks(found);
    if (this.blockedDefault(reference, found.value)) return this.unavailable(reference);
    if (binding.status === 'deferred' && binding.requirement.reason === 'contextual-result') {
      const enclosing = [...this.ancestors(reference.id)], callable = enclosing.find(node => 'parameters' in node && 'body' in node);
      if (callable && 'parameters' in callable && callable.parameters.some(parameter => parameter.name === 'result')) {
        return this.supplied(reference, scope) ?? this.unavailable(reference);
      }
      if (!callable || !enclosing.some(node => node.kind === 'ensures')) return this.unavailable(reference);
      const result = fromFact(this.declarations.callable(callable.id).result);
      if (!result.value) return mergeChecks(result);
      return result.value.kind === 'value' ? { value: result.value.type, problems: [], deferred: [] }
        : result.value.kind === 'none' ? this.unavailable(reference)
        : { problems: [], deferred: [{ reason: 'declared-result', origin: reference.origin, requires: 'Contextual result needs a declared output type.' }] };
    }
    if (found.value && !['parameter', 'field', 'fixture', 'participant', 'let'].includes(found.value.kind)) return this.unavailable(reference);
    return this.supplied(reference, scope) ?? this.unavailable(reference);
  }

  parameters(callable: Item, before?: NodeId, outer?: ValueScope): ValueScope {
    callable = this.declarations.inspection.read(callable.id);
    if (!('parameters' in callable)) throw new QueryError('unexpected-kind', callable.id, 'Expected a declaration with parameters.');
    const parameters = callable.parameters, limit = before === undefined ? parameters.length : parameters.findIndex(parameter => parameter.id === before);
    if (limit < 0) throw new QueryError('unexpected-kind', before!, 'The default parameter must belong to this declaration.');
    return reference => {
      const binding = reference.resolution;
      if (binding.status === 'invalid' || binding.status === 'not-analyzed') return undefined;
      const index = parameters.findIndex(parameter => binding.status === 'bound' ? binding.target === parameter.id
        : reference.segments.length === 1 && reference.segments[0] === parameter.name);
      return index < 0 ? outer?.(reference) : index >= limit ? undefined
        : fromFact(this.declarations.typeOf(parameters[index]!.declaredType.id));
    };
  }

  member(owner: Item, name: string, at: Pick<Item, 'id' | 'origin'>, receiver?: TypeId, publicOnly = false): Check<{ declaration: Item; type?: TypeId }> {
    owner = this.declarations.inspection.read(owner.id);
    const occurrence = this.declarations.inspection.read(at.id);
    if (occurrence.kind === 'reference') {
      const resolution = this.target(occurrence);
      if (resolution.problems.length || occurrence.resolution.status === 'deferred'
        && occurrence.resolution.requirement.reason !== 'receiver-type'
        && !(publicOnly && occurrence.resolution.requirement.reason === 'interaction')) return mergeChecks(resolution);
    }
    const members: readonly Item[] = 'members' in owner ? owner.members : 'fields' in owner ? owner.fields : [];
    const candidates = members.map(member => member.kind === 'local' ? member.declaration : member)
      .filter(member => 'name' in member && member.name === name);
    const exposed = publicOnly ? members.flatMap(member => member.kind === 'public'
      ? member.references.filter(reference => reference.segments.length === 1 && reference.segments[0] === name).map(reference => this.target(reference)) : []) : [];
    const visibility = mergeChecks(...exposed);
    if (visibility.problems.length || visibility.deferred.length) return visibility;
    if ((!candidates.length || publicOnly && !exposed.length) && [...this.declarations.inspection.query('include'), ...this.declarations.inspection.query('extend')]
      .some(pending => sameModule(pending, owner) || sameModule(pending, at))) return {
      problems: [], deferred: [{ reason: 'composition', origin: at.origin, requires: 'Finish source composition before deciding whether this member exists.' }],
    };
    const declaration = candidates[0];
    if (candidates.length !== 1 || !declaration || !this.accessible(declaration, at)
      || publicOnly && (declaration.kind !== 'capability' || !exposed.some(entry => entry.value?.id === declaration.id))) return {
      problems: [{ code: 'invalid-member', message: 'No unambiguous accessible member supplies ' + name + '.', at: at.origin, related: candidates.map(candidate => candidate.origin) }], deferred: [],
    };
    if (declaration.kind !== 'field') return { value: { declaration }, problems: [], deferred: [] };
    if (!receiver) return { problems: [{ code: 'invalid-member', message: 'A field requires a receiver value.', at: at.origin, related: [declaration.origin] }], deferred: [] };
    const fields = fromFact(this.declarations.fields(receiver));
    if (!fields.value) return mergeChecks(fields);
    const field = fields.value.kind === 'available' ? fields.value.fields.find(field => field.declaration === declaration.id) : undefined;
    if (!field) return { problems: [{ code: 'invalid-member', message: 'The receiver does not expose this field.', at: at.origin, related: [declaration.origin] }], deferred: [] };
    const type = fromFact(field.type);
    return type.value ? { value: { declaration, type: type.value }, problems: type.problems, deferred: type.deferred } : mergeChecks(type);
  }

  *ancestors(id: NodeId): Iterable<Item> {
    for (let parent = this.declarations.inspection.parent(id); parent; parent = this.declarations.inspection.parent(parent.id)) yield parent;
  }

  private supplied(reference: Item<'reference'>, scope?: ValueScope): Check<TypeId> | undefined {
    const value = scope?.(reference);
    if (value?.value) this.declarations.types.describe(value.value);
    return value && !value.value && !value.problems.length && !value.deferred.length ? undefined : value;
  }
  private unavailable(reference: Item<'reference'>): Check<never> {
    return { problems: [{ code: 'unavailable-value', message: reference.segments.join('.') + ' has no available value here.', at: reference.origin, related: [] }], deferred: [] };
  }
  private blockedDefault(reference: Item<'reference'>, target?: Item): boolean {
    const enclosing = [...this.ancestors(reference.id)];
    const slot = enclosing.find((node): node is Item<'parameter' | 'field'> => (node.kind === 'parameter' || node.kind === 'field')
      && !!node.defaultValue && enclosing.some(ancestor => ancestor.id === node.defaultValue!.id));
    if (!slot) return false;
    if (slot.kind === 'field') return target?.kind === 'field'
      && this.declarations.inspection.parent(target.id)?.id === this.declarations.inspection.parent(slot.id)?.id;
    const owner = this.declarations.inspection.parent(slot.id);
    if (!owner || !('parameters' in owner)) return false;
    const current = owner.parameters.findIndex(parameter => parameter.id === slot.id);
    return owner.parameters.some((parameter, index) => index >= current
      && (parameter.id === target?.id || reference.segments.length === 1 && parameter.name === reference.segments[0]));
  }
  private accessible(declaration: Item, at: Pick<Item, 'id' | 'origin'>): boolean {
    for (const ancestor of this.ancestors(declaration.id)) {
      if (ancestor.kind !== 'local') continue;
      const owner = this.declarations.inspection.parent(ancestor.id);
      if (owner ? !this.within(at, owner) : !sameModule(declaration, at)) return false;
    }
    if (declaration.kind !== 'capability') return true;
    const owner = [...this.ancestors(declaration.id)].find(ancestor => ancestor.kind !== 'local');
    if (!owner || this.within(at, owner)) return true;
    return 'members' in owner && owner.members.some(member => member.kind === 'public'
      && member.references.some(reference => reference.resolution.status === 'bound' && reference.resolution.target === declaration.id));
  }
  private within(at: Pick<Item, 'id' | 'origin'>, owner: Item): boolean {
    return at.id === owner.id || [...this.ancestors(at.id)].some(ancestor => ancestor.id === owner.id
      || ancestor.kind === 'examples' && ancestor.subject?.resolution.status === 'bound' && sameModule(ancestor, owner)
      && (ancestor.subject.resolution.target === owner.id || [...this.ancestors(ancestor.subject.resolution.target)].some(subject => subject.id === owner.id)));
  }
}

function sameModule(left: Pick<Item, 'origin'>, right: Pick<Item, 'origin'>): boolean {
  return 'module' in left.origin && 'module' in right.origin && left.origin.module === right.origin.module;
}
