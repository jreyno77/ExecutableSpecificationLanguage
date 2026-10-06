import { fromFact, mergeChecks, type Check } from './checking.js';
import type { ExpressionChecking, ValueScope } from './expression-checker.js';
import type { Item } from '../model/inspection-item.js';
import type { NodeId } from '../model/model.js';
import type { TypeCatalog } from './type-catalog.js';
import type { TypeDescription, TypeId } from './types.js';

export interface FixtureChecking {
  check(fixture: NodeId): Check<TypeId>;
}

export class FixtureChecker implements FixtureChecking {
  constructor(
    private readonly declarations: Pick<TypeCatalog, 'inspection' | 'typeOf' | 'fields' | 'describe'>,
    private readonly expressions: ExpressionChecking,
  ) {}

  check(fixture: NodeId): Check<TypeId> {
    const completed = new Map<NodeId, Check<TypeId>>();
    const active: { fixture: Item<'fixture'>; reference?: Item<'reference'> }[] = [];
    const check = (node: Item<'fixture'>, reference?: Item<'reference'>): Check<TypeId> => {
      const cycle = active.findIndex(frame => frame.fixture.id === node.id);
      if (cycle >= 0) {
        const path = active.slice(cycle);
        return problem('fixture-cycle', reference ?? node,
          `Fixture data depends on itself: ${[...path.map(frame => frame.fixture.name), node.name].join(' → ')}.`,
          [...path.map(frame => frame.fixture), ...path.flatMap(frame => frame.reference ? [frame.reference] : [])]);
      }
      const existing = completed.get(node.id);
      if (existing) return existing;
      active.push({ fixture: node, ...(reference ? { reference } : {}) });
      const scope: ValueScope = occurrence => {
        if (occurrence.resolution.status !== 'bound') return undefined;
        const target = this.declarations.inspection.read(occurrence.resolution.target);
        if (target.kind !== 'fixture') return undefined;
        const result = check(target, occurrence);
        return { ...result, problems: result.problems.map(cause => ({ ...cause,
          related: [...new Set([...cause.related, occurrence.origin])],
        })) };
      };
      const type = fromFact(this.declarations.typeOf(node.declaredType.id));
      const checked = mergeChecks(type, type.value ? this.expressions.checkValue(node.value.id, type.value, scope)
        : this.expressions.typeOf(node.value.id, scope), this.data(node.value, type.value, scope));
      const result = type.value && !checked.problems.length && !checked.deferred.length ? { value: type.value, ...checked } : checked;
      active.pop();
      completed.set(node.id, result);
      return result;
    };
    return check(this.declarations.inspection.read(fixture, 'fixture'));
  }

  /** Restricts authored data; expression checking still owns compatibility and record selection. */
  private data(node: Item, expected: TypeId | undefined, scope: ValueScope): Check {
    if (node.kind === 'grouped-expression') return this.data(node.inner, expected, scope);
    const written = node.kind === 'record-expression' && node.declaredType;
    if (written) expected = fromFact(this.declarations.typeOf(written.id)).value;
    const shape = expected ? this.shape(expected) : undefined;
    if (!written && (node.kind === 'record-expression' || node.kind === 'list-expression')) {
      if (shape?.kind === 'optional') return this.data(node, shape.inner, scope);
      if (shape?.kind === 'union') {
        const accepted = shape.alternatives.filter(type => {
          const checked = this.expressions.checkValue(node.id, type, scope);
          return !checked.problems.length && !checked.deferred.length;
        });
        // Anonymous records must remain unambiguous. Lists can fit several collection alternatives.
        if (node.kind === 'record-expression') return this.data(node, accepted.length === 1 ? accepted[0] : undefined, scope);
        if (!accepted.length) return this.data(node, undefined, scope);
        const choices = accepted.map(type => this.data(node, type, scope));
        return choices.find(choice => !choice.problems.length && !choice.deferred.length) ?? mergeChecks(...choices);
      }
    }
    switch (node.kind) {
      case 'record-expression': {
        const fields = expected && shape?.kind === 'declared'
          ? fromFact(this.declarations.fields(expected)).value : undefined;
        const slots = fields?.kind === 'available' ? fields.fields : [];
        const named = slots.map(slot => ({ ...slot, declaration: this.declarations.inspection.read(slot.declaration, 'field') }));
        const entries = node.entries.map(entry => {
          const field = named.find(slot => slot.declaration.name === entry.name);
          return this.data(entry.value, field ? fromFact(field.type).value : undefined, scope);
        });
        const missing = named.flatMap(slot => {
          const type = fromFact(slot.type).value, shape = type ? this.shape(type) : undefined;
          return slot.declaration.hasDefault && !node.entries.some(entry => entry.name === slot.declaration.name)
            && shape && shape.kind !== 'optional'
            ? [problem('missing-fixture-data', node, `Supply fixture data for ${slot.declaration.name}; type defaults are not applied.`, [slot.declaration])] : [];
        });
        return mergeChecks(...entries, ...missing);
      }
      case 'list-expression': return mergeChecks(...node.elements.map((element, index) => this.data(element,
        shape?.kind === 'tuple' ? shape.elements[index] : shape?.kind === 'builtin'
          && this.declarations.inspection.read(shape.declaration, 'builtin-type').name === 'List' ? shape.arguments[0] : undefined, scope)));
      case 'call-expression': return mergeChecks(problem('runtime-call', node, 'Calls perform runtime work; use a scenario operation instead of fixture data.'),
        this.data(node.callee, undefined, scope), ...node.arguments.map(argument => this.data(argument, undefined, scope)));
      case 'member-expression': return this.data(node.receiver, undefined, scope);
      case 'unary-expression': return this.data(node.operand, undefined, scope);
      case 'binary-expression': return mergeChecks(this.data(node.left, undefined, scope), this.data(node.right, undefined, scope));
      default: return { problems: [], deferred: [] };
    }
  }

  private shape(type: TypeId): TypeDescription | undefined {
    const shape = this.declarations.describe(type);
    return shape.kind !== 'alias' ? shape : shape.target.status === 'known' ? this.shape(shape.target.value) : undefined;
  }
}

function problem(code: string, at: Item, message: string, related: readonly Item[] = []): Check {
  return { problems: [{ code, message, at: at.origin, related: related.map(node => node.origin) }], deferred: [] };
}
