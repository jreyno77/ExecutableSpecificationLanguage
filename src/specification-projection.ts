import { createHash } from 'node:crypto';
import type { Specification } from './compiler.js';
import type { Item } from './inspection-item.js';
import { propertyNames, type NodeId } from './model.js';
import { canonical, eligibleKinds, type IdentityBaseline, type IdentityRecord } from './identity-baseline.js';

const eligible = new Set<string>(eligibleKinds);
const metadata = new Set(['id', 'origin', 'nameOrigin', 'textOrigin', 'operatorRange', 'segmentOrigins', 'quoted', 'resolution']);
export const fingerprint = (data: unknown): string => 'sha256:' + createHash('sha256').update(canonical(data)).digest('hex');
const isItem = (value: unknown): value is Item => !!value && typeof value === 'object' && 'id' in value && 'kind' in value && 'origin' in value;
export interface Element {
  readonly item: Item;
  readonly owner: NodeId | undefined;
  readonly module: string;
  readonly name: string | null;
  readonly capture: string;
}

/** Projects the delivered readable tree; references stay links, never recursive expansions. */
export class SpecificationProjection {
  readonly elements: Element[] = [];
  readonly byNode = new Map<NodeId, Element>();
  private readonly hashes = new Map<NodeId, string>();
  private readonly references = new Map<NodeId, Set<string>>();
  private ids: ReadonlyMap<NodeId, string> = new Map();

  constructor(readonly specification: Specification) {
    const walk = (item: Item, owner: NodeId | undefined): void => {
      if (eligible.has(item.kind)) {
        if (item.origin.kind === 'builtin') throw new TypeError('An eligible declaration needs source or external provenance.');
        const element = { item, owner, module: item.origin.module, name: this.name(item), capture: fingerprint(this.language(item, 'capture')) };
        this.elements.push(element); this.byNode.set(item.id, element); owner = item.id;
      }
      for (const child of specification.inspection.children(item.id)) walk(child, owner);
    };
    for (const root of specification.inspection.roots()) walk(root, undefined);
  }
  name(item: Item): string | null { return 'name' in item ? item.name : 'title' in item ? item.title.value : null; }
  address(element: Element, ids: ReadonlyMap<NodeId, string>): IdentityRecord['address'] {
    return { module: element.module, owner: element.owner ? ids.get(element.owner)! : null,
      kind: element.item.kind as IdentityRecord['address']['kind'], name: element.name };
  }
  baseline(ids: ReadonlyMap<NodeId, string>, previous: IdentityBaseline | undefined, retired: readonly string[]): IdentityBaseline {
    this.ids = ids;
    const occurrences = new Map<string, number>(), modules = new Set([this.specification.entry]);
    const elements = this.elements.map(element => {
      const address = this.address(element, ids), key = canonical(address), occurrence = occurrences.get(key) ?? 0;
      occurrences.set(key, occurrence + 1); modules.add(element.module);
      const structure = this.structure(element.item);
      if (element.item.origin.kind === 'builtin') throw new TypeError('A builtin has no persistent identity.');
      return { id: ids.get(element.item.id)!, address, occurrence, capture: element.capture, structure,
        origin: element.item.origin, references: [...this.references.get(element.item.id)!].sort() };
    });
    const context = [...this.specification.inspection.roots()].filter(item => item.origin.kind !== 'builtin' && !eligible.has(item.kind))
      .map(item => {
        if (item.origin.kind !== 'builtin') modules.add(item.origin.module);
        return { module: item.origin.kind === 'builtin' ? '' : item.origin.module, value: this.language(item, 'structure') };
      }).sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);
    return { format: 1, projection: 'expec-structure-1', entry: this.specification.entry, modules: [...modules].sort(),
      context: fingerprint({ entry: this.specification.entry, roots: context }), elements, retired: [...retired].sort(), artifacts: previous?.artifacts ?? [] };
  }
  private structure(item: Item): string {
    let hash = this.hashes.get(item.id);
    if (hash) return hash;
    const references = new Set<string>();
    hash = fingerprint({ language: this.language(item, 'structure', references), context: this.containmentContext(item) });
    this.hashes.set(item.id, hash); this.references.set(item.id, references);
    return hash;
  }
  private containmentContext(item: Item): unknown[] {
    const context: unknown[] = [];
    for (let parent = this.specification.inspection.parent(item.id); parent; parent = this.specification.inspection.parent(parent.id)) {
      if (eligible.has(parent.kind)) break;
      if (parent.kind === 'builtin-type') { context.push({ builtin: parent.name }); break; }
      if (parent.kind === 'local') context.push({ local: true });
    }
    return context;
  }
  private language(item: Item, mode: 'capture' | 'structure', references = new Set<string>()): unknown {
    const covered = new Set<NodeId>(), data: Record<string, unknown> = {};
    const value = (input: unknown): unknown => {
      if (isItem(input)) {
        covered.add(input.id);
        if (mode === 'structure' && eligible.has(input.kind)) {
          const structure = this.structure(input);
          this.references.get(input.id)!.forEach(id => references.add(id));
          return { id: this.ids.get(input.id), kind: input.kind, name: this.name(input), structure };
        }
        return this.language(input, mode, references);
      }
      if (Array.isArray(input)) return input.map(value);
      if (input && typeof input === 'object') return Object.fromEntries(propertyNames(input).map(key => [key, value((input as Record<string, unknown>)[key])]));
      return input;
    };
    for (const key of propertyNames(item)) {
      if (metadata.has(key)) continue;
      const field = (item as unknown as Record<string, unknown>)[key];
      if (mode === 'structure' && eligible.has(item.kind) && (key === 'name' || key === 'title')) {
        if (isItem(field)) covered.add(field.id);
        continue;
      }
      data[key] = value(field);
    }
    if (mode === 'structure' && item.kind === 'reference' && item.resolution.status === 'bound') {
      const target = this.specification.inspection.read(item.resolution.target);
      if (target.kind === 'builtin-type') data.target = { builtin: target.name };
      else {
        const id = this.ids.get(target.id);
        if (id === undefined) throw new TypeError('A bound declaration has no eligible identity: ' + target.kind);
        data.target = { id }; references.add(id);
      }
    }
    const contained = [...this.specification.inspection.children(item.id)].filter(child =>
      !covered.has(child.id) && child.kind !== 'name' && !(item.kind === 'promises' && child.kind === 'string-literal'));
    if (contained.length) data.contained = contained.map(value);
    return data;
  }
}
