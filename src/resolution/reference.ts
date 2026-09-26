import type { SourceNodeId, SourceRange } from '../grammar/source.js';
import type { InspectionNode } from '../inspection.js';
import type { DeclarationId } from './declaration.js';
import type { ResolutionProblem } from './problem.js';
import { copyNodeId, copyRange } from './source-index.js';

export type DeferredReason = 'receiver-type' | 'contextual-result' | 'ordered-scope' | 'composition' | 'interaction';
export interface DeferredReference {
  readonly occurrence: SourceNodeId;
  readonly range: SourceRange;
  readonly reason: DeferredReason;
  readonly requires: string;
}
export type ReferenceBinding =
  | { readonly status: 'bound'; readonly target: DeclarationId }
  | { readonly status: 'invalid'; readonly problems: readonly ResolutionProblem[] }
  | { readonly status: 'deferred'; readonly requirement: DeferredReference };

const requirements: Record<DeferredReason, string> = {
  'receiver-type': 'Expression typing must identify the receiver and its available members.',
  'contextual-result': 'Contract checking must establish whether a result is available in this context.',
  'ordered-scope': 'Helper, scenario, or default checking must establish ordered local and capture visibility.',
  composition: 'Source composition must supply the declarations and ownership of the combined document.',
  interaction: 'Interaction checking must identify participants and select the recipient operation.',
};

export function deferredReference(reference: InspectionNode<'reference'>, reason: DeferredReason, requires = requirements[reason]): DeferredReference {
  return { occurrence: copyNodeId(reference.id), range: copyRange(reference.range), reason, requires };
}
