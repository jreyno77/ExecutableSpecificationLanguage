import type { Inspection, Item, SourceRange } from '../../src/index.js';

type Assert<T extends true> = T;
/** External names have no source spelling; source names do expose quotation. */
export type NameSpellingMayBeUnavailable = Assert<undefined extends Item<'name'>['quoted'] ? true : false>;

// Compiled by typecheck, never executed: operator locations remain readable facts.
export function operatorLocationExamples(inspection: Inspection): void {
  for (const unary of inspection.query('unary-expression')) {
    const operatorRange: SourceRange = unary.operatorRange;
    void operatorRange;
  }
  for (const binary of inspection.query('binary-expression')) {
    const operatorRange: SourceRange = binary.operatorRange;
    void operatorRange;
  }
}
