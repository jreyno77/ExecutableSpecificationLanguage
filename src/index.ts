export type * from './grammar/source.js';
export { AntlrSyntaxReader } from './grammar/reader.js';
import { AntlrSyntaxReader } from './grammar/reader.js';
export function createSyntaxReader(): AntlrSyntaxReader { return new AntlrSyntaxReader(); }
export { DescriptionInspection, InspectionError } from './inspection.js';
export type { Inspection, InspectionInput, InspectionKind, InspectionNode, InspectionErrorCode } from './inspection.js';
export { Resolver } from './resolver.js';
export type { DependencySnapshot } from './resolver.js';
export { ResolutionQueryError } from './resolution/report.js';
export type { Resolution, ResolutionQueryErrorCode } from './resolution/report.js';
export type { Declaration, DeclarationId, DeclarationKind, DeclarationOrigin } from './resolution/declaration.js';
export type { BuiltinName } from './resolution/builtins.js';
export type { ReferenceBinding, DeferredReference, DeferredReason } from './resolution/reference.js';
export type { ResolutionProblem, ResolutionProblemCode, ProblemLocation } from './resolution/problem.js';
export type { DependencyModule, DependencyDeclaration, DependencyLink, DependencyTarget } from './resolution/dependency-module.js';
export type { DependencyPackage, PackagePhase } from './resolution/package-availability.js';
