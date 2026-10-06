import type { Check } from '../compiler/checking.js';
import type { Specification } from '../compiler/compiler.js';
import type { SourceDocument } from '../language/grammar/source.js';
import { QueryError, type NodeId } from './model.js';
import { captured, canonical, failure, identifier, readBaseline, success, validateBaseline,
  type ArtifactAssociation, type IdentityBaseline, type IdentityRecord, type SpecIdentifier } from './identity-baseline.js';
import { SpecificationProjection, type Element } from './specification-projection.js';
export type { SpecIdentifier, JsonValue, ArtifactLocator, ArtifactAssociation, IdentityRecord, IdentityBaseline } from './identity-baseline.js';
export { reconcileRelationships } from './relationship-reconciliation.js';
export type { ObservedRelationship, RelationshipObservation, Reconciliation } from './relationship-reconciliation.js';

export type IdentityDecision = { readonly id: SpecIdentifier; readonly to: NodeId } | { readonly retire: SpecIdentifier };
export interface IdentifiedSpecification {
  readonly specification: Specification;
  readonly baseline: IdentityBaseline;
  id(node: NodeId): SpecIdentifier;
  node(id: SpecIdentifier): NodeId;
}
export interface SpecDiff {
  readonly changes: readonly { readonly id: SpecIdentifier; readonly kinds: readonly ('add' | 'remove' | 'rename' | 'move' | 'update' | 'artifacts')[];
    readonly before?: IdentityRecord; readonly after?: IdentityRecord }[];
  readonly affected: readonly SpecIdentifier[];
  readonly contextChanged: boolean;
}

/** Proposes durable correspondence and comparison without owning project files or writes. */
export class SpecificationIdentity {
  constructor(private readonly createId: () => string) { if (typeof createId !== 'function') throw new TypeError('Provide an ID factory.'); }
  read(input: SourceDocument): Check<IdentityBaseline> { return readBaseline(input); }
  write(baseline: IdentityBaseline): Check<string> {
    const check = validateBaseline(baseline);
    return check.value ? success(canonical(check.value, 2) + '\n') : { problems: check.problems, deferred: check.deferred };
  }
  associate(specification: Specification, previous?: IdentityBaseline, decisions: readonly IdentityDecision[] = []): Check<IdentifiedSpecification> {
    if (previous !== undefined) {
      const check = validateBaseline(previous);
      if (!check.value) return { problems: check.problems, deferred: check.deferred };
      previous = check.value;
    }
    const projection = new SpecificationProjection(specification), old = new Map(previous?.elements.map(record => [record.id, record]));
    const ids = new Map<NodeId, string>(), assigned = new Set<string>(), explicit = new Set<string>(), retire = new Set<string>();
    const problem = (message: string) => failure<IdentifiedSpecification>('identity-correspondence', message);
    for (const decision of decisions) {
      const id = 'retire' in decision ? decision.retire : decision.id;
      if (!old.has(id) || explicit.has(id)) return problem('Unknown or contradictory identity decision: ' + id);
      explicit.add(id);
      if ('retire' in decision) { retire.add(id); continue; }
      const node = specification.inspection.read(decision.to), element = projection.byNode.get(node.id);
      if (!element) throw new QueryError('unexpected-kind', node.id, 'This node is not a persistent subject.', undefined, node.kind);
      if (ids.has(node.id)) return problem('Two identifiers claim ' + element.name);
      ids.set(node.id, id); assigned.add(id);
    }
    const retired = new Set(previous?.retired);
    const retirement = new Map<string, boolean>();
    const isRetired = (record: IdentityRecord): boolean => {
      if (!retirement.has(record.id)) retirement.set(record.id, retire.has(record.id) || !explicit.has(record.id)
        && record.address.owner !== null && isRetired(old.get(record.address.owner)!));
      return retirement.get(record.id)!;
    };
    for (const record of old.values()) if (isRetired(record)) retired.add(record.id);
    const fresh = new Set<NodeId>(), occupied = new Set([...old.keys(), ...retired]);
    let temporary = 0, progress = true;
    const continuedAddress = (record: IdentityRecord, owners: ReadonlyMap<string, Element>): IdentityRecord['address'] => {
      const owner = record.address.owner, before = owner === null ? undefined : old.get(owner);
      const after = owner === null ? undefined : owners.get(owner);
      return before && after && record.address.module === before.address.module
        ? { ...record.address, module: after.module } : record.address;
    };
    while (progress) {
      progress = false;
      const owners = new Map(projection.elements.flatMap(element => ids.has(element.item.id) ? [[ids.get(element.item.id)!, element] as const] : []));
      const groups = new Map<string, Element[]>();
      for (const element of projection.elements) {
        if (ids.has(element.item.id) || element.owner && !ids.has(element.owner)) continue;
        const key = canonical(projection.address(element, ids)), group = groups.get(key) ?? [];
        group.push(element); groups.set(key, group);
      }
      const oldGroups = new Map<string, IdentityRecord[]>();
      for (const record of old.values()) if (!assigned.has(record.id) && !retired.has(record.id)) {
        const exact = canonical(record.address);
        const key = groups.has(exact) ? exact : canonical(continuedAddress(record, owners)), group = oldGroups.get(key) ?? [];
        group.push(record); oldGroups.set(key, group);
      }
      for (const [key, current] of groups) {
        const prior = (oldGroups.get(key) ?? []).sort((a, b) => a.occurrence - b.occurrence);
        if (prior.length && !(prior.length === 1 && current.length === 1)
          && canonical(prior.map(record => record.capture)) !== canonical(current.map(element => element.capture))) continue;
        current.forEach((element, index) => {
          let id = prior[index]?.id;
          if (id === undefined) {
            do { id = '~proposed-' + temporary++; } while (occupied.has(id));
            occupied.add(id); fresh.add(element.item.id);
          } else assigned.add(id);
          ids.set(element.item.id, id);
        });
        progress = true;
      }
    }
    const unmatched = [...old.values()].filter(record => !retired.has(record.id) && !assigned.has(record.id));
    if (unmatched.length) return problem('Explicit correspondence or retirement is required for ' +
      unmatched.map(record => record.address.name ?? record.address.kind).join(', '));
    if (ids.size !== projection.elements.length) return problem('Current subjects have unresolved owner correspondence.');
    const used = new Set([...old.keys(), ...retired]);
    for (const element of projection.elements) if (fresh.has(element.item.id)) {
      const id = this.createId();
      if (!identifier.safeParse(id).success || used.has(id)) throw new TypeError('The ID factory returned an invalid or reused identifier: ' + String(id));
      used.add(id); ids.set(element.item.id, id);
    }
    const checked = validateBaseline(projection.baseline(ids, previous, [...retired]));
    return checked.value ? success(identified(specification, checked.value, ids)) : { problems: checked.problems, deferred: checked.deferred };
  }
  withArtifacts(current: IdentifiedSpecification, artifacts: readonly ArtifactAssociation[]): Check<IdentifiedSpecification> {
    const check = validateBaseline({ ...current.baseline, artifacts });
    if (!check.value) return { problems: check.problems.map(problem => ({ ...problem, code: 'identity-association' })), deferred: [] };
    return success(Object.freeze({ ...current, baseline: check.value }));
  }
  compare(before: IdentityBaseline | undefined, after: IdentifiedSpecification): Check<SpecDiff> {
    if (before !== undefined) {
      const check = validateBaseline(before);
      if (!check.value) return { problems: check.problems, deferred: check.deferred };
      before = check.value;
    }
    const checked = validateBaseline(after.baseline);
    if (!checked.value) return { problems: checked.problems, deferred: checked.deferred };
    const current = checked.value, old = new Map(before?.elements.map(record => [record.id, record]));
    const next = new Map(current.elements.map(record => [record.id, record])), retired = new Set(current.retired);
    if (before?.retired.some(id => !retired.has(id)) || [...old.keys()].some(id => !next.has(id) && !retired.has(id))) {
      return failure('identity-correspondence', 'Comparison cannot discard old identities or resurrect retirements.');
    }
    const links = (baseline: IdentityBaseline | undefined, id: string): string =>
      canonical(baseline?.artifacts.filter(link => link.specId === id).map(link => canonical(link.locator)).sort() ?? []);
    const changes: SpecDiff['changes'][number][] = [];
    const all = new Set([...old.keys(), ...next.keys(), ...(before?.artifacts.map(link => link.specId) ?? []), ...current.artifacts.map(link => link.specId)]);
    for (const id of [...all].sort()) {
      const from = old.get(id), to = next.get(id), kinds: SpecDiff['changes'][number]['kinds'][number][] = [];
      if (!from && to) kinds.push('add');
      if (from && !to) kinds.push('remove');
      if (from && to) {
        if (from.address.name !== to.address.name) kinds.push('rename');
        if (from.address.module !== to.address.module || from.address.owner !== to.address.owner) kinds.push('move');
        if (from.structure !== to.structure || from.address.kind !== to.address.kind) kinds.push('update');
      }
      if (links(before, id) !== links(current, id)) kinds.push('artifacts');
      if (kinds.length) changes.push({ id, kinds, ...(from ? { before: from } : {}), ...(to ? { after: to } : {}) });
    }
    const changed = new Set(changes.map(change => change.id)), affected = new Set<string>(), queue = [...changed];
    const incoming = new Map<string, Set<string>>();
    for (const record of [...old.values(), ...next.values()]) for (const target of record.references) {
      const consumers = incoming.get(target) ?? new Set<string>(); consumers.add(record.id); incoming.set(target, consumers);
    }
    for (let index = 0; index < queue.length; index++) for (const consumer of incoming.get(queue[index]!) ?? []) {
      if (changed.has(consumer) || affected.has(consumer)) continue;
      affected.add(consumer); queue.push(consumer);
    }
    return success(captured({ changes, affected: [...affected].filter(id => next.has(id)).sort(), contextChanged: before?.context !== current.context }));
  }
}
function identified(specification: Specification, baseline: IdentityBaseline, ids: ReadonlyMap<NodeId, string>): IdentifiedSpecification {
  const nodes = new Map([...ids].map(([node, id]) => [id, node]));
  return Object.freeze({ specification, baseline,
    id(node: NodeId): string {
      const item = specification.inspection.read(node), id = ids.get(node);
      if (id === undefined) throw new QueryError('unexpected-kind', node, 'This node is not a persistent subject.', undefined, item.kind);
      return id;
    },
    node(id: string): NodeId {
      const node = nodes.get(id);
      if (!node) throw new RangeError('Unknown or retired specification identifier: ' + id);
      return node;
    },
  });
}
