import type { SourceRange } from '../grammar/source.js';
import type { BuiltinName } from './builtins.js';
import type { Declaration } from './declaration.js';

export type ProblemLocation =
  | { readonly kind: 'external'; readonly module: string; readonly declaration: string }
  | { readonly kind: 'source'; readonly range: SourceRange }
  | { readonly kind: 'dependency'; readonly path: readonly (string | number)[] }
  | { readonly kind: 'builtin'; readonly name: BuiltinName };

export type ResolutionProblemCode =
  | 'unresolved-reference' | 'wrong-reference-kind' | 'ambiguous-reference'
  | 'duplicate-declaration' | 'inaccessible-reference' | 'unavailable-module'
  | 'unavailable-package' | 'invalid-dependency-catalog' | 'composition-required';

/** An author/input failure, distinct from misuse of the report's query API. */
export interface ResolutionProblem {
  readonly code: ResolutionProblemCode;
  readonly message: string;
  readonly at: ProblemLocation;
  readonly related: readonly ProblemLocation[];
}

export function originLocation(declaration: Declaration): ProblemLocation {
  const origin = declaration.origin;
  return origin.kind === 'source' ? { kind: 'source', range: origin.range } : origin;
}
