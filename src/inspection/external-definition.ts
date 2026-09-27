import type { BuiltinName } from './builtins.js';
import type { Origin } from './model.js';

type DefinitionName = { readonly name: string; readonly local?: boolean };
type TypeParameters = { readonly typeParameters?: readonly string[] };
export interface ExternalField extends DefinitionName {
  readonly kind: 'field'; readonly type: TypeExpression; readonly hasDefault?: boolean;
}
export interface ExternalParameter { readonly name: string; readonly type: TypeExpression; readonly hasDefault?: boolean }
export type ExternalDefinition = DefinitionName & (
  | ({ readonly kind: 'record-type'; readonly fields: readonly ExternalField[] } & TypeParameters)
  | ({ readonly kind: 'alias-type'; readonly target: TypeExpression } & TypeParameters)
  | ({ readonly kind: 'opaque-type' } & TypeParameters)
  | { readonly kind: 'concept' | 'component' | 'class' | 'interface'; readonly members: readonly (ExternalDefinition | ExternalField)[];
      readonly public: readonly string[]; readonly construction?: readonly ExternalParameter[] }
  | { readonly kind: 'function' | 'capability'; readonly parameters: readonly ExternalParameter[]; readonly result?: TypeExpression }
);
export type TypeExpression =
  | { readonly kind: 'named'; readonly path: readonly string[]; readonly module?: string; readonly arguments?: readonly TypeExpression[] }
  | { readonly kind: 'builtin'; readonly name: BuiltinName; readonly arguments?: readonly TypeExpression[] }
  | { readonly kind: 'parameter'; readonly name: string }
  | { readonly kind: 'tuple'; readonly elements: readonly TypeExpression[] }
  | { readonly kind: 'union'; readonly alternatives: readonly TypeExpression[] }
  | { readonly kind: 'optional'; readonly inner: TypeExpression }
  | { readonly kind: 'literal'; readonly value:
      { readonly kind: 'text'; readonly value: string } | { readonly kind: 'boolean'; readonly value: boolean }
      | { readonly kind: 'number'; readonly decimal: string } };
export interface InspectionInputProblem { readonly message: string; readonly at: Extract<Origin, { kind: 'external' }> }
export class InspectionInputError extends Error {
  override readonly name = 'InspectionInputError';
  readonly code = 'invalid-dependency-input';
  constructor(readonly problems: readonly InspectionInputProblem[]) { super('External definitions have invalid structure.'); }
}
