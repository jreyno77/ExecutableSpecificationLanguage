import { builtinNames, createNodeId, isNodeId, propertyNames, type Model, type ModelNode, type ModuleModel, type NodeId, type ReferenceResolution } from '../model/model.js';
import { IndexedModel } from '../model/model-index.js';
import { Modules } from './resolution/modules.js';
import { PackageAvailability, type DependencyPackage } from './resolution/package-availability.js';
import { ScopeGraph } from './resolution/scopes.js';
import { ReferenceResolver, type DeferredReference } from './resolution/reference-resolver.js';
import type { ResolutionProblem } from './resolution/problem.js';
import { Composition } from './resolution/composition.js';
import type { Scope } from './resolution/scopes.js';

export interface ResolutionDependencies {
  readonly modules: readonly ModuleModel[];
  readonly packages: readonly DependencyPackage[];
}

/** Captured structural facts and the outcomes established by this resolution call. */
export interface Resolution {
  readonly entry: string;
  readonly model: Model;
  readonly problems: readonly ResolutionProblem[];
  readonly deferred: readonly DeferredReference[];
}

/** Adds reference facts to supplied models without changing their snapshots. */
export class Resolver {
  resolve(entry: ModuleModel, dependencies: ResolutionDependencies): Resolution {
    return resolveModules(new Modules(entry, dependencies.modules), dependencies.packages);
  }
}

/** Shared linking pipeline for ordinary resolution and explicitly composed modules. */
export function resolveModules(modules: Modules, suppliedPackages: readonly DependencyPackage[]): Resolution {
    const builtins = builtinModel();
    const composition = modules.composing ? new Composition(modules, builtins) : undefined;
    const sources = composition?.reached ?? modules.reached;
    const primitives = composition?.model ?? builtins;
    const scopes = new ScopeGraph(sources, primitives, modules, composition?.owners);
    const packages = new PackageAvailability(suppliedPackages);
    const bindings = new Map<NodeId, ReferenceResolution>(scopes.imports);
    for (const [id, outcome] of composition?.bindings ?? []) if (!composition?.omitted.has(id)) bindings.set(id, outcome);
    const problems = [...modules.problems, ...composition?.problems ?? [], ...scopes.problems, ...packages.problems];
    const deferred: DeferredReference[] = [];
    const contracts = { constructions: new Map<Scope, ModelNode>(), publicNames: new Map<Scope, Map<string, ModelNode>>() };
    for (const module of sources) {
      new ReferenceResolver(module, scopes, packages, bindings, problems, deferred, contracts).analyze();
    }

    const primitiveNodes = primitives.nodes('builtin-type').flatMap(node => [node, primitives.node(node.name)]);
    const [main, ...reached] = sources;
    const roots = composition?.model.roots() ?? [...main!.roots.map(node => node.id), ...builtins.roots(),
      ...reached.flatMap(module => module.roots.map(node => node.id))];
    const nodes = [...main!.nodes, ...primitiveNodes, ...reached.flatMap(module => module.nodes)];
    for (const node of nodes) {
      if (node.kind === 'reference' && !bindings.has(node.id)) throw new Error('An analyzed reference is missing its resolution outcome.');
    }
    const containment = new Map(sources.flatMap(module => module.nodes.map(node =>
      [node.id, [...module.children(node.id)]] as const)));
    for (const node of primitiveNodes) containment.set(node.id, [...primitives.children(node.id)]);
    const captured = new WeakMap<object, unknown>();
    const outcomes = new Map([...bindings].map(([id, outcome]) => [id, capture(outcome, captured)]));
    return { entry: main!.locator, model: new IndexedModel(roots, nodes.map(node => capture(node, captured)), outcomes,
      new Set([...modules.unanalyzed, ...composition?.omitted ?? []]), containment),
      problems: capture([...new Set(problems)], captured), deferred: capture(deferred, captured) };
}

/** Primitive declarations participate in the same structural model as authored declarations. */
export function builtinModel(): Model {
  const nodes: ModelNode[] = [];
  const roots = builtinNames.map(name => {
    const origin = { kind: 'builtin' as const, name };
    const id = createNodeId(), nameId = createNodeId();
    nodes.push({ id, origin, kind: 'builtin-type', name: nameId },
      { id: nameId, origin, kind: 'name', decoded: name });
    return id;
  });
  return new IndexedModel(roots, nodes);
}

/** Materialize supplied getters and nested facts while retaining opaque identity handles. */
function capture<T>(value: T, captured: WeakMap<object, unknown>): T {
  if (!value || typeof value !== 'object' || isNodeId(value)) return value;
  if (captured.has(value)) return captured.get(value) as T;
  const copy: object = Array.isArray(value) ? [] : {};
  captured.set(value, copy);
  for (const key of propertyNames(value)) {
    (copy as Record<string, unknown>)[key] = capture((value as Record<string, unknown>)[key], captured);
  }
  return copy as T;
}
