export type * from './grammar/source.js';
export { AntlrSyntaxReader } from './grammar/reader.js';
import { AntlrSyntaxReader } from './grammar/reader.js';
export function createSyntaxReader(): AntlrSyntaxReader { return new AntlrSyntaxReader(); }
export { InspectionError } from './inspection.js';
export { DescriptionInspection } from './inspection/description-inspection.js';
export { ExternalInspection, InspectionInputError } from './inspection/external-inspection.js';
export type {
  Inspection, ModuleInspection, InspectionInput, InspectionKind, InspectionNode, NodeId, Origin,
  ReferenceLookup, ReferenceResolution, CallableBody, InspectionErrorCode,
} from './inspection.js';
export type { ExternalDefinition, ExternalField, ExternalParameter, TypeExpression, InspectionInputProblem } from './inspection/external-inspection.js';
export { Resolver } from './resolution.js';
export type { Resolution, ResolutionDependencies } from './resolution.js';
export type { BuiltinName } from './inspection.js';
export type { DeferredReference, DeferredReason } from './resolution/reference-resolver.js';
export type { ResolutionProblem, ResolutionProblemCode, ProblemLocation } from './resolution/problem.js';
export type { DependencyPackage, PackagePhase } from './resolution/package-availability.js';
