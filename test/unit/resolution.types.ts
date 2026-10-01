import type { ModelNode, NodeId, SourceNodeId } from '../../src/index.js';
import type { ResolutionDependencies, Resolution } from '../../src/resolution.js';

// Compile-time consumers: one structural representation carries readonly resolution facts.
function readonlyContracts(resolution: Resolution, declaration: ModelNode<'record-type-declaration'>,
  dependencies: ResolutionDependencies, reference: NodeId, sourceReference: SourceNodeId) {
  // @ts-expect-error Resolution diagnostics are readonly.
  resolution.problems.push({});
  // @ts-expect-error Declaration child handles are readonly.
  declaration.name = reference;
  if (declaration.origin.kind === 'source') {
    // @ts-expect-error Source provenance is immutable snapshot data.
    declaration.origin.node.ordinal = 0;
    // @ts-expect-error Source positions remain readonly inside a resolved model.
    declaration.origin.range.start.line = 1;
  }
  // @ts-expect-error Origins do not expose the source collaborator.
  declaration.origin.model;
  // @ts-expect-error Downstream input is common Model, not raw external definitions.
  dependencies.modules[0]!.declarations;
  // @ts-expect-error Input module inventory is readonly.
  dependencies.modules.push(dependencies.modules[0]!);
  // @ts-expect-error Source provenance identifiers are not common handles.
  resolution.model.node(sourceReference);
  // @ts-expect-error External text IDs are not common handles.
  resolution.model.node('ExternalId');
  // @ts-expect-error Resolution outcomes belong to the captured model.
  resolution.binding(reference);
  const node = resolution.model.node(reference, 'reference');
  // @ts-expect-error Reference segments are readonly.
  node.segments.push(reference);
  const binding = resolution.model.resolution(reference);
  // @ts-expect-error Resolution facts are readonly.
  binding.status = binding.status;
  if (binding.status === 'bound') {
    const target: ModelNode = resolution.model.node(binding.target);
    return target.kind;
  }
  if (binding.status === 'deferred') return binding.requirement.reason;
  if (binding.status === 'invalid') return binding.problems[0]?.code;
  return binding.status;
}
void readonlyContracts;
