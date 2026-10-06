import { mergeChecks, type Check } from './checking.js';
import type { ExpressionChecking, ValueScope } from './expression-checker.js';
import type { FixtureChecking } from './fixture-checker.js';
import type { Inspection } from '../model/inspection.js';
import type { Item } from '../model/inspection-item.js';
import { QueryError, type NodeId } from '../model/model.js';
import type { TypeId } from './types.js';

export interface ScenarioCapture { readonly name: NodeId; readonly type: TypeId }
export interface ScenarioStep { readonly available: readonly ScenarioCapture[]; readonly capture?: ScenarioCapture }
export interface ScenarioChecking {
  check(exampleOrScenario: NodeId): Check;
}

export class ScenarioChecker implements ScenarioChecking {
  constructor(
    private readonly inspection: Inspection,
    private readonly expressions: ExpressionChecking,
    private readonly fixtures: FixtureChecking,
  ) {}
  check(exampleOrScenario: NodeId): Check {
    return checkScenario(this.inspection, this.expressions, this.fixtures, exampleOrScenario);
  }
}

/** Internal checking assembly can retain facts from the same ordered scope used for validation. */
export function checkScenario(inspection: Inspection, expressions: ExpressionChecking, fixtures: FixtureChecking,
  exampleOrScenario: NodeId, steps?: Map<NodeId, ScenarioStep>): Check {
  const example = inspection.read(exampleOrScenario);
  if (example.kind !== 'example' && example.kind !== 'scenario') throw new QueryError('unexpected-kind', exampleOrScenario, 'Expected an example or scenario.');
  const captures = new Map<string, { name: Item<'name'>; result: Check<TypeId> }>();
  const scope: ValueScope = reference => {
    const binding = reference.resolution;
    let result: Check<TypeId> | undefined;
    if (binding.status === 'bound' && inspection.read(binding.target).kind === 'fixture') result = fixtures.check(binding.target);
    if (binding.status === 'deferred' && binding.requirement.reason === 'ordered-scope' && reference.segments.length === 1) {
      result = captures.get(reference.segments[0]!)?.result;
    }
    return result && { ...result, problems: result.problems.map(cause => ({ ...cause,
      related: [...new Set([...cause.related, reference.origin])],
    })) };
  };
  if (example.kind === 'example') return shortExample(expressions, example, scope);
  const checks: Check[] = [];
  for (const step of example.steps) {
    const available = steps && [...captures.values()].flatMap(({ name, result }) => result.value ? [{ name: name.id, type: result.value }] : []);
    if (available) steps!.set(step.id, { available });
    if (step.kind === 'then') {
      if (step.content.kind !== 'prose-expectation') checks.push(expressions.checkExpectation(step.content.id, scope));
      continue;
    }
    const selected = expressions.calledOperation(step.content.id, scope);
    const operation = selected.value && inspection.read(selected.value);
    const role = operation && operation.kind !== 'function' && operation.kind !== 'capability'
      && operation.kind !== (step.kind === 'given' ? 'setup' : 'action')
      ? problem('invalid-step-role', step.content, `A ${operation.kind} cannot be used in a ${step.kind} step.`, [operation]) : mergeChecks();
    if (!step.capture) { checks.push(mergeChecks(expressions.checkCall(step.content.id, scope), role)); continue; }
    const produced = expressions.typeOf(step.content.id, scope);
    const checked = mergeChecks(selected, produced, role);
    checks.push(checked);
    const previous = captures.get(step.capture.decoded);
    if (previous) checks.push(problem('duplicate-capture', step.capture, 'This scenario already captures ' + step.capture.decoded + '.', [previous.name]));
    else {
      const result = produced.value && !checked.problems.length && !checked.deferred.length ? { ...checked, value: produced.value } : checked;
      captures.set(step.capture.decoded, { name: step.capture, result });
      if (available && result.value) steps!.set(step.id, { available, capture: { name: step.capture.id, type: result.value } });
    }
  }
  return mergeChecks(...checks);
}

function shortExample(expressions: ExpressionChecking, example: Item<'example'>, scope: ValueScope): Check {
  if (example.expected.kind === 'prose-expectation') return mergeChecks(ungroup(example.actual).kind === 'call-expression'
    ? expressions.checkCall(example.actual.id, scope) : expressions.typeOf(example.actual.id, scope));
  const actual = expressions.typeOf(example.actual.id, scope);
  return mergeChecks(actual, actual.value ? expressions.checkValue(example.expected.id, actual.value, scope)
    : expressions.typeOf(example.expected.id, scope));
}
function ungroup(node: Item): Item { return node.kind === 'grouped-expression' ? ungroup(node.inner) : node; }
function problem(code: string, at: Item, message: string, related: readonly Item[] = []): Check {
  return { problems: [{ code, message, at: at.origin, related: related.map(node => node.origin) }], deferred: [] };
}
