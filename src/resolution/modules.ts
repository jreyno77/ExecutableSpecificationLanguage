import type { ModelNode, ModuleModel, NodeId } from '../model.js';
import type { ModuleLocator } from '../source-composer.js';
import type { ResolutionProblem, ProblemLocation } from './problem.js';
import { SourceIndex } from './source-index.js';

/** One call's supplied inventory and explicitly reached module snapshots. */
export class Modules {
  readonly reached: readonly SourceIndex[];
  readonly unanalyzed: ReadonlySet<NodeId>;
  readonly failures = new Map<string, readonly ResolutionProblem[]>();
  readonly problems: ResolutionProblem[] = [];
  readonly includes = new Map<string, { readonly target: string; readonly directive: ModelNode<'include'> }[]>();
  readonly attachments = new Map<NodeId, string | undefined>();
  get composing(): boolean { return !!this.policy; }
  private readonly located = new Map<string, string | undefined>();

  constructor(entry: ModuleModel, supplied: readonly ModuleModel[], private readonly policy?: ModuleLocator) {
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
        if (locator.kind === 'string-literal') {
          const target = this.locate(input.locator, locator.value);
          if (target !== undefined) targets.add(target);
        }
      }
      for (const reference of input.of('reference')) {
        if (reference.lookup?.kind === 'module') {
          const target = this.locate(input.locator, reference.lookup.locator);
          if (target !== undefined) targets.add(target);
        }
      }
      if (policy) for (const directive of [...input.of('include'), ...input.of('examples-attachment')]) {
        const locator = input.node(directive.locator);
        if (locator.kind !== 'string-literal') throw new Error('An include locator must be text.');
        const target = this.locate(input.locator, locator.value);
        const failures = target === undefined || !byLocator.has(target)
          ? [{ code: 'unavailable-module' as const, message: 'No supplied module has locator ' + (target ?? locator.value) + '.',
              at: { kind: 'dependency' as const, path: ['modules', target ?? locator.value] }, related: [] }]
          : this.failures.get(target);
        if (directive.kind === 'examples-attachment') this.attachments.set(directive.id, failures?.length ? undefined : target);
        if (failures?.length) this.problems.push(...failures.map(problem => ({
          ...problem, at: locator.origin, related: [problem.at, ...problem.related],
        })));
        else {
          targets.add(target!);
          if (directive.kind === 'include') {
            const edges = this.includes.get(input.locator) ?? [];
            edges.push({ target: target!, directive });
            this.includes.set(input.locator, edges);
          }
        }
      }
      for (const target of targets) {
        const dependency = byLocator.get(target);
        if (dependency && !this.failures.has(target)) visit(dependency);
      }
    };
    visit(inputs[0]!);
    const ordered = [inputs[0]!, ...[...reached.values()].filter(input => input !== inputs[0])
      .sort((a, b) => a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0)];
    this.rejectIncludeCycles(ordered);
    const consumed = new Set([...this.includes.values()].flatMap(edges => edges.flatMap(({ directive }) => [directive.id, directive.locator])));
    this.reached = policy ? ordered.map(source => source.without(consumed)) : ordered;
    const analyzed = new Set(this.reached.flatMap(input => input.nodes.map(node => node.id)));
    this.unanalyzed = new Set(inputs.flatMap(input => input.nodes.map(node => node.id)).filter(id => !analyzed.has(id)));
  }

  locate(owner: string, authored: string): string | undefined {
    if (!this.policy) return authored;
    const key = JSON.stringify([owner, authored]);
    if (!this.located.has(key)) {
      const target = this.policy(owner, authored);
      if (target !== undefined && (typeof target !== 'string' || !target.trim())) {
        throw new TypeError('A module locator must return a nonblank key or undefined.');
      }
      this.located.set(key, target);
    }
    return this.located.get(key);
  }

  private rejectIncludeCycles(sources: readonly SourceIndex[]): void {
    const completed = new Set<string>(), active = new Map<string, number>();
    const path: ModelNode<'include'>[] = [];
    const visit = (locator: string): void => {
      if (completed.has(locator)) return;
      active.set(locator, path.length);
      const valid = [];
      for (const edge of this.includes.get(locator) ?? []) {
        const start = active.get(edge.target);
        if (start !== undefined) {
          this.problems.push({ code: 'include-cycle', message: 'Includes form a cycle through ' + edge.target + '.',
            at: edge.directive.origin, related: path.slice(start).map(node => node.origin) });
        } else {
          path.push(edge.directive); visit(edge.target); path.pop();
          valid.push(edge);
        }
      }
      this.includes.set(locator, valid);
      active.delete(locator); completed.add(locator);
    };
    for (const source of sources) visit(source.locator);
  }
}
