import type { Origin } from '../../model/model.js';

export type ProblemLocation =
  | Origin
  | { readonly kind: 'dependency'; readonly path: readonly (string | number)[] };

export type ResolutionProblemCode =
  | 'unresolved-reference' | 'wrong-reference-kind' | 'ambiguous-reference'
  | 'duplicate-declaration' | 'inaccessible-reference' | 'unavailable-module'
  | 'unavailable-package' | 'invalid-dependency-input' | 'composition-required' | 'include-cycle'
  | 'empty-examples-source' | 'conflicting-example-subject';

/** An author/input failure, distinct from misuse of the report's query API. */
export interface ResolutionProblem {
  readonly code: ResolutionProblemCode;
  readonly message: string;
  readonly at: ProblemLocation;
  readonly related: readonly ProblemLocation[];
}
