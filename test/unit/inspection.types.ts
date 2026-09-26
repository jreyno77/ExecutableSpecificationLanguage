import type { Inspection, InspectionInput, InspectionNode } from '../../src/index.js';

// Compiled by npm run typecheck. Never called: these examples assert the public static contract.
export function inspectionTypeExamples(inspection: Inspection, input: InspectionInput): void {
  for (const capability of inspection.nodes('capability')) {
    const kind: 'capability' = capability.payload.kind;
    const parameters = capability.payload.parameters;
    const name = inspection.node(capability.payload.name, 'name');
    const decoded: string = name.payload.decoded;
    void [kind, decoded];
    // @ts-expect-error A capability does not expose name-node data.
    capability.payload.decoded;
    // @ts-expect-error Returned payloads are readonly.
    capability.payload.kind = 'capability';
    // @ts-expect-error Nested arrays are readonly.
    parameters.push(name.id);
    // @ts-expect-error IDs are readonly.
    name.id.ordinal = 0;
    // @ts-expect-error Positions are readonly.
    name.range.start.line = 0;
    // @ts-expect-error Referenced identifiers are readonly.
    capability.payload.name.sourceId = 'changed';
  }
  for (const concept of inspection.nodes('concept')) {
    const kind: 'concept' = concept.payload.kind;
    void [kind, concept.payload.members];
  }
  for (const type of inspection.nodes('named-type')) {
    void [type.payload.reference, type.payload.arguments];
  }
  // @ts-expect-error Input views are deeply readonly.
  input.nodes.push({} as InspectionNode);
  // @ts-expect-error Only actual source kinds are selectable.
  inspection.nodes('made-up-kind');
}
