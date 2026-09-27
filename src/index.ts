export type * from './grammar/source.js';
export { AntlrSyntaxReader } from './grammar/reader.js';
import { AntlrSyntaxReader } from './grammar/reader.js';
export function createSyntaxReader(): AntlrSyntaxReader { return new AntlrSyntaxReader(); }
export { DescriptionInspection, ExternalInspection, InspectionError, InspectionInputError } from './inspection.js';
export type {
  Inspection, ModuleInspection, InspectionInput, InspectionKind, InspectionNode, NodeId, Origin,
  ReferenceLookup, ReferenceResolution, CallableBody, InspectionErrorCode,
  ExternalDefinition, ExternalField, ExternalParameter, TypeExpression, InspectionInputProblem,
} from './inspection.js';
export { Resolver } from './resolution/resolve.js';
export type { ResolutionDependencies } from './resolution/resolve.js';
export type { Resolution } from './resolution/resolved-inspection.js';
export type { BuiltinName } from './inspection/builtins.js';
export type { DeferredReference, DeferredReason } from './resolution/reference.js';
export type { ResolutionProblem, ResolutionProblemCode, ProblemLocation } from './resolution/problem.js';
export type { DependencyPackage, PackagePhase } from './resolution/package-availability.js';
