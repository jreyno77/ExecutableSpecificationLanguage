import { IndexedModel } from '../model-index.js';
import { propertyNames, type Model, type ModelNode, type ModuleModel, type NodeId, type ReferenceResolution } from '../model.js';
import type { Modules } from './modules.js';
import { PackageAvailability } from './package-availability.js';
import type { ResolutionProblem } from './problem.js';
import { ReferenceResolver } from './reference-resolver.js';
import { ScopeGraph } from './scopes.js';
import { SourceIndex } from './source-index.js';

/** Establishes effective containment; the ordinary resolver still owns name and access rules. */
export class Composition {
  readonly owners = new Map<NodeId, NodeId>();
  readonly omitted = new Set<NodeId>();
  readonly bindings = new Map<NodeId, ReferenceResolution>();
  readonly problems: ResolutionProblem[] = [];
  private readonly extensions = new Set<NodeId>();
  private readonly originals: readonly ModelNode[];
  private readonly sources = new Map<NodeId, SourceIndex>();
  model!: Model;
  reached!: readonly SourceIndex[];

  constructor(private readonly modules: Modules, private readonly builtins: Model) {
    this.originals = modules.reached.flatMap(source => source.nodes);
    for (const source of modules.reached) for (const node of source.nodes) this.sources.set(node.id, source);
    this.refresh();
    const extensions = this.originals.filter(node => node.kind === 'extend');
    // A target can itself be a declaration contributed by an earlier extension.
    for (;;) {
      const scopes = this.scopes();
      let changed = false;
      for (const extension of extensions) {
        if (this.extensions.has(extension.id)) continue;
        const selected = this.select(extension.target, true, scopes);
        if (selected.status !== 'bound') continue;
        this.extensions.add(extension.id);
        for (const member of extension.members) this.owners.set(member, selected.target);
        changed = true;
      }
      if (!changed) break;
      this.refresh();
    }
    const scopes = this.scopes();
    for (const extension of extensions) {
      const outcome = this.select(extension.target, true, scopes);
      if (outcome.status !== 'bound') { this.retain(outcome); this.omit(extension.id); }
      else {
        this.omitted.add(extension.id);
        this.omit(extension.target);
      }
    }
    this.refresh();
    this.attach(this.scopes());
    this.refresh();
  }

  private scopes(): ScopeGraph { return new ScopeGraph(this.reached, this.model, this.modules, this.owners); }

  private select(reference: NodeId, extension: boolean, scopes: ScopeGraph): ReferenceResolution {
    const source = this.reached.find(source => source.locator === this.sources.get(reference)!.locator)!;
    return new ReferenceResolver(source, scopes, new PackageAvailability([]), new Map(), [], [])
      .compositionTarget(reference, extension);
  }
  private retain(outcome: ReferenceResolution): void {
    if (outcome.status === 'invalid') this.problems.push(...outcome.problems);
  }
  private omit(id: NodeId): void {
    this.omitted.add(id);
    for (const child of this.sources.get(id)!.children(id)) this.omit(child);
  }

  private attach(scopes: ScopeGraph): void {
    const blocks = this.originals.filter(node => node.kind === 'examples').filter(node => !this.omitted.has(node.id));
    const claims = new Map<NodeId, { target: NodeId; reference: ModelNode }[]>();
    const invalid = new Set<NodeId>(), targeted = new Set<NodeId>();
    const add = (block: ModelNode<'examples'>, outcome: ReferenceResolution, reference: ModelNode): void => {
      if (outcome.status !== 'bound') { this.retain(outcome); return; }
      const entries = claims.get(block.id) ?? [];
      entries.push({ target: outcome.target, reference });
      claims.set(block.id, entries);
    };
    // File claims precede the explicit block claim, which owns a conflicting named subject's location.
    for (const directive of this.originals.filter(node => node.kind === 'examples-attachment')) {
      const source = this.sources.get(directive.id)!;
      const selected = this.select(directive.subject, false, scopes);
      this.retain(selected);
      const target = this.modules.attachments.get(directive.id);
      if (target !== undefined) {
        const roots = this.modules.reached.find(source => source.locator === target)!.roots.filter(node => node.kind === 'examples');
        if (!roots.length) this.problems.push({ code: 'empty-examples-source', message: 'The attached module has no direct examples block.',
          at: source.node(directive.locator).origin, related: [] });
        for (const block of roots) {
          targeted.add(block.id);
          add(block, selected, source.node(directive.subject));
        }
      }
      this.omit(directive.id);
    }
    for (const block of blocks) if (block.subject) {
      const outcome = this.select(block.subject, false, scopes);
      if (outcome.status !== 'bound') { invalid.add(block.id); this.retain(outcome); }
      else { this.bindings.set(block.subject, outcome); add(block, outcome, this.sources.get(block.id)!.node(block.subject)); }
    }
    for (const block of blocks) {
      const entries = claims.get(block.id) ?? [];
      for (let index = 1; index < entries.length; index++) {
        const current = entries[index]!, distinct = entries.slice(0, index).filter(previous => previous.target !== current.target);
        if (!distinct.length) continue;
        invalid.add(block.id);
        this.problems.push({ code: 'conflicting-example-subject', message: 'An examples block cannot belong to different subjects.',
          at: current.reference.origin, related: distinct.map(entry => entry.reference.origin) });
      }
      if (invalid.has(block.id) || targeted.has(block.id) && !entries.length) this.omit(block.id);
      else if (entries[0]) this.owners.set(block.id, entries[0].target);
    }
  }

  private refresh(): void {
    const parents = new Map(this.originals.map(node => [node.id, this.sources.get(node.id)!.parent(node.id)?.id] as const));
    const additions = new Map<NodeId, NodeId[]>();
    for (const [id, owner] of this.owners) if (!this.omitted.has(id)) additions.set(owner, [...additions.get(owner) ?? [], id]);
    const primitiveNodes = this.builtins.nodes('builtin-type').flatMap(node => [node, this.builtins.node(node.name)]);
    for (const node of primitiveNodes) parents.set(node.id, this.builtins.parent(node.id));
    const [entry, ...others] = this.modules.reached;
    const ordered = [...entry!.nodes, ...primitiveNodes, ...others.flatMap(source => source.nodes)];
    const nodes = ordered.filter(node => !this.omitted.has(node.id)).map(node => {
      if (!['concept', 'component', 'class', 'interface'].includes(node.kind) || !('members' in node)) return node;
      return { ...Object.fromEntries(propertyNames(node).map(key => [key, Reflect.get(node, key)])),
        members: [...node.members.filter(id => !this.omitted.has(id) && !this.owners.has(id)), ...additions.get(node.id) ?? []] } as unknown as ModelNode;
    });
    const containment = new Map(nodes.map(node => {
      const children = node.origin.kind === 'builtin' ? this.builtins.children(node.id) : this.sources.get(node.id)!.children(node.id);
      return [node.id, [...children.filter(id => !this.omitted.has(id) && !this.owners.has(id)), ...additions.get(node.id) ?? []]] as const;
    }));
    const roots = nodes.filter(node => !parents.get(node.id) && !this.owners.has(node.id)).map(node => node.id);
    const unanalyzed = new Set([...this.modules.unanalyzed, ...this.omitted]);
    this.model = new IndexedModel(roots, nodes, this.bindings, unanalyzed, containment);
    this.reached = this.modules.reached.map(source => {
      const model = this.model;
      const view: ModuleModel = { locator: source.locator, roots: () => roots.filter(id => {
        const origin = model.node(id).origin;
        return origin.kind !== 'builtin' && origin.module === source.locator;
      }), node: model.node.bind(model), nodes: model.nodes.bind(model), children: model.children.bind(model),
      parent: model.parent.bind(model), resolution: model.resolution.bind(model) };
      return new SourceIndex(view, new Set(), source.nodes.filter(node => !this.omitted.has(node.id)).map(node => node.id));
    });
  }
}
