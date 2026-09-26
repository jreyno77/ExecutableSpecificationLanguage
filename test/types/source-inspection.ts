import { inspectSource, visitSource, type SourceDescription, type ReadResult } from '../../src/index.js';

// Compiled by npm run typecheck; deliberately not executed.
export function sourceInspectionTypeContract(source: SourceDescription, read: ReadResult): void {
  const inspection = inspectSource(source);
  for (const capability of inspection.nodes('capability')) {
    inspection.name(capability.payload.name);
    // @ts-expect-error Capability payloads do not contain record fields.
    capability.payload.fields;
    // @ts-expect-error Source payloads are deeply readonly.
    capability.payload.parameters.push({ sourceId: 'author.expec', ordinal: 0 });
    // @ts-expect-error Source positions are readonly.
    capability.range.start.line = 2;
  }
  // @ts-expect-error Node kinds are closed and typed.
  inspection.nodes('capabilty');
  visitSource(source, {
    capability(node, lookup) {
      lookup.name(node.payload.name);
      // @ts-expect-error Callback payload is narrowed to a capability.
      node.payload.fields;
      // @ts-expect-error Callback views prohibit source mutation.
      node.payload.kind = 'function';
    },
  });
  // @ts-expect-error A ReadResult must be accepted and unwrapped before inspection.
  inspectSource(read);
}
