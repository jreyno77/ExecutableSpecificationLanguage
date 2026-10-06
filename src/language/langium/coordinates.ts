import type { AstNode } from 'langium';
import type { SourceDocument, SourceRange } from '../grammar/source.js';

/** Langium counts UTF-16 code units; the source contract counts Unicode scalars. */
export class Coordinates {
  private readonly positions: { offset: number; line: number; column: number }[] = [];
  constructor(readonly source: Readonly<SourceDocument>) {
    let offset = 0, line = 1, column = 1, utf16 = 0;
    for (const character of source.text) {
      const position = { offset, line, column };
      for (let unit = 0; unit < character.length; unit++) this.positions[utf16++] = position;
      offset++;
      if (character === '\n') { line++; column = 1; } else column++;
    }
    this.positions[utf16] = { offset, line, column };
  }
  range(start: number, end: number): SourceRange {
    const length = this.source.text.length;
    const first = Math.max(0, Math.min(Number.isFinite(start) ? start : length, length));
    const last = Math.max(first, Math.min(Number.isFinite(end) ? end : length, length));
    return { sourceId: this.source.sourceId, start: { ...this.positions[first]! }, end: { ...this.positions[last]! } };
  }
  node(node: AstNode): SourceRange {
    const cst = node.$cstNode!;
    return this.range(cst.offset, cst.end);
  }
}
