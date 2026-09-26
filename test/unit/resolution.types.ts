import type {
  Declaration, DependencySnapshot, ReferenceBinding, Resolution, SourceNodeId,
} from '../../src/index.js';

// Compile-time consumers: results and dependency descriptions expose readonly facts.
function readonlyContracts(resolution: Resolution, declaration: Declaration, dependencies: DependencySnapshot, reference: SourceNodeId) {
  // @ts-expect-error Resolution diagnostics are readonly.
  resolution.problems.push({});
  // @ts-expect-error Consumers do not mutate declaration names.
  declaration.name = 'changed';
  // @ts-expect-error Origins do not expose the source collaborator.
  declaration.origin.inspection;
  // @ts-expect-error External descriptions do not require or expose Inspection.
  dependencies.modules[0]!.inspection;
  // @ts-expect-error External module declarations are readonly.
  dependencies.modules[0]!.declarations.push({});
  // @ts-expect-error External IDs cannot be used as authored source occurrences.
  resolution.binding('ExternalId');
  // @ts-expect-error Source occurrence lookup has no fabricated module AST argument.
  resolution.binding(reference, 'module');
  const binding: ReferenceBinding = resolution.binding(reference);
  if (binding.status === 'bound') {
    const name: string = resolution.declaration(binding.target).name;
    return name;
  }
  if (binding.status === 'deferred') return binding.requirement.reason;
  return binding.problems[0]?.code;
}
void readonlyContracts;

