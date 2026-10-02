import { mergeChecks, type Check } from './checking.js';
import type { ExpressionChecking, ValueScope } from './expression-checker.js';
import type { FixtureChecking } from './fixture-checker.js';
import type { Inspection } from './inspection.js';
import type { Item } from './inspection-item.js';
import { QueryError, type NodeId } from './model.js';
import type { TypeId } from './types.js';

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
    const example = this.inspection.read(exampleOrScenario);
    if (example.kind !== 'example' && example.kind !== 'scenario') throw new QueryError('unexpected-kind', exampleOrScenario, 'Expected an example or scenario.');
    const captures = new Map<string, { name: Item<'name'>; result: Check<TypeId> }>();
    const scope: ValueScope = reference => {
      const binding = reference.resolution;
      let result: Check<TypeId> | undefined;
      if (binding.status === 'bound' && this.inspection.read(binding.target).kind === 'fixture') result = this.fixtures.check(binding.target);
      if (binding.status === 'deferred' && binding.requirement.reason === 'ordered-scope' && reference.segments.length === 1) {
        result = captures.get(reference.segments[0]!)?.result;
      }
      return result && { ...result, problems: result.problems.map(cause => ({ ...cause,
        related: [...new Set([...cause.related, reference.origin])],
      })) };
    };
    if (example.kind === 'example') return this.shortExample(example, scope);
    const checks: Check[] = [];
    for (const step of example.steps) {
      if (step.kind === 'then') {
        if (step.content.kind !== 'prose-expectation') checks.push(this.expressions.checkExpectation(step.content.id, scope));
        continue;
      }
      const selected = this.expressions.calledOperation(step.content.id, scope);
      const operation = selected.value && this.inspection.read(selected.value);
      const role = operation && operation.kind !== 'function' && operation.kind !== 'capability'
        && operation.kind !== (step.kind === 'given' ? 'setup' : 'action')
        ? problem('invalid-step-role', step.content, `A ${operation.kind} cannot be used in a ${step.kind} step.`, [operation]) : mergeChecks();
      if (!step.capture) { checks.push(mergeChecks(this.expressions.checkCall(step.content.id, scope), role)); continue; }
      const produced = this.expressions.typeOf(step.content.id, scope);
      const checked = mergeChecks(selected, produced, role);
      checks.push(checked);
      const previous = captures.get(step.capture.decoded);
      if (previous) checks.push(problem('duplicate-capture', step.capture, 'This scenario already captures ' + step.capture.decoded + '.', [previous.name]));
      else captures.set(step.capture.decoded, { name: step.capture, result:
        produced.value && !checked.problems.length && !checked.deferred.length ? { ...checked, value: produced.value } : checked });
    }
    return mergeChecks(...checks);
  }

  private shortExample(example: Item<'example'>, scope: ValueScope): Check {
    if (example.expected.kind === 'prose-expectation') return mergeChecks(ungroup(example.actual).kind === 'call-expression'
      ? this.expressions.checkCall(example.actual.id, scope) : this.expressions.typeOf(example.actual.id, scope));
    const actual = this.expressions.typeOf(example.actual.id, scope);
    return mergeChecks(actual, actual.value ? this.expressions.checkValue(example.expected.id, actual.value, scope)
      : this.expressions.typeOf(example.expected.id, scope));
  }
}

function ungroup(node: Item): Item { return node.kind === 'grouped-expression' ? ungroup(node.inner) : node; }
function problem(code: string, at: Item, message: string, related: readonly Item[] = []): Check {
  return { problems: [{ code, message, at: at.origin, related: related.map(node => node.origin) }], deferred: [] };
}
