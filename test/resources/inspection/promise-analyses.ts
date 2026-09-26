import { visitSource } from './visitor-candidate.js';
import { inspectSource, type SourceDescription } from '../../../src/index.js';

export function callbackPromises(source: SourceDescription): string[] {
  const promises: string[] = [];
  visitSource(source, {
    promises(node, lookup) {
      promises.push(lookup.node(node.payload.content, 'string-literal').payload.value);
    },
  });
  return promises;
}

export function queryPromises(source: SourceDescription): string[] {
  const inspection = inspectSource(source);
  const promises: string[] = [];
  for (const node of inspection.nodes('promises')) {
    promises.push(inspection.node(node.payload.content, 'string-literal').payload.value);
  }
  return promises;
}

