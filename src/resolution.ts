import { builtinNames, createNodeId, isNodeId, propertyNames, type Model, type ModelNode, type ModuleModel, type NodeId, type ReferenceResolution } from './model.js';
import { IndexedModel } from './model-index.js';
import { Modules } from './resolution/modules.js';
import { PackageAvailability, type DependencyPackage } from './resolution/package-availability.js';
import { ScopeGraph } from './resolution/scopes.js';
import { ReferenceResolver, type DeferredReference } from './resolution/reference-resolver.js';
import type { ResolutionProblem } from './resolution/problem.js';

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
    const modules = new Modules(entry, dependencies.modules);
    const builtins = builtinModel();
    const scopes = new ScopeGraph(modules.reached, builtins, modules.failures);
    const packages = new PackageAvailability(dependencies.packages);
    const bindings = new Map<NodeId, ReferenceResolution>(scopes.imports);
    const problems = [...modules.problems, ...scopes.problems, ...packages.problems];
    const deferred: DeferredReference[] = [];
    for (const module of modules.reached) {
      new ReferenceResolver(module, scopes, packages, bindings, problems, deferred).analyze();
    }

    const primitiveNodes = builtins.nodes('builtin-type').flatMap(node => [node, builtins.node(node.name)]);
    const [main, ...reached] = modules.reached;
    const roots = [...main!.roots.map(node => node.id), ...builtins.roots(),
      ...reached.flatMap(module => module.roots.map(node => node.id))];
    const nodes = [...main!.nodes, ...primitiveNodes, ...reached.flatMap(module => module.nodes)];
    for (const node of nodes) {
      if (node.kind === 'reference' && !bindings.has(node.id)) throw new Error('An analyzed reference is missing its resolution outcome.');
    }
    const containment = new Map(modules.reached.flatMap(module => module.nodes.map(node =>
      [node.id, [...module.children(node.id)]] as const)));
    for (const node of primitiveNodes) containment.set(node.id, [...builtins.children(node.id)]);
    const outcomes = new Map([...bindings].map(([id, outcome]) => [id, capture(outcome)]));
    return { entry: entry.locator, model: new IndexedModel(roots, nodes.map(capture), outcomes, modules.unanalyzed, containment),
      problems: capture([...new Set(problems)]), deferred: capture(deferred) };
  }
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
function capture<T>(value: T): T {
  if (!value || typeof value !== 'object' || isNodeId(value)) return value;
  if (Array.isArray(value)) return value.map(capture) as T;
  return Object.fromEntries(propertyNames(value).map(key => [key, capture((value as Record<string, unknown>)[key])])) as T;
}
