import type { ModuleModel } from '../model/model.js';
import { resolveModules, type Resolution, type ResolutionDependencies } from './resolution.js';
import { Modules } from './resolution/modules.js';
import { PackageAvailability } from './resolution/package-availability.js';
import type { ProblemLocation, ResolutionProblem } from './resolution/problem.js';

export type ModuleLocator = (owner: string, authoredLocator: string) => string | undefined;
type Entry = { readonly entry: ModuleModel; readonly dependencies: ResolutionDependencies };

export class SourceComposer {
  constructor(private readonly locate: ModuleLocator = (_owner, authored) => authored.trim() ? authored : undefined) {
    if (typeof locate !== 'function') throw new TypeError('A module locator must be a function.');
  }
  compose(entry: ModuleModel, dependencies: ResolutionDependencies): Resolution;
  compose(entries: readonly Entry[]): Resolution;
  compose(entry: ModuleModel | readonly Entry[], dependencies?: ResolutionDependencies): Resolution {
    if (!Array.isArray(entry)) return resolveModules(new Modules(entry as ModuleModel, dependencies!.modules, this.locate), dependencies!.packages);
    const input = inventory(entry), first = input.modules[0]!;
    const result = resolveModules(new Modules(first, input.modules.slice(1), this.locate, input), entry[0]!.dependencies.packages);
    const location = (at: ProblemLocation): ProblemLocation => at.kind === 'dependency' && at.path[0] === 'packages'
      ? { ...at, path: ['entries', 0, 'dependencies', ...at.path] } : at;
    return { ...result, problems: [...input.problems, ...result.problems.map(problem => ({ ...problem,
      at: location(problem.at), related: problem.related.map(location) }))] };
  }
}

/** A batch shares captured modules and package prerequisites, not lexical scopes. */
function inventory(entries: readonly Entry[]) {
  if (!entries.length) throw new TypeError('Provide at least one workspace entry.');
  const modules: ModuleModel[] = [], locations: ProblemLocation[] = [], roots: ModuleModel[] = [], problems: ResolutionProblem[] = [];
  const captured = new Set<ModuleModel>(), selected = new Map<string, ProblemLocation>();
  const at = (...path: (string | number)[]): ProblemLocation => ({ kind: 'dependency', path });
  const reject = (message: string, location: ProblemLocation, previous?: ProblemLocation) => problems.push({
    code: 'invalid-dependency-input', message, at: location, related: previous ? [previous] : [],
  });
  const packages = entries.map((row, index) => {
    if (!row || !row.dependencies || !Array.isArray(row.dependencies.modules) || !Array.isArray(row.dependencies.packages)) {
      throw new TypeError('Provide entry models with module and package arrays.');
    }
    const local = new Set<string>();
    for (const [ordinal, model] of [row.entry, ...row.dependencies.modules].entries()) {
      if (!model || typeof model.locator !== 'string' || !['roots', 'nodes', 'node', 'children', 'parent', 'resolution']
        .every(key => typeof model[key as 'roots'] === 'function')) throw new TypeError('Provide captured module models.');
      const location = ordinal === 0 ? at('entries', index, 'entry', 'locator')
        : at('entries', index, 'dependencies', 'modules', ordinal - 1, 'locator');
      if (!captured.has(model) || local.has(model.locator)) { modules.push(model); locations.push(location); }
      captured.add(model); local.add(model.locator);
      if (ordinal === 0) {
        const previous = selected.get(model.locator);
        if (previous) reject('A workspace entry is selected more than once.', location, previous);
        else { selected.set(model.locator, location); roots.push(model); }
      }
    }
    for (const item of row.dependencies.packages) {
      if (!item || typeof item.alias !== 'string' || !Array.isArray(item.phases)) throw new TypeError('Provide package aliases and phase arrays.');
    }
    const catalog = new PackageAvailability(row.dependencies.packages);
    if (index) for (const problem of catalog.problems) {
      const location = (value: ProblemLocation): ProblemLocation => value.kind === 'dependency'
        ? at('entries', index, 'dependencies', ...value.path) : value;
      problems.push({ ...problem, at: location(problem.at), related: problem.related.map(location) });
    }
    return catalog;
  });
  const first = entries[0]!.dependencies.packages;
  entries.slice(1).forEach((row, offset) => {
    const index = offset + 1, current = row.dependencies.packages;
    if (packages[0]!.problems.length || packages[index]!.problems.length) return;
    for (const alias of new Set([...first, ...current].map(item => item.alias))) {
      const old = first.findIndex(item => item.alias === alias), next = current.findIndex(item => item.alias === alias);
      if (old < 0 || next < 0) reject('Workspace entries require the same package aliases.',
        at('entries', index, 'dependencies', 'packages', ...(next < 0 ? [] : [next, 'alias'])),
        at('entries', 0, 'dependencies', 'packages', ...(old < 0 ? [] : [old, 'alias'])));
      else if (JSON.stringify([...first[old]!.phases].sort()) !== JSON.stringify([...current[next]!.phases].sort())) {
        reject('Workspace entries require the same package phases.', at('entries', index, 'dependencies', 'packages', next, 'phases'),
          at('entries', 0, 'dependencies', 'packages', old, 'phases'));
      }
    }
  });
  roots.sort((a, b) => a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0);
  return { modules, roots, locations, problems };
}
