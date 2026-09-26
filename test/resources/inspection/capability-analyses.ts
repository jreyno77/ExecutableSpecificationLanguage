import { visitSource } from './visitor-candidate.js';
import { inspectSource, type SourceDescription } from '../../../src/index.js';

export function callbackCapabilities(source: SourceDescription) {
  const result: Array<{ name: string; line: number; column: number }> = [];
  visitSource(source, {
    capability(node, lookup) {
      result.push({ name: lookup.name(node.payload.name), line: node.range.start.line, column: node.range.start.column });
    },
  });
  return result;
}

export function queryCapabilities(source: SourceDescription) {
  const lookup = inspectSource(source);
  return [...lookup.nodes('capability')].map(node => ({
    name: lookup.name(node.payload.name), line: node.range.start.line, column: node.range.start.column,
  }));
}
