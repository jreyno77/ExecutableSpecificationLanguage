import type { InspectionNode, NodeId, SourceNodeId } from '../../src/index.js';
import type { ResolutionDependencies } from '../../src/resolution.js';
import type { Resolution } from '../../src/resolution.js';

// Compile-time consumers: one inspected representation carries readonly resolution facts.
function readonlyContracts(resolution: Resolution, declaration: InspectionNode<'record-type-declaration'>,
  dependencies: ResolutionDependencies, reference: NodeId, sourceReference: SourceNodeId) {
  // @ts-expect-error Resolution diagnostics are readonly.
  resolution.problems.push({});
  // @ts-expect-error Declaration child handles are readonly.
  declaration.payload.name = reference;
  if (declaration.origin.kind === 'source') {
    // @ts-expect-error Source provenance is immutable snapshot data.
    declaration.origin.node.ordinal = 0;
    // @ts-expect-error Source positions remain readonly inside a resolved view.
    declaration.origin.range.start.line = 1;
  }
  // @ts-expect-error Origins do not expose the source collaborator.
  declaration.origin.inspection;
  // @ts-expect-error Downstream input is common inspection, not raw external definitions.
  dependencies.modules[0]!.declarations;
  // @ts-expect-error Input module inventory is readonly.
  dependencies.modules.push(dependencies.modules[0]!);
  // @ts-expect-error Source provenance identifiers are not common handles.
  resolution.node(sourceReference);
  // @ts-expect-error External text IDs are not common handles.
  resolution.node('ExternalId');
  // @ts-expect-error Binding is a reference facet, not a second report API.
  resolution.binding(reference);
  const node = resolution.node(reference, 'reference');
  // @ts-expect-error Resolution facts are readonly.
  node.payload.resolution = { status: 'not-analyzed' };
  const binding = node.payload.resolution;
  if (binding.status === 'bound') {
    const target: InspectionNode = resolution.node(binding.target);
    return target.payload.kind;
  }
  if (binding.status === 'deferred') return binding.requirement.reason;
  if (binding.status === 'invalid') return binding.problems[0]?.code;
  return binding.status;
}
void readonlyContracts;
