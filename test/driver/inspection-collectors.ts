import type { Inspection, NodeId, Origin, SourceRange } from '../../src/index.js';
import { describeReference, describeType } from './type-description.js';

export type Position = { line: number; column: number };
export type Capability = {
  name: string; inputs: string[]; sourceId: string;
  declarationAt: Position; nameAt: Position; nameEndsAt: Position;
};
export type TypeUse = { name: string; at: Position; arguments: string[] };
export type TypeOccurrence = { id: NodeId; fact: TypeUse };
export type PromiseText = { text: string; clauseAt: Position; textAt: Position };

function position(point: Position): Position { return { line: point.line, column: point.column }; }
function sourceRange(origin: Origin): SourceRange {
  if (origin.kind !== 'source') throw new Error('Expected an authored source occurrence');
  return origin.range;
}

export function capabilitySummaries(source: Inspection): Capability[] {
  return Array.from(source.query('capability'), capability => ({
    name: capability.name,
    inputs: capability.parameters.map(parameter => `${parameter.name}: ${describeType(parameter.declaredType)}`),
    sourceId: sourceRange(capability.origin).sourceId,
    declarationAt: position(sourceRange(capability.origin).start),
    nameAt: position(sourceRange(capability.nameOrigin).start),
    nameEndsAt: position(sourceRange(capability.nameOrigin).end),
  }));
}

export function namedTypeOccurrences(source: Inspection): TypeOccurrence[] {
  return Array.from(source.query('named-type'), type => ({
    id: type.id,
    fact: {
      name: describeReference(type.reference),
      at: position(sourceRange(type.reference.segmentOrigins[0]!).start),
      arguments: type.arguments.map(argument => argument.kind === 'named-type' ? describeReference(argument.reference) : describeType(argument)),
    },
  }));
}

export function promiseDescriptions(source: Inspection): PromiseText[] {
  return Array.from(source.query('promises'), clause => ({
    text: clause.text,
    clauseAt: position(sourceRange(clause.origin).start),
    textAt: position(sourceRange(clause.textOrigin).start),
  }));
}
