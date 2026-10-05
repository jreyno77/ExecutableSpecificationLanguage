import type { Item } from '../model/inspection-item.js';
import { QueryError, type NodeId } from '../model/model.js';
import type { ResultDescription, TypeCatalog } from './type-catalog.js';
import type { TypeDescription, TypeId, TypeProblem } from './type-description.js';
import { fromFact, mergeChecks, type Check } from './checking.js';
import { TypeCompatibility } from './type-compatibility.js';
import { ExpressionLookup } from './expression-lookup.js';

export type ValueScope = (reference: Item<'reference'>) => Check<TypeId> | undefined;
export interface ExpressionChecking {
  calledOperation(call: NodeId, scope?: ValueScope): Check<NodeId>;
  publicCapability(receiver: TypeId, reference: NodeId): Check<NodeId>;
  checkArguments(operation: NodeId, arguments_: readonly NodeId[], at: NodeId, scope?: ValueScope): Check;
  typeOf(expression: NodeId, scope?: ValueScope): Check<TypeId>;
  checkValue(expression: NodeId, expected: TypeId, scope?: ValueScope): Check;
  checkCall(expression: NodeId, scope?: ValueScope): Check;
  checkCondition(expression: NodeId, scope?: ValueScope): Check;
  checkExpectation(expression: NodeId, scope?: ValueScope): Check;
  checkDefault(declaration: NodeId, scope?: ValueScope): Check;
  checkContract(callable: NodeId): Check;
}

export class ExpressionChecker implements ExpressionChecking {
  private readonly compatibility: TypeCompatibility;
  private readonly lookup: ExpressionLookup;
  constructor(private readonly declarations: Pick<TypeCatalog, 'inspection' | 'types' | 'describe' | 'declaredType' | 'typeOf' | 'fields' | 'callable'>) {
    this.compatibility = new TypeCompatibility(declarations);
    this.lookup = new ExpressionLookup(declarations);
  }
  typeOf(expression: NodeId, scope?: ValueScope): Check<TypeId> { return this.infer(this.read(expression), scope); }
  publicCapability(receiver: TypeId, reference: NodeId): Check<NodeId> {
    const selector = this.declarations.inspection.read(reference, 'reference'), shape = this.meaning(receiver);
    const binding = selector.resolution;
    const selectedName = binding.status === 'deferred' && ['interaction', 'receiver-type'].includes(binding.requirement.reason)
      ? empty() : this.lookup.target(selector);
    if (!shape.value || selectedName.problems.length || selectedName.deferred.length) return mergeChecks(shape, selectedName);
    const owner = shape.value.kind === 'declared' ? this.declarations.inspection.read(shape.value.declaration) : undefined;
    if (!owner || !['concept', 'component', 'class', 'interface'].includes(owner.kind) || selector.segments.length !== 1) {
      return problem('invalid-member', selector, 'A public capability requires one selector and a single concept-like receiver.');
    }
    const selected = this.lookup.member(owner, selector.segments[0]!, selector, receiver, true);
    return answer(selected.value?.declaration.id, selected);
  }
  checkArguments(operation: NodeId, arguments_: readonly NodeId[], at: NodeId, scope?: ValueScope): Check {
    const target = this.declarations.inspection.read(operation), invocation = this.declarations.inspection.read(at);
    if (!isCallable(target)) throw new QueryError('unexpected-kind', operation, 'Expected a callable declaration.');
    if (invocation.kind !== 'call-expression' && invocation.kind !== 'message') throw new QueryError('unexpected-kind', at, 'Expected a call or message.');
    const signature = this.declarations.callable(operation);
    const inputs = new Set(target.parameters.flatMap(parameter => [locationKey(parameter.origin), locationKey(parameter.declaredType.origin)]));
    const problems = signature.problems.filter(problem => inputs.has(locationKey(problem.at)));
    const checks: Check<unknown>[] = [{ problems, deferred: [] }, ...signature.failures.map(fromFact)];
    const missing = target.parameters.slice(arguments_.length).some(parameter => !parameter.hasDefault);
    if (missing || arguments_.length > signature.parameters.length) checks.push(problem('invalid-arity', invocation, 'The arguments do not match the callable parameters.', [target]));
    for (let index = 0; index < Math.max(arguments_.length, signature.parameters.length); index++) {
      const parameter = signature.parameters[index], argument = arguments_[index];
      const expected = parameter ? fromFact(parameter.type) : undefined;
      if (expected) checks.push(expected);
      if (argument) checks.push(this.infer(this.read(argument), scope, expected?.value));
    }
    return mergeChecks(...checks);
  }
  calledOperation(call: NodeId, scope?: ValueScope): Check<NodeId> {
    const node = ungroup(this.read(call));
    if (node.kind !== 'call-expression') return problem('invalid-purpose', node, 'Expected an operation call.');
    const selected = this.select(node.callee, scope);
    if (!selected.value) return mergeChecks(selected);
    return isCallable(selected.value.declaration) ? answer(selected.value.declaration.id, selected)
      : problem('invalid-purpose', node.callee, 'The selected declaration is not callable.');
  }
  checkValue(expression: NodeId, expected: TypeId, scope?: ValueScope): Check {
    this.declarations.types.describe(expected);
    const node = this.read(expression);
    return mergeChecks(this.valueType(expected, node), this.infer(node, scope, expected));
  }
  checkCall(expression: NodeId, scope?: ValueScope): Check {
    const node = ungroup(this.read(expression));
    if (node.kind !== 'call-expression') return problem('invalid-purpose', node, 'An effect must invoke a callable.');
    const call = this.call(node, scope);
    return mergeChecks(call, call.value?.kind === 'check' ? problem('invalid-purpose', node, 'A check invocation is an expectation, not an effect.') : empty());
  }
  checkCondition(expression: NodeId, scope?: ValueScope): Check {
    const node = this.read(expression), inferred = this.infer(node, scope);
    if (!inferred.value) return mergeChecks(inferred);
    const compatible = this.compatibility.assignable(inferred.value, this.builtin('Boolean'));
    return mergeChecks(inferred, compatible, compatible.value === false ? problem('invalid-purpose', node, 'A condition must produce Boolean.') : empty());
  }
  checkExpectation(expression: NodeId, scope?: ValueScope): Check {
    const node = ungroup(this.read(expression));
    if (node.kind === 'call-expression') {
      const call = this.call(node, scope);
      if (!call.value || call.value.kind === 'check') return mergeChecks(call);
    }
    return this.checkCondition(expression, scope);
  }
  checkDefault(declaration: NodeId, scope?: ValueScope): Check {
    const node = this.declarations.inspection.read(declaration);
    if (node.kind !== 'field' && node.kind !== 'parameter') throw new QueryError('unexpected-kind', declaration, 'Expected a field or parameter.');
    if (!node.hasDefault) return empty();
    const expected = fromFact(this.declarations.typeOf(node.declaredType.id));
    if (!node.defaultValue) return mergeChecks(expected, pending('default-body', node, 'The external declaration supplies no default expression to check.'));
    const owner = this.declarations.inspection.parent(node.id);
    const available = node.kind === 'parameter' && owner ? this.lookup.parameters(owner, node.id, scope) : scope;
    return mergeChecks(expected, this.infer(node.defaultValue, available, expected.value));
  }
  checkContract(callable: NodeId): Check {
    const node = this.declarations.inspection.read(callable);
    if (node.kind !== 'function' && node.kind !== 'capability') throw new QueryError('unexpected-kind', callable, 'Expected a function or capability contract.');
    const signature = this.declarations.callable(callable);
    const checks: Check<unknown>[] = [fromFact(signature.result), ...signature.failures.map(fromFact), ...signature.parameters.map(parameter => fromFact(parameter.type)),
      { problems: signature.problems, deferred: [] }];
    if (node.body.kind === 'unavailable') return mergeChecks(...checks, pending('contract-body', node, 'The external contract body is unavailable.'));
    if (node.body.kind === 'absent') return mergeChecks(...checks);
    const scope = this.lookup.parameters(node);
    const clauses = node.body.content.members;
    const result = signature.result;
    const collision = node.parameters.find(parameter => parameter.name === 'result');
    if (collision && result.status === 'known' && result.value.kind === 'value' && clauses.some(clause => clause.kind === 'ensures')) {
      checks.push(problem('result-conflict', collision, 'The parameter conflicts with the contextual result.',
        [node, ...clauses.flatMap(clause => clause.kind === 'ensures' ? [clause.content] : [])]));
    }
    for (const clause of clauses) if (clause.kind === 'requires' || clause.kind === 'ensures') checks.push(this.checkCondition(clause.content.id, scope));
    return mergeChecks(...checks);
  }

  private read(id: NodeId): Item {
    const node = this.declarations.inspection.read(id);
    if (!expressionKinds.has(node.kind)) throw new QueryError('unexpected-kind', id, 'Expected a value expression.');
    return node;
  }
  private builtin(name: string): TypeId {
    const declaration = [...this.declarations.inspection.query('builtin-type')].find(type => type.name === name);
    if (!declaration) throw new Error(`The resolved inspection has no ${name} builtin.`);
    return this.declarations.declaredType(declaration.id);
  }
  private meaning(type: TypeId): Check<TypeDescription> {
    let description = this.declarations.types.describe(type);
    while (description.kind === 'alias') {
      const target = fromFact(description.target);
      if (!target.value) return target as Check<never>;
      description = this.declarations.types.describe(target.value);
    }
    return answer(description);
  }
  private infer(node: Item, scope?: ValueScope, expected?: TypeId): Check<TypeId> {
    let inferred: Check<TypeId>;
    switch (node.kind) {
      case 'number-literal': inferred = answer(this.builtin('Number')); break;
      case 'string-literal': inferred = answer(this.builtin('Text')); break;
      case 'boolean-literal': inferred = answer(this.builtin('Boolean')); break;
      case 'grouped-expression': return this.infer(node.inner, scope, expected);
      case 'name-expression': inferred = this.lookup.value(node.reference, scope); break;
      case 'member-expression': {
        const selected = this.select(node, scope);
        if (!selected.value) return mergeChecks(selected);
        inferred = selected.value.type ? answer(selected.value.type, selected)
          : problem('invalid-purpose', node, 'A selected callable or namespace is not a runtime value.');
        break;
      }
      case 'call-expression': {
        const call = this.call(node, scope);
        if (!call.value) return mergeChecks(call);
        inferred = call.value.kind === 'value' ? answer(call.value.type, call)
          : mergeChecks(call, call.value.kind === 'unspecified' ? pending('declared-result', node, 'A value use needs a declared result type.')
            : problem('invalid-purpose', node, 'This invocation does not produce a value.'));
        break;
      }
      case 'list-expression': inferred = this.list(node, scope, expected); break;
      case 'record-expression': inferred = this.record(node, scope, expected); break;
      case 'unary-expression': {
        const operand = this.operatorOperand(node.operand, node, this.builtin(node.operator === 'not' ? 'Boolean' : 'Number'), scope);
        inferred = answer(this.builtin(node.operator === 'not' ? 'Boolean' : 'Number'), operand); break;
      }
      case 'binary-expression': inferred = this.binary(node, scope); break;
      default: throw new QueryError('unexpected-kind', node.id, 'Expected a value expression.');
    }
    inferred = answer(inferred.value, inferred, inferred.value ? this.valueType(inferred.value, node) : empty());
    if (!inferred.value || !expected) return inferred;
    const compatible = this.fits(node, inferred.value, expected);
    return answer(inferred.value, inferred, compatible, compatible.value === false
      ? problem('incompatible-type', node, 'The value does not fit the required type.') : empty());
  }
  private fits(node: Item, source: TypeId, target: TypeId): Check<boolean> {
    const compatible = this.compatibility.assignable(source, target);
    if (compatible.value !== false) return compatible;
    const shape = this.meaning(target);
    if (!shape.value) return mergeChecks(shape);
    if (shape.value.kind === 'optional') {
      const actual = this.meaning(source);
      if (!actual.value) return mergeChecks(actual);
      if (actual.value.kind !== 'optional') return this.fits(node, source, shape.value.inner);
    }
    if (shape.value.kind === 'union') {
      const choices = shape.value.alternatives.map(type => this.fits(node, source, type));
      if (choices.some(choice => choice.value === true)) return answer(true);
      return answer(false, ...choices);
    }
    return this.compatibility.literal(node, target) ?? compatible;
  }
  private valueType(type: TypeId, at: Item): Check {
    const meaning = this.meaning(type);
    if (!meaning.value) return mergeChecks(meaning);
    const shape = meaning.value;
    if (shape.kind === 'builtin' && this.declarations.inspection.read(shape.declaration, 'builtin-type').name === 'Nothing') {
      return problem('invalid-nothing-use', at, 'Nothing describes an absent callable result, not a runtime value.');
    }
    const children = 'arguments' in shape ? shape.arguments : 'elements' in shape ? shape.elements
      : 'alternatives' in shape ? shape.alternatives : 'inner' in shape ? [shape.inner] : [];
    return mergeChecks(...children.map(child => this.valueType(child, at)));
  }
  private call(node: Item<'call-expression'>, scope?: ValueScope): Check<ResultDescription | { kind: 'check' }> {
    const selected = this.calledOperation(node.id, scope);
    if (!selected.value) return mergeChecks(selected, ...node.arguments.map(argument => this.infer(argument, scope)));
    const target = this.declarations.inspection.read(selected.value);
    const signature = this.declarations.callable(target.id);
    const checked = this.checkArguments(target.id, node.arguments.map(argument => argument.id), node.id, scope);
    const result = fromFact(signature.result);
    // Keep the declared result available even when arguments fail: its own missing facts still matter.
    const value = target.kind === 'check' ? { kind: 'check' as const } : result.value;
    return { ...mergeChecks(selected, checked, result, { problems: signature.problems, deferred: [] }), ...(value ? { value } : {}) };
  }
  private select(node: Item, scope?: ValueScope): Check<{ declaration: Item; type?: TypeId }> {
    if (node.kind === 'grouped-expression') return this.select(node.inner, scope);
    if (node.kind === 'name-expression') {
      const target = this.lookup.target(node.reference);
      const binding = node.reference.resolution;
      if (binding.status === 'deferred' && ['ordered-scope', 'contextual-result'].includes(binding.requirement.reason)
        || target.value && ['parameter', 'field', 'fixture', 'participant', 'let'].includes(target.value.kind)) {
        const value = this.lookup.value(node.reference, scope);
        return !value.value || value.problems.length || value.deferred.length ? mergeChecks(value)
          : problem('invalid-purpose', node, 'An available value is not callable.');
      }
      return answer(target.value ? { declaration: target.value } : undefined, target);
    }
    if (node.kind !== 'member-expression') return problem('invalid-purpose', node, 'Expected a callable name or member.');
    const receiver = ungroup(node.receiver);
    if (receiver.kind === 'name-expression' && receiver.reference.resolution.status === 'bound') {
      const owner = this.declarations.inspection.read(receiver.reference.resolution.target);
      if (['concept', 'component', 'class', 'interface'].includes(owner.kind)) return this.lookup.member(owner, node.member.segments[0]!, node.member);
    }
    const type = this.infer(node.receiver, scope);
    if (!type.value) return mergeChecks(type);
    const shape = this.meaning(type.value);
    if (!shape.value) return mergeChecks(shape);
    if (shape.value.kind !== 'declared') return problem('invalid-member', node.member, 'Member selection needs a nonoptional declared receiver type.');
    return this.lookup.member(this.declarations.inspection.read(shape.value.declaration), node.member.segments[0]!, node.member, type.value);
  }
  private list(node: Item<'list-expression'>, scope?: ValueScope, expected?: TypeId): Check<TypeId> {
    const shape = expected ? this.meaning(expected) : undefined;
    if (shape && !shape.value) return mergeChecks(shape, ...node.elements.map(element => this.infer(element, scope)));
    if (shape?.value?.kind === 'optional') return this.list(node, scope, shape.value.inner);
    if (shape?.value?.kind === 'union') {
      const choices = shape.value.alternatives.map(type => this.list(node, scope, type));
      const accepted = choices.flatMap(choice => choice.value ? [choice.value] : []);
      return accepted.length ? answer(this.declarations.types.unionOf(accepted)) : mergeChecks(...choices);
    }
    if (shape?.value?.kind === 'tuple') {
      const elements = shape.value.elements;
      return answer(expected, ...node.elements.map((element, index) => this.infer(element, scope, elements[index])),
        elements.length === node.elements.length ? empty() : problem('incompatible-type', node, 'The tuple has the wrong number of elements.'));
    }
    const list = this.declarations.types.describe(this.builtin('List'));
    if (list.kind !== 'builtin') throw new Error('Expected the List builtin.');
    const elementType = shape?.value?.kind === 'builtin' && shape.value.declaration === list.declaration ? shape.value.arguments[0] : undefined;
    if (expected && !elementType) return mergeChecks(problem('incompatible-type', node, 'A collection needs a List or tuple destination.'),
      ...node.elements.map(element => this.infer(element, scope)));
    const elements = node.elements.map(element => this.infer(element, scope, elementType));
    const findings = mergeChecks(...elements);
    if (findings.problems.length || findings.deferred.length) return findings;
    if (!elementType && !elements.length) return pending('expected-type', node, 'An empty list needs an expected element or tuple type.');
    const inferred = elementType ?? this.declarations.types.unionOf(elements.map(element => element.value!));
    return answer(this.declarations.types.intern({ kind: 'builtin', declaration: list.declaration, arguments: [inferred] }));
  }
  private record(node: Item<'record-expression'>, scope?: ValueScope, expected?: TypeId): Check<TypeId> {
    const written = node.declaredType ? fromFact(this.declarations.typeOf(node.declaredType.id)) : undefined;
    if (written && !written.value) return mergeChecks(written, ...node.entries.map(entry => this.infer(entry.value, scope)));
    const target = written?.value ?? expected;
    if (!target) return mergeChecks(pending('expected-type', node, 'An anonymous record needs a record type.'), ...node.entries.map(entry => this.infer(entry.value, scope)));
    const shape = this.meaning(target);
    if (!shape.value) return mergeChecks(shape, ...node.entries.map(entry => this.infer(entry.value, scope)));
    if (!written && shape.value.kind === 'optional') return this.record(node, scope, shape.value.inner);
    if (!written && shape.value.kind === 'union') {
      const choices = shape.value.alternatives.map(type => this.record(node, scope, type));
      const known = choices.filter(choice => choice.value), deferred = choices.filter(choice => !choice.problems.length && choice.deferred.length);
      if (known.length > 1) return mergeChecks(problem('ambiguous-record', node, 'More than one record type accepts these entries.'), ...deferred);
      if (deferred.length) return mergeChecks(...deferred);
      return known[0] ?? mergeChecks(...choices);
    }
    if (shape.value.kind !== 'declared' || this.declarations.inspection.read(shape.value.declaration).kind !== 'record-type-declaration') {
      return mergeChecks(problem('invalid-record', node, 'Record construction needs a declared record type.'), ...node.entries.map(entry => this.infer(entry.value, scope)));
    }
    const fields = fromFact(this.declarations.fields(target));
    if (!fields.value) return mergeChecks(fields);
    if (fields.value.kind !== 'available') return problem('invalid-record', node, 'An opaque type has no constructible fields.');
    const checks: Check<unknown>[] = [fields];
    const supplied = new Set<string>();
    for (const entry of node.entries) {
      if (supplied.has(entry.name)) checks.push(problem('invalid-record', { ...entry, origin: entry.nameOrigin }, 'This field is supplied more than once.'));
      supplied.add(entry.name);
      const field = fields.value.fields.find(field => this.declarations.inspection.read(field.declaration, 'field').name === entry.name);
      if (!field) { checks.push(problem('invalid-record', { ...entry, origin: entry.nameOrigin }, 'The record has no such field.'), this.infer(entry.value, scope)); continue; }
      const selected = this.lookup.member(this.declarations.inspection.read(shape.value.declaration), entry.name,
        { id: entry.id, origin: entry.nameOrigin }, target);
      const type = fromFact(field.type);
      checks.push(selected, type, this.infer(entry.value, scope, type.value));
    }
    for (const field of fields.value.fields) {
      const declaration = this.declarations.inspection.read(field.declaration, 'field');
      if (supplied.has(declaration.name)) continue;
      const type = fromFact(field.type), description = type.value ? this.meaning(type.value) : undefined;
      checks.push(type, ...(description ? [description] : []));
      if (!declaration.hasDefault && description?.value && description.value.kind !== 'optional') checks.push(problem('invalid-record', node, `Missing required field ${declaration.name}.`, [declaration]));
    }
    return answer(target, ...checks);
  }
  private binary(node: Item<'binary-expression'>, scope?: ValueScope): Check<TypeId> {
    if (node.operator === '==' || node.operator === '!=') {
      const left = this.infer(node.left, scope), right = this.infer(node.right, scope);
      if (!left.value || !right.value) return mergeChecks(left, right);
      const one = this.compatibility.assignable(left.value, right.value), two = this.compatibility.assignable(right.value, left.value);
      const first = this.compatibility.comparable(left.value), second = this.compatibility.comparable(right.value);
      return answer(this.builtin('Boolean'), left, right, one, two, first, second,
        first.value === false || second.value === false || one.value === false && two.value === false
          ? problem('invalid-operator', node, 'Equality needs compatible comparable operands.') : empty());
    }
    const boolean = node.operator === 'and' || node.operator === 'or';
    const operand = this.builtin(boolean ? 'Boolean' : 'Number');
    return answer(this.builtin(boolean || ['<', '<=', '>', '>='].includes(node.operator) ? 'Boolean' : 'Number'),
      this.operatorOperand(node.left, node, operand, scope), this.operatorOperand(node.right, node, operand, scope));
  }
  private operatorOperand(operand: Item, operator: Item<'unary-expression' | 'binary-expression'>, expected: TypeId, scope?: ValueScope): Check {
    const value = this.infer(operand, scope);
    if (!value.value) return mergeChecks(value);
    const compatible = this.compatibility.assignable(value.value, expected);
    return mergeChecks(value, compatible, compatible.value === false ? problem('invalid-operator',
      { origin: operator.origin.kind === 'source' ? { ...operator.origin, range: operator.operatorRange } : operator.origin },
      'The operator does not accept this operand type.', [operand]) : empty());
  }
}

const expressionKinds = new Set(['number-literal', 'string-literal', 'boolean-literal', 'grouped-expression', 'name-expression',
  'member-expression', 'call-expression', 'list-expression', 'record-expression', 'unary-expression', 'binary-expression']);
function isCallable(node: Item): node is Item<'capability' | 'function' | 'setup' | 'action' | 'observation' | 'check'> {
  return 'parameters' in node && 'body' in node;
}
function ungroup(node: Item): Item { return node.kind === 'grouped-expression' ? ungroup(node.inner) : node; }
function locationKey(at: TypeProblem['at']): string {
  return JSON.stringify(at.kind === 'source' ? ['source', at.module, at.node.sourceId, at.node.ordinal]
    : at.kind === 'external' ? ['external', at.module, at.path]
    : at.kind === 'builtin' ? ['builtin', at.name] : ['dependency', at.path]);
}
function empty(): Check { return { problems: [], deferred: [] }; }
function answer<T>(value: T | undefined, ...checks: readonly Check<unknown>[]): Check<T> {
  const result = mergeChecks(...checks);
  return value !== undefined && !result.problems.length && !result.deferred.length ? { value, ...result } : result;
}
function problem(code: string, node: Pick<Item, 'origin'>, message: string, related: readonly Item[] = []): Check {
  return { problems: [{ code, message, at: node.origin, related: related.map(item => item.origin) }], deferred: [] };
}
function pending(reason: string, node: Item, requires: string): Check { return { problems: [], deferred: [{ reason, origin: node.origin, requires }] }; }
