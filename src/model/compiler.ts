import type { SourceDocument, SourceRange, SourceDescription, SourceNodeId } from './source.js';

export type SymbolId = { value: string };
export type TypeId = { value: string };
export type PrimitiveName = 'Text' | 'Number' | 'Boolean';
export type BuiltinDefinition = { name: string; arity: number; category: 'primitive' | 'container' | 'no-result' };
export type BuiltinCatalog = { version: 'candidate-0.1'; definitions: BuiltinDefinition[] };
export type DeclarationOrigin =
  | { kind: 'source'; node: SourceNodeId }
  | { kind: 'builtin'; name: string }
  | { kind: 'external'; locator: string; exportedPath: string[] }
  | { kind: 'context'; owner: SourceNodeId; role: 'result' };
export type TypeShape =
  | { kind: 'primitive'; primitiveName: PrimitiveName }
  | { kind: 'declared'; declaration: SymbolId; arguments: TypeId[] }
  | { kind: 'type-parameter'; declaration: SymbolId; position: number }
  | { kind: 'literal'; primitiveName: PrimitiveName; valueText: string }
  | { kind: 'tuple'; elements: TypeId[] }
  | { kind: 'union'; alternatives: TypeId[] }
  | { kind: 'optional'; element: TypeId }
  | { kind: 'list'; element: TypeId }
  | { kind: 'no-result' };
export type SemanticType = { id: TypeId; shape: TypeShape };
export type ParameterContract = { symbol: SymbolId; name: string; valueType: TypeId; hasDefault: boolean; defaultSource?: SourceNodeId };
export type FieldContract = ParameterContract & { optional: boolean };
export type SymbolKind = 'primitive-type' | 'container-type' | 'no-result-type' | 'concept' | 'component' | 'class' | 'interface' | 'record-type' | 'alias-type' | 'opaque-type' | 'type-parameter' | 'construction' | 'function' | 'capability' | 'setup' | 'action' | 'observation' | 'check' | 'parameter' | 'field' | 'fixture' | 'local-value' | 'participant' | 'capture' | 'result';
export interface SymbolRecord {
  id: SymbolId;
  path: string[];
  kind: SymbolKind;
  owner?: SymbolId;
  origin: DeclarationOrigin;
  typeParameters: SymbolId[];
  valueType?: TypeId;
  aliasTarget?: TypeId;
  parameters: ParameterContract[];
  resultType?: TypeId;
  resultSpecified: boolean;
  fields: FieldContract[];
  members: SymbolId[];
  publicMembers: SymbolId[];
}
export type DependencyModule = { locator: string; symbols: SymbolRecord[]; types: SemanticType[]; exports: SymbolId[] };
export type PackageDeclaration = { alias: string; phases: ('build' | 'runtime' | 'test')[] };
export type DependencyCatalog = { modules: DependencyModule[]; packages: PackageDeclaration[] };
export type CompilationInput = { source: SourceDocument; dependencies: DependencyCatalog };
export type ValidationInput = { document: SourceDocument; description: SourceDescription; dependencies: DependencyCatalog };
export type DiagnosticOrigin = { kind: 'source'; range: SourceRange } | { kind: 'input'; propertyPath: string };
export type CompilerDiagnostic = { code: string; phase: 'syntax' | 'input' | 'resolution' | 'typing' | 'composition'; explanation: string; primary: DiagnosticOrigin; related: DiagnosticOrigin[] };
export type ReferenceBinding = { reference: SourceNodeId; target: SymbolId };
export type ExpressionType = { expression: SourceNodeId; role: 'value' | 'call-target' | 'namespace' | 'no-result' | 'check-result' | 'unspecified-result'; valueType?: TypeId };
export type TypeResolution = { source: SourceNodeId; resolvedType: TypeId };
export type ResolvedImport = { source: SourceNodeId; locator: string; target: SymbolId; localName: string };
export type PublicContract = { owner: SymbolId; capabilities: SymbolId[] };
export type DependencyUse = { owner: SymbolId; target: SymbolId; source: SourceNodeId };
export type PackageUse = { owner: SymbolId; alias: string; phase?: 'build' | 'runtime' | 'test'; source: SourceNodeId };
export type CompilationObligation = { kind: 'implementation-needed' | 'check-implementation-needed' | 'prose-needs-check' | 'result-type-unspecified' | 'execution-not-performed' | 'package-installation-not-verified'; source: SourceNodeId; explanation: string };

/** A declared use, not a runtime call or an ownership/lifetime promise. */
export type DerivedRelationship = {
  kind: 'dependency' | 'construction-input' | 'capability-input' | 'capability-output' | 'function-input' | 'function-output' | 'field';
  owner: SymbolId;
  target: SymbolId;
  source: SourceNodeId;
  direction: 'input' | 'output' | 'reference';
};
export interface ResolvedSpecification {
  grammarVersion: 'candidate-0.1';
  document: SourceDocument;
  source: SourceDescription;
  symbols: SymbolRecord[];
  types: SemanticType[];
  bindings: ReferenceBinding[];
  expressionTypes: ExpressionType[];
  typeResolutions: TypeResolution[];
  imports: ResolvedImport[];
  publicContracts: PublicContract[];
  dependencies: DependencyUse[];
  packages: PackageUse[];
  relationships: DerivedRelationship[];
}
export type AcceptedCompilation = { status: 'accepted'; specification: ResolvedSpecification; diagnostics: CompilerDiagnostic[]; obligations: CompilationObligation[] };
export type RejectedCompilation = { status: 'rejected'; diagnostics: CompilerDiagnostic[] };
export type CompilationResult = AcceptedCompilation | RejectedCompilation;
