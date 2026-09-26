import type { Collector, SourceNodeId } from '../../src/index.js';
import { describeReference, describeType } from './type-description.js';

export type Position = { line: number; column: number };
export type Capability = {
  name: string; inputs: string[]; sourceId: string;
  declarationAt: Position; nameAt: Position; nameEndsAt: Position;
};
export type TypeUse = { name: string; at: Position; arguments: string[] };
export type TypeOccurrence = { id: Readonly<SourceNodeId>; fact: TypeUse };
export type PromiseText = { text: string; clauseAt: Position; textAt: Position };

function position(point: Position): Position { return { line: point.line, column: point.column }; }

export const capabilityCollector: Collector<'capability', Capability> = {
  kind: 'capability',
  project(capability, source) {
    const name = source.node(capability.payload.name, 'name');
    return {
      name: name.payload.decoded,
      inputs: capability.payload.parameters.map(id => {
        const parameter = source.node(id, 'parameter');
        return `${source.name(parameter.payload.name)}: ${describeType(source, parameter.payload.declaredType)}`;
      }),
      sourceId: capability.range.sourceId,
      declarationAt: position(capability.range.start),
      nameAt: position(name.range.start),
      nameEndsAt: position(name.range.end),
    };
  },
};

export const namedTypeCollector: Collector<'named-type', TypeOccurrence> = {
  kind: 'named-type',
  project(type, source) {
    const reference = source.node(type.payload.reference, 'reference');
    const name = source.node(reference.payload.segments[0]!, 'name');
    return {
      id: type.id,
      fact: {
        name: describeReference(source, reference.id),
        at: position(name.range.start),
        // Existing examples ask for immediate argument heads, not recursively
        // expanded descriptions. Non-named arguments retain their type structure.
        arguments: type.payload.arguments.map(id => {
          const argument = source.node(id).payload;
          return argument.kind === 'named-type' ? describeReference(source, argument.reference) : describeType(source, id);
        }),
      },
    };
  },
};

export const promiseCollector: Collector<'promises', PromiseText> = {
  kind: 'promises',
  project(clause, source) {
    const text = source.node(clause.payload.content, 'string-literal');
    return {
      text: text.payload.value,
      clauseAt: position(clause.range.start),
      textAt: position(text.range.start),
    };
  },
};

