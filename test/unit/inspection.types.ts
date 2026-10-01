import type { AcceptedDocument, Inspection, Item, Model, NodeId } from '../../src/index.js';

// Compiled by npm run typecheck. Never called: these examples assert the public static contract.
export function inspectionTypeExamples(inspection: Inspection, model: Model, input: AcceptedDocument): void {
  for (const capability of inspection.query('capability')) {
    const kind: 'capability' = capability.kind;
    const name: string = capability.name;
    const parameters: readonly Item<'parameter'>[] = capability.parameters;
    void [kind, name];
    // @ts-expect-error A capability does not expose name-node data.
    capability.decoded;
    // @ts-expect-error Returned views are readonly.
    capability.kind = 'capability';
    // @ts-expect-error Nested arrays are readonly.
    parameters.push(parameters[0]!);
    // @ts-expect-error Inspection identities expose no source ordinal.
    capability.id.ordinal = 0;
    if (capability.nameOrigin.kind === 'source') {
      // @ts-expect-error Source positions remain readonly.
      capability.nameOrigin.range.start.line = 0;
    }
    // @ts-expect-error Inspection identities expose no source identifier.
    capability.id.sourceId = 'changed';
    const selected: Item<'capability'> = inspection.read(capability.id, 'capability');
    void selected;
  }
  for (const concept of inspection.query('concept')) {
    const kind: 'concept' = concept.kind;
    void [kind, concept.members];
  }
  for (const type of inspection.query('named-type')) {
    const reference: Item<'reference'> = type.reference;
    const segments: readonly string[] = reference.segments;
    void [segments, type.arguments];
  }
  for (const capability of model.nodes('capability')) {
    const name: NodeId = capability.name;
    void name;
    // @ts-expect-error Structural collections are readonly.
    capability.parameters.push(name);
  }
  // @ts-expect-error Accepted input captures readonly source.
  input.source.text = 'changed';
  // @ts-expect-error Accepted documents are opaque and cannot be authored structurally.
  const invented: AcceptedDocument = { source: { sourceId: 'fake', text: '' } };
  void invented;
  // @ts-expect-error Only language kinds are selectable.
  inspection.query('made-up-kind');
}
