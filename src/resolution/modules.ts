import type { ModuleModel, NodeId } from '../model.js';
import type { ResolutionProblem, ProblemLocation } from './problem.js';
import { SourceIndex } from './source-index.js';

/** One call's supplied inventory and explicitly reached module snapshots. */
export class Modules {
  readonly reached: readonly SourceIndex[];
  readonly unanalyzed: ReadonlySet<NodeId>;
  readonly failures = new Map<string, readonly ResolutionProblem[]>();
  readonly problems: ResolutionProblem[] = [];

  constructor(entry: ModuleModel, supplied: readonly ModuleModel[]) {
    const inputs = [entry, ...supplied].map(inspection => new SourceIndex(inspection));
    const locations = inputs.map((_, index): ProblemLocation => ({
      kind: 'dependency', path: index === 0 ? ['entry', 'locator'] : ['modules', index - 1, 'locator'],
    }));
    const byLocator = new Map<string, SourceIndex>();
    const positions = new Map<string, number>();
    const sourceOwners = new Map<string, number>();
    const reject = (index: number, message: string, previous?: number) => {
      const problem: ResolutionProblem = {
        code: 'invalid-dependency-input', message, at: locations[index]!,
        related: previous === undefined ? [] : [locations[previous]!],
      };
      this.problems.push(problem);
      for (const owner of previous === undefined ? [index] : [previous, index]) {
        const locator = inputs[owner]!.locator;
        this.failures.set(locator, [...this.failures.get(locator) ?? [], problem]);
      }
    };
    inputs.forEach((input, index) => {
      if (typeof input.locator !== 'string' || !input.locator.length) reject(index, 'A module locator must be a nonempty exact key.');
      const prior = positions.get(input.locator);
      if (prior !== undefined) reject(index, `Module ${input.locator} is supplied more than once.`, prior);
      else { positions.set(input.locator, index); byLocator.set(input.locator, input); }

      const ownSources = new Set<string>();
      for (const node of input.nodes) {
        if (node.origin.kind !== 'builtin' && node.origin.module !== input.locator) {
          reject(index, 'A module inspection contains a different module origin.');
          break;
        }
        if (node.origin.kind === 'source') ownSources.add(node.origin.node.sourceId);
      }
      for (const source of ownSources) {
        const previous = sourceOwners.get(source);
        if (previous !== undefined && previous !== index && inputs[previous]!.locator !== input.locator) {
          reject(index, `Source identity ${source} is supplied by conflicting modules.`, previous);
        } else sourceOwners.set(source, index);
      }
    });
    const reached = new Map<string, SourceIndex>();
    const visit = (input: SourceIndex) => {
      if (reached.has(input.locator)) return;
      reached.set(input.locator, input);
      const targets = new Set<string>();
      for (const use of input.of('use')) {
        const locator = input.node(use.locator);
        if (locator.kind === 'string-literal') targets.add(locator.value);
      }
      for (const reference of input.of('reference')) {
        if (reference.lookup?.kind === 'module') targets.add(reference.lookup.locator);
      }
      for (const target of targets) {
        const dependency = byLocator.get(target);
        if (dependency && !this.failures.has(target)) visit(dependency);
      }
    };
    visit(inputs[0]!);
    this.reached = [inputs[0]!, ...[...reached.values()].filter(input => input !== inputs[0])
      .sort((a, b) => a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0)];
    const analyzed = new Set(this.reached.flatMap(input => input.nodes.map(node => node.id)));
    this.unanalyzed = new Set(inputs.flatMap(input => input.nodes.map(node => node.id)).filter(id => !analyzed.has(id)));
  }
}
