import { fromFact, mergeChecks, type Check } from './checking.js';
import type { ExpressionChecking, ValueScope } from './expression-checker.js';
import type { FixtureChecking } from './fixture-checker.js';
import type { Item } from './inspection-item.js';
import { QueryError, type NodeId, type Origin } from './model.js';
import type { TypeCatalog } from './type-catalog.js';
import type { TypeId } from './types.js';

export interface TestOperationChecking { check(operation: NodeId): Check }
export class TestOperationChecker implements TestOperationChecking {
  constructor(
    private readonly declarations: Pick<TypeCatalog, 'inspection' | 'callable'>,
    private readonly expressions: ExpressionChecking,
    private readonly fixtures: FixtureChecking,
  ) {}
  check(operation: NodeId): Check {
    const inspection = this.declarations.inspection, node = inspection.read(operation);
    if (node.kind !== 'setup' && node.kind !== 'action' && node.kind !== 'observation' && node.kind !== 'check') {
      throw new QueryError('unexpected-kind', operation, 'Expected a test operation.');
    }
    const signature = this.declarations.callable(operation), result = fromFact(signature.result);
    const checks: Check<unknown>[] = [result, ...signature.failures.map(fromFact), { problems: signature.problems, deferred: [] }, ...signature.parameters.map(parameter => fromFact(parameter.type))];
    if (node.body.kind === 'unavailable') return mergeChecks(...checks, {
      problems: [], deferred: [{ reason: 'test-operation-body', origin: node.origin, requires: 'Supply the test operation body before checking it.' }],
    });
    if (node.body.kind === 'absent') return mergeChecks(...checks);
    const locals = new Map<string, { declaration: Item; result: Check<TypeId> }>();
    const scope: ValueScope = reference => {
      const binding = reference.resolution;
      let value: Check<TypeId> | undefined;
      if (binding.status === 'deferred' && binding.requirement.reason === 'ordered-scope' && reference.segments.length === 1) {
        value = locals.get(reference.segments[0]!)?.result;
      } else if (binding.status === 'bound') {
        const parameter = signature.parameters.find(parameter => parameter.declaration === binding.target);
        if (parameter) value = fromFact(parameter.type);
        else if (inspection.read(binding.target).kind === 'fixture') value = this.fixtures.check(binding.target);
      }
      return value && { ...value, problems: value.problems.map(cause => ({ ...cause, related: [...new Set([...cause.related, reference.origin])] })) };
    };
    let returned: Item<'return'> | undefined;
    for (const statement of node.body.content.members) {
      if (returned) checks.push(problem('unreachable-statement', statement.origin, 'This statement follows a return.', [returned]));
      switch (statement.kind) {
        case 'let': {
          const value = this.expressions.typeOf(statement.value.id, scope);
          checks.push(value);
          const previous = locals.get(statement.name)?.declaration ?? node.parameters.find(parameter => parameter.name === statement.name);
          if (previous) checks.push(problem('duplicate-local', statement.nameOrigin, 'This name is already declared in this operation.', [previous]));
          else if (!returned) locals.set(statement.name, { declaration: statement,
            result: value.problems.length || value.deferred.length ? mergeChecks(value) : value });
          break;
        }
        case 'do': checks.push(this.expressions.checkCall(statement.expression.id, scope)); break;
        case 'assert': checks.push(this.expressions.checkExpectation(statement.expression.id, scope)); break;
        case 'return': {
          if (node.kind === 'check' || result.value?.kind === 'none') checks.push(problem('invalid-return', statement.origin, 'This operation cannot return a value.'));
          if (node.kind !== 'check' && result.value?.kind === 'unspecified') checks.push({ problems: [], deferred: [{
            reason: 'declared-result', origin: statement.origin, requires: 'Declare the operation result before checking its returned value.',
          }] });
          checks.push(result.value?.kind === 'value' ? this.expressions.checkValue(statement.expression.id, result.value.type, scope)
            : this.expressions.typeOf(statement.expression.id, scope));
          returned ??= statement;
          break;
        }
      }
    }
    if (result.value?.kind === 'value' && !returned) checks.push(problem('missing-return', node.origin, 'A value-producing body must return a value.'));
    if (node.kind === 'check' && !node.body.content.members.some(statement => statement.kind === 'assert')) {
      checks.push(problem('missing-assertion', node.origin, 'An authored check must contain an assertion.'));
    }
    return mergeChecks(...checks);
  }
}
function problem(code: string, at: Origin, message: string, related: readonly Item[] = []): Check {
  return { problems: [{ code, at, message, related: related.map(node => node.origin) }], deferred: [] };
}
