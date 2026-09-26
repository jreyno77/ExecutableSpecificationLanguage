import { visitSource } from './visitor-candidate.js';
import { inspectSource, type SourceDescription } from '../../../src/index.js';

export function callbackTypeUses(source: SourceDescription) {
  const result: Array<{ segments: readonly string[]; line: number; column: number }> = [];
  visitSource(source, {
    'named-type'(node, lookup) {
      result.push({ segments: lookup.reference(node.payload.reference), line: node.range.start.line, column: node.range.start.column });
    },
  });
  return result;
}

export function queryTypeUses(source: SourceDescription) {
  const lookup = inspectSource(source);
  return [...lookup.nodes('named-type')].map(node => ({
    segments: lookup.reference(node.payload.reference), line: node.range.start.line, column: node.range.start.column,
  }));
}
