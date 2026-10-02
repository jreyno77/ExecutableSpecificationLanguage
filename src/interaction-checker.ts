import { fromFact, mergeChecks, type Check } from './checking.js';
import type { ExpressionChecking, ValueScope } from './expression-checker.js';
import type { Item } from './inspection-item.js';
import { QueryError, type NodeId } from './model.js';
import type { TypeCatalog } from './type-catalog.js';
import type { TypeId } from './types.js';

export interface Communication {
  readonly sender: NodeId;
  readonly receiver: NodeId;
  readonly operation: NodeId;
  readonly reply?: TypeId;
}
export interface InteractionChecking {
  check(interaction: NodeId): Check;
  message(message: NodeId): Check<Communication>;
}

export class InteractionChecker implements InteractionChecking {
  constructor(
    private readonly types: Pick<TypeCatalog, 'inspection' | 'typeOf' | 'describe' | 'callable'>,
    private readonly expressions: ExpressionChecking,
  ) {}
  check(interaction: NodeId): Check { return mergeChecks(this.analyze(this.types.inspection.read(interaction, 'interaction'))); }
  message(message: NodeId): Check<Communication> {
    const node = this.types.inspection.read(message, 'message'), interaction = this.types.inspection.parent(node.id);
    if (interaction?.kind !== 'interaction') throw new QueryError('unexpected-kind', message, 'Expected a message belonging to an interaction.');
    return this.analyze(interaction, message);
  }

  private analyze(interaction: Item<'interaction'>, selected?: NodeId): Check<Communication> {
    const names = new Map<string, Item<'parameter' | 'participant' | 'name'>>();
    const duplicates = new Map<string, Check>();
    const values = new Map<NodeId, Check<TypeId>>();
    // Uniqueness is interaction-wide; availability still follows authored order.
    const introductions = [...interaction.parameters, ...interaction.members.filter(member => member.kind === 'participant'),
      ...interaction.members.flatMap(member => member.kind === 'message' && member.capture ? [member.capture] : [])];
    for (const node of introductions) {
      const name = node.kind === 'name' ? node.decoded : node.name, previous = names.get(name);
      if (previous) duplicates.set(name, mergeChecks(duplicates.get(name) ?? mergeChecks(),
        problem(node.kind === 'name' ? 'duplicate-capture' : 'duplicate-declaration', node, 'This interaction already declares ' + name + '.', [previous])));
      else names.set(name, node);
    }
    const scope: ValueScope = reference => {
      const name = reference.segments.length === 1 ? reference.segments[0]! : undefined;
      const node = name === undefined ? undefined : names.get(name), binding = reference.resolution;
      if (!node || binding.status === 'bound' && binding.target !== node.id) return undefined;
      const found = duplicates.get(name!) ?? values.get(node.id);
      return found && { ...found, problems: found.problems.map(cause => ({ ...cause,
        related: [...new Set([...cause.related, reference.origin])],
      })) };
    };
    const endpoint = (reference: Item<'reference'>): Check<NodeId> => {
      const binding = reference.resolution;
      if (binding.status === 'not-analyzed') throw new QueryError('not-analyzed', reference.id, 'Resolve the message before checking its participants.');
      if (binding.status === 'invalid') return { problems: binding.problems, deferred: [] };
      if (binding.status === 'deferred' && binding.requirement.reason !== 'interaction') return { problems: [], deferred: [binding.requirement] };
      const name = reference.segments.length === 1 ? reference.segments[0]! : undefined;
      const node = name === undefined ? undefined : names.get(name);
      if (name !== undefined && duplicates.has(name)) return duplicates.get(name)!;
      if (node?.kind !== 'participant' || !values.has(node.id)) return problem('invalid-participant', reference,
        'A message endpoint must name an already introduced local participant.');
      const type = values.get(node.id)!;
      return type.value ? { value: node.id, problems: [], deferred: [] } : mergeChecks(type);
    };
    const checks: Check<unknown>[] = [...duplicates.values()];
    for (const parameter of interaction.parameters) {
      const type = fromFact(this.types.typeOf(parameter.declaredType.id));
      values.set(parameter.id, type); checks.push(type);
    }
    if (!selected) for (const parameter of interaction.parameters) checks.push(this.expressions.checkDefault(parameter.id, scope));
    for (const member of interaction.members) {
      if (member.kind === 'participant') {
        const type = this.participantType(member);
        values.set(member.id, type); checks.push(type);
        continue;
      }
      const sender = endpoint(member.sender), receiver = endpoint(member.receiver);
      const operation = receiver.value ? this.expressions.publicCapability(values.get(receiver.value)!.value!, member.operation.id) : mergeChecks();
      const arguments_ = operation.value
        ? this.expressions.checkArguments(operation.value, member.arguments.map(argument => argument.id), member.id, scope)
        : mergeChecks(...member.arguments.map(argument => this.expressions.typeOf(argument.id, scope)));
      const signature = operation.value ? this.types.callable(operation.value) : undefined;
      const result = signature ? fromFact(signature.result) : mergeChecks();
      const findings = [sender, receiver, operation, arguments_, result, { problems: signature?.problems ?? [], deferred: [] }];
      let reply: TypeId | undefined;
      if (member.capture) {
        findings.push(duplicates.get(member.capture.decoded) ?? mergeChecks());
        if (result.value?.kind === 'value') reply = result.value.type;
        else if (result.value?.kind === 'none') findings.push(problem('invalid-purpose', member.capture, 'This capability does not produce a reply value.'));
        else if (result.value?.kind === 'unspecified') findings.push({ problems: [], deferred: [{ reason: 'declared-result',
          origin: member.capture.origin, requires: 'A captured reply needs a declared result type.' }] });
      }
      const checked = mergeChecks(...findings);
      const communication: Check<Communication> = sender.value && receiver.value && operation.value && !checked.problems.length && !checked.deferred.length
        ? { ...checked, value: { sender: sender.value, receiver: receiver.value, operation: operation.value, ...(reply ? { reply } : {}) } } : checked;
      checks.push(checked);
      if (member.capture) values.set(member.capture.id, communication.value && reply ? { ...checked, value: reply } : checked);
      if (member.id === selected) return communication;
    }
    if (selected) throw new QueryError('unexpected-kind', selected, 'Expected a message belonging to this interaction.');
    return mergeChecks(...checks);
  }

  private participantType(participant: Item<'participant'>): Check<TypeId> {
    const type = fromFact(this.types.typeOf(participant.declaredType.id));
    if (!type.value) return type;
    let meaning = this.types.describe(type.value);
    while (meaning.kind === 'alias') {
      const target = fromFact(meaning.target);
      if (!target.value) return mergeChecks(target);
      meaning = this.types.describe(target.value);
    }
    return meaning.kind === 'declared' && ['concept', 'component', 'class', 'interface'].includes(this.types.inspection.read(meaning.declaration).kind)
      ? type : problem('invalid-participant', participant.declaredType, 'A participant needs a concept, component, class or interface contract.');
  }
}

function problem(code: string, at: Item, message: string, related: readonly Item[] = []): Check {
  return { problems: [{ code, message, at: at.origin, related: related.map(node => node.origin) }], deferred: [] };
}
