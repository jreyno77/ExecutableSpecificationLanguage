import { builtinNames, createNodeId, InspectionView, type Inspection, type InspectionNode, type ModuleInspection, type NodeId, type ReferenceResolution } from './inspection.js';
import { Modules } from './resolution/modules.js';
import { PackageAvailability, type DependencyPackage } from './resolution/package-availability.js';
import { ScopeGraph } from './resolution/scopes.js';
import { ReferenceResolver, type DeferredReference } from './resolution/reference-resolver.js';
import type { ResolutionProblem } from './resolution/problem.js';

export interface ResolutionDependencies {
  readonly modules: readonly ModuleInspection[];
  readonly packages: readonly DependencyPackage[];
}

/** The original inspected facts enriched with this call's reference outcomes. */
export interface Resolution extends Inspection {
  readonly entry: string;
  readonly problems: readonly ResolutionProblem[];
  readonly deferred: readonly DeferredReference[];
}

/** Adds reference facts to supplied inspections without changing their snapshots. */
export class Resolver {
  resolve(entry: ModuleInspection, dependencies: ResolutionDependencies): Resolution {
    const modules = new Modules(entry, dependencies.modules);
    const builtins = builtinInspection();
    const scopes = new ScopeGraph(modules.reached, builtins, modules.failures);
    const packages = new PackageAvailability(dependencies.packages);
    const bindings = new Map<NodeId, ReferenceResolution>(scopes.imports);
    const problems = [...modules.problems, ...scopes.problems, ...packages.problems];
    const deferred: DeferredReference[] = [];
    for (const module of modules.reached) {
      new ReferenceResolver(module, scopes, packages, bindings, problems, deferred).analyze();
    }

    const primitiveRoots = [...builtins.roots()];
    const primitiveNodes = [...builtins.nodes('builtin-type')].flatMap(node => [node, builtins.node(node.payload.name)]);
    const [main, ...reached] = modules.reached;
    const roots = [...main!.roots.map(node => node.id), ...primitiveRoots,
      ...reached.flatMap(module => module.roots.map(node => node.id))];
    const nodes = [...main!.nodes, ...primitiveNodes, ...reached.flatMap(module => module.nodes)]
      .map((node): InspectionNode => {
        if (node.payload.kind !== 'reference') return node;
        const resolution = bindings.get(node.id);
        if (!resolution) throw new Error('An analyzed reference is missing its resolution outcome.');
        return { ...node, payload: { ...node.payload, resolution } };
      });
    return new ResolvedInspection(entry.locator, roots, nodes, [...new Set(problems)], deferred, modules.unanalyzed);
  }
}

/** Captures this analysis; subsequent queries never revisit the supplied modules. */
class ResolvedInspection extends InspectionView implements Resolution {
  constructor(
    readonly entry: string,
    roots: readonly NodeId[],
    nodes: readonly InspectionNode[],
    readonly problems: readonly ResolutionProblem[],
    readonly deferred: readonly DeferredReference[],
    unanalyzed: ReadonlySet<NodeId>,
  ) { super(roots, nodes, unanalyzed); }
}

/** Primitive declarations participate in the common inspection graph. */
export function builtinInspection(): InspectionView {
  const nodes: InspectionNode[] = [];
  const roots = builtinNames.map(name => {
    const origin = { kind: 'builtin' as const, name };
    const id = createNodeId(), nameId = createNodeId();
    nodes.push({ id, origin, payload: { kind: 'builtin-type', name: nameId } },
      { id: nameId, origin, payload: { kind: 'name', decoded: name } });
    return id;
  });
  return new InspectionView(roots, nodes);
}
