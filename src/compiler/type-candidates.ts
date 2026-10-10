import type { NodeId } from '../model/model.js';
import type { Check } from './checking.js';
import type { Resolution } from './resolution.js';

/** An eligible type spelling and its declaration in the same captured resolution. */
export interface TypeCandidate {
  readonly name: string;
  readonly insertionText: string;
  readonly target: NodeId;
}

/** Ask the captured type-reference context for eligible final-segment names. */
export function typeCandidates(_resolution: Resolution, _reference: NodeId): Check<readonly TypeCandidate[]> {
  return { value: [], problems: [], deferred: [] };
}
