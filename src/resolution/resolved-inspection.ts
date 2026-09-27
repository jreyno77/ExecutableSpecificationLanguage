import type { Inspection, InspectionNode, NodeId } from '../inspection.js';
import { InspectionView } from '../inspection/view.js';
import type { DeferredReference } from './reference.js';
import type { ResolutionProblem } from './problem.js';

/** The original inspected facts enriched with this call's reference outcomes. */
export interface Resolution extends Inspection {
  readonly entry: string;
  readonly problems: readonly ResolutionProblem[];
  readonly deferred: readonly DeferredReference[];
}

/** Captures this analysis; subsequent queries never revisit the supplied modules. */
export class ResolvedInspection extends InspectionView implements Resolution {
  constructor(
    readonly entry: string,
    roots: readonly NodeId[],
    nodes: readonly InspectionNode[],
    readonly problems: readonly ResolutionProblem[],
    readonly deferred: readonly DeferredReference[],
    unanalyzed: ReadonlySet<NodeId>,
  ) { super(roots, nodes, unanalyzed); }
}
