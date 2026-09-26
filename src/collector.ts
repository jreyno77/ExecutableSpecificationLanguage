import type { Inspection, InspectionKind, InspectionNode } from './inspection.js';

export interface Collector<K extends InspectionKind, T> {
  readonly kind: K;
  readonly project: (node: InspectionNode<K>, inspection: Inspection) => T;
}

/** Eagerly project each matching occurrence into a caller-owned result array. */
export function collect<K extends InspectionKind, T>(
  _inspection: Inspection, _collector: Collector<K, T>,
): T[] {
  return [];
}
