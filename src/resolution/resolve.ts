import type { InspectionNode, ModuleInspection, NodeId, ReferenceResolution } from '../inspection.js';
import { builtinInspection } from './builtins.js';
import { Modules } from './modules.js';
import { PackageAvailability, type DependencyPackage } from './package-availability.js';
import { ResolvedInspection, type Resolution } from './resolved-inspection.js';
import { ScopeGraph } from './scopes.js';
import { ReferenceResolver } from './reference-resolver.js';
import type { DeferredReference } from './reference.js';

export interface ResolutionDependencies {
  readonly modules: readonly ModuleInspection[];
  readonly packages: readonly DependencyPackage[];
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
