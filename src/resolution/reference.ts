import type { InspectionNode, NodeId, Origin } from '../inspection.js';

export type DeferredReason = 'receiver-type' | 'contextual-result' | 'ordered-scope' | 'composition' | 'interaction';
export interface DeferredReference {
  readonly occurrence: NodeId;
  readonly origin: Origin;
  readonly reason: DeferredReason;
  readonly requires: string;
}
const requirements: Record<DeferredReason, string> = {
  'receiver-type': 'Expression typing must identify the receiver and its available members.',
  'contextual-result': 'Contract checking must establish whether a result is available in this context.',
  'ordered-scope': 'Helper, scenario, or default checking must establish ordered local and capture visibility.',
  composition: 'Source composition must supply the declarations and ownership of the combined document.',
  interaction: 'Interaction checking must identify participants and select the recipient operation.',
};

export function deferredReference(reference: InspectionNode<'reference'>, reason: DeferredReason, requires = requirements[reason]): DeferredReference {
  return { occurrence: reference.id, origin: reference.origin, reason, requires };
}
