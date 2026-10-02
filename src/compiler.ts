import type { Check, Diagnostic, Requirement } from './checking.js';
import { ExpressionChecker, type ValueScope } from './expression-checker.js';
import { FixtureChecker } from './fixture-checker.js';
import type { SourceDocument, SyntaxDiagnostic } from './grammar/source.js';
import type { Inspection } from './inspection.js';
import { InteractionChecker, type Communication } from './interaction-checker.js';
import { LangiumModel } from './langium-model.js';
import { LangiumReader } from './langium/reader.js';
import type { NodeId, NodeKind } from './model.js';
import { Resolver, type ResolutionDependencies } from './resolution.js';
import type { ProblemLocation } from './resolution/problem.js';
import { ScenarioChecker } from './scenario-checker.js';
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
}

export class Compiler {
  private readonly reader = new LangiumReader();

  compile(input: CompilationInput): Compilation {
    const read = this.reader.read(input.source);
    if (read.status === 'rejected') return { syntax: read.diagnostics, problems: [], deferred: [] };
    const resolution = new Resolver().resolve(new LangiumModel(input.locator, read.document), input.dependencies);
    const types = new TypeDescriber().describe(resolution), inspection = types.inspection;
    const expressions = new ExpressionChecker(types), fixtures = new FixtureChecker(types, expressions);
    const scenarios = new ScenarioChecker(inspection, expressions, fixtures), interactions = new InteractionChecker(types, expressions);
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
    for (const kind of ['example', 'scenario'] as const) for (const node of authored(kind)) check(node.id, scenarios.check(node.id));
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
    const findings = combine([...checks, { problems: [], deferred }]);
    return { syntax: [], ...findings, ...(!findings.problems.length && !findings.deferred.length
      ? { value: { entry: resolution.entry, inspection, types, message: interactions.message.bind(interactions) } } : {}) };
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
