import {
  visit, type ReadResult, type SourceDescription,
  type Visitor, type VisitorInput, type VisitorNode, type Visitors,
} from '../../src/index.js';

// Compiled by npm run typecheck; deliberately not executed.
export function visitorTypeContract(description: SourceDescription, read: ReadResult, readonlyInput: VisitorInput): void {
  const capability: Visitor<'capability'> = (node, context) => {
    const kind: 'capability' = node.payload.kind;
    const inputs: readonly object[] = node.payload.parameters;
    context.name(node.payload.name);
    // @ts-expect-error Capability payloads do not contain record fields.
    node.payload.fields;
    // @ts-expect-error Parameters remain readonly.
    node.payload.parameters.push(node.id);
    // @ts-expect-error Nested identifiers remain readonly.
    node.payload.parameters[0]!.ordinal = 2;
    // @ts-expect-error The payload itself remains readonly.
    node.payload.kind = 'capability';
    // @ts-expect-error Ranges remain deeply readonly.
    node.range.start.line = 2;
    // @ts-expect-error Node identity remains readonly.
    node.id.sourceId = 'another.expec';
    const named = context.node(node.payload.name, 'name');
    const spelling: string = named.payload.decoded;
    // @ts-expect-error Name payloads do not expose callable inputs.
    named.payload.parameters;
    const unknownKind = context.node(node.id);
    if (unknownKind.payload.kind === 'capability') {
      const orderedInputs: readonly object[] = unknownKind.payload.parameters;
    }
  };
  const visitors: Visitors = {
    capability,
    concept(node) {
      const kind: 'concept' = node.payload.kind;
      node.payload.members;
      // @ts-expect-error Grouped concept kinds still narrow to concept.
      const other: 'class' = node.payload.kind;
    },
    name(node) {
      const spelling: string = node.payload.decoded;
      // @ts-expect-error Name fields remain readonly.
      node.payload.decoded = 'changed';
    },
    'named-type'(node, context) {
      const segments: readonly string[] = context.reference(node.payload.reference);
      node.payload.arguments;
      // @ts-expect-error Decoded segments cannot be changed through the public contract.
      segments.push('changed');
    },
  };
  visit(description, visitors);
  visit(readonlyInput, visitors);
  // @ts-expect-error A reader result must be accepted and unwrapped first.
  visit(read, {});
  visit(description, {
    // @ts-expect-error Unknown visitor keys are rejected.
    capabilty() {},
  });
  const genericVisitor: Visitor = (node: VisitorNode) => {
    if (node.payload.kind === 'name') {
      const spelling: string = node.payload.decoded;
    }
  };
}