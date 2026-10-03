import type { Check, Diagnostic, Requirement } from './checking.js';
import { ExpressionChecker, type ValueScope } from './expression-checker.js';
import { FixtureChecker } from './fixture-checker.js';
import type { SourceDocument, SyntaxDiagnostic } from './grammar/source.js';
import type { Inspection } from './inspection.js';
import { InteractionChecker, type Communication } from './interaction-checker.js';
import { LangiumModel } from './langium-model.js';
import { LangiumReader } from './langium/reader.js';
import type { Item } from './inspection-item.js';
import { QueryError, type NodeId, type NodeKind } from './model.js';
import { Resolver, type Resolution, type ResolutionDependencies } from './resolution.js';
import type { ProblemLocation } from './resolution/problem.js';
import { checkScenario, type ScenarioStep } from './scenario-checker.js';
import { TypeDescriber, type TypeCatalog } from './type-catalog.js';

export interface CompilationInput {
  readonly source: Readonly<SourceDocument>;
  readonly locator: string;
  readonly dependencies: ResolutionDependencies;
}
export interface Compilation extends Check<Specification> {
  readonly syntax: readonly SyntaxDiagnostic[];
}
export interface Specification {
  readonly entry: string;
  readonly inspection: Inspection;
  readonly types: TypeCatalog;
  message(message: NodeId): Check<Communication>;
  call(call: NodeId): Check<NodeId>;
  step(step: NodeId): Check<ScenarioStep>;
}

export class Compiler {
  private readonly reader = new LangiumReader();

  compile(input: CompilationInput): Compilation;
  compile(input: { readonly resolution: Resolution }): Compilation;
  compile(input: CompilationInput | { readonly resolution: Resolution }): Compilation {
    let resolution: Resolution;
    if ('resolution' in input) resolution = input.resolution;
    else {
      const read = this.reader.read(input.source);
      if (read.status === 'rejected') return { syntax: read.diagnostics, problems: [], deferred: [] };
      resolution = new Resolver().resolve(new LangiumModel(input.locator, read.document), input.dependencies);
    }
    const types = new TypeDescriber().describe(resolution), inspection = types.inspection;
    const expressions = new CheckedExpressions(types), fixtures = new FixtureChecker(types, expressions);
    const steps = new Map<NodeId, ScenarioStep>(), interactions = new InteractionChecker(types, expressions);
    const authored = <K extends NodeKind>(kind: K) => [...inspection.query(kind)].filter(node => node.origin.kind === 'source');
    const checks: Check<unknown>[] = [{ problems: resolution.problems, deferred: [] }, types];
    const covered = new Set<NodeId>();
    const check = (root: NodeId, result: Check<unknown>): void => { covered.add(root); checks.push(result); };
    const scope: ValueScope = reference => {
      if (reference.resolution.status !== 'bound') return undefined;
      const target = inspection.read(reference.resolution.target);
      if (target.kind !== 'fixture') return undefined;
      const result = fixtures.check(target.id);
      return { ...result, problems: result.problems.map(cause => ({ ...cause, related: [...cause.related, reference.origin] })) };
    };
    for (const kind of ['field', 'parameter'] as const) for (const node of authored(kind)) {
      if (!node.hasDefault || inspection.parent(node.id)?.kind === 'interaction') continue;
      checks.push(expressions.checkDefault(node.id, scope));
      if (node.defaultValue) covered.add(node.defaultValue.id);
    }
    for (const kind of ['function', 'capability'] as const) for (const node of authored(kind)) {
      checks.push(expressions.checkContract(node.id));
      if (node.body.kind === 'available') covered.add(node.body.content.id);
    }
    for (const node of authored('fixture')) check(node.value.id, fixtures.check(node.id));
    for (const kind of ['example', 'scenario'] as const) for (const node of authored(kind)) check(node.id, checkScenario(inspection, expressions, fixtures, node.id, steps));
    for (const node of authored('interaction')) check(node.id, interactions.check(node.id));
    const deferred: Requirement[] = [];
    for (const kind of ['setup', 'action', 'observation', 'check'] as const) for (const node of authored(kind)) {
      if (node.body.kind !== 'absent') deferred.push({ reason: 'helper-body',
        origin: node.body.kind === 'available' ? node.body.content.origin : node.origin,
        requires: 'Checking authored helper and check bodies is not implemented.' });
    }
    for (const kind of ['include', 'extend', 'examples-attachment'] as const) for (const node of authored(kind)) {
      deferred.push({ reason: 'composition', origin: node.origin,
        requires: 'Source composition must supply the declarations and ownership of the combined document.' });
    }
    // Contextual requirements belong to their checked construct, not to a global reason filter.
    for (const requirement of resolution.deferred) {
      let node = inspection.read(requirement.occurrence);
      while (!covered.has(node.id)) {
        const parent = inspection.parent(node.id);
        if (!parent) break;
        node = parent;
      }
      if (requirement.reason === 'composition' || !covered.has(node.id)) deferred.push(requirement);
    }
    const findings = combine([...checks, { problems: expressions.conflicts, deferred }]);
    const calls = new Map(expressions.calls);
    return { syntax: [], ...findings, ...(!findings.problems.length && !findings.deferred.length
      ? { value: { entry: resolution.entry, inspection, types, message: interactions.message.bind(interactions),
        call(id: NodeId): Check<NodeId> {
          const node = ungroup(inspection.read(id));
          if (node.kind !== 'call-expression') throw new QueryError('unexpected-kind', id, 'Expected a call expression.');
          const value = calls.get(node.id);
          if (!value) throw new QueryError('not-analyzed', id, 'This call has no checked operation.');
          return { value, problems: [], deferred: [] };
        },
        step(id: NodeId): Check<ScenarioStep> {
          const node = inspection.read(id);
          if (!['given', 'when', 'then'].includes(node.kind) || inspection.parent(id)?.kind !== 'scenario') {
            throw new QueryError('unexpected-kind', id, 'Expected a step belonging to a scenario.');
          }
          const value = steps.get(id);
          if (!value) throw new QueryError('not-analyzed', id, 'This step has no checked capture facts.');
          return { value: { available: value.available.map(capture => ({ ...capture })),
            ...(value.capture ? { capture: { ...value.capture } } : {}) }, problems: [], deferred: [] };
        } } } : {}) };
  }
}

/** Preserve one original finding and every related use without changing component reports. */
function combine(checks: readonly Check<unknown>[]): Check {
  const problems = new Map<string, Diagnostic>(), deferred = new Map<string, Requirement>();
  for (const check of checks) {
    for (const problem of check.problems) {
      const key = JSON.stringify([problem.code, problem.message, location(problem.at)]), previous = problems.get(key);
      const related = new Map([...previous?.related ?? [], ...problem.related].map(at => [location(at), at]));
      problems.set(key, { ...problem, related: [...related.values()] });
    }
    for (const requirement of check.deferred) {
      const key = JSON.stringify([requirement.reason, requirement.requires, location(requirement.origin)]);
      if (!deferred.has(key)) deferred.set(key, requirement);
    }
  }
  return { problems: [...problems.values()], deferred: [...deferred.values()] };
}

function location(at: ProblemLocation): string {
  switch (at.kind) {
    case 'source': return JSON.stringify([at.kind, at.module, at.node.sourceId, at.node.ordinal, at.range.sourceId,
      at.range.start.offset, at.range.start.line, at.range.start.column, at.range.end.offset, at.range.end.line, at.range.end.column]);
    case 'external': return JSON.stringify([at.kind, at.module, at.path]);
    case 'dependency': return JSON.stringify([at.kind, at.path]);
    case 'builtin': return JSON.stringify([at.kind, at.name]);
  }
}

/** Selection is captured in the checking context; query consumers never reconstruct that scope. */
class CheckedExpressions extends ExpressionChecker {
  readonly calls = new Map<NodeId, NodeId>();
  readonly conflicts: Diagnostic[] = [];
  constructor(private readonly catalog: TypeCatalog) { super(catalog); }
  override calledOperation(call: NodeId, scope?: ValueScope): Check<NodeId> {
    const result = super.calledOperation(call, scope);
    if (result.value && !result.problems.length && !result.deferred.length) {
      const node = ungroup(this.catalog.inspection.read(call)), previous = this.calls.get(node.id);
      if (previous && previous !== result.value) this.conflicts.push({ code: 'ambiguous-reference',
        message: 'The same call selected different operations while checking.', at: node.origin,
        related: [this.catalog.inspection.read(previous).origin, this.catalog.inspection.read(result.value).origin] });
      else this.calls.set(node.id, result.value);
    }
    return result;
  }
}
function ungroup(node: Item): Item { return node.kind === 'grouped-expression' ? ungroup(node.inner) : node; }
