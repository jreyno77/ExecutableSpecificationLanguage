import fs from 'node:fs';
import type { SourceDocument } from '../../src/grammar/source.js';

/** Supplies authored test input; it does not interpret source or predict results. */
export function sourceFixture(name: string, area: string): SourceDocument {
  return {
    sourceId: name,
    text: fs.readFileSync(new URL(`../resources/${area}/${name}`, import.meta.url), 'utf8'),
  };
}
