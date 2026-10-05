import type { SourceDocument, SyntaxDiagnostic } from '../source.js';
import type { Coordinates } from './coordinates.js';

/** Validate whole literal tokens before a value converter decodes them. */
export function literalDiagnostics(source: SourceDocument, coordinates: Coordinates): SyntaxDiagnostic[] {
  const diagnostics: SyntaxDiagnostic[] = [];
  const text = source.text;
  for (let start = 0; start < text.length; start++) {
    if (text.startsWith('//', start)) { while (start < text.length && text[start] !== '\n') start++; continue; }
    const quote = text[start];
    if (quote !== '"' && quote !== '`') continue;
    let end = start + 1;
    while (end < text.length && text[end] !== '\n' && text[end] !== '\r' && text[end] !== quote) {
      if (text[end] === '\\' && text[end + 1] !== '\n' && text[end + 1] !== '\r') end++;
      end++;
    }
    const closed = text[end] === quote;
    if (closed) end++;
    const report = (category: SyntaxDiagnostic['category'], explanation: string) => diagnostics.push({
      category, explanation, primaryRange: coordinates.range(start, end), relatedRanges: [],
    });
    if (!closed) report(quote === '`' ? 'unterminated-name' : 'unterminated-string', 'A quoted value must close before the line ends.');
    else {
      const content = text.slice(start + 1, end - 1);
      const allowed = quote === '`' ? /\\[`\\]/gu : /\\(?:["\\nrt]|u[0-9a-fA-F]{4})/gu;
      if (quote === '`' && !content.length) report('invalid-character', 'A quoted name cannot be empty.');
      else if (/[\u0000-\u001f\u007f-\u009f]/u.test(content)) report('invalid-character', 'Quoted values cannot contain raw control characters.');
      else if (content.replace(allowed, '').includes('\\')) report('invalid-escape', 'The escape is not supported by this literal form.');
      else {
        const decoded: string = quote === '`' ? content.replace(/\\([`\\])/gu, '$1') : JSON.parse(text.slice(start, end));
        if ([...decoded].some(character => { const point = character.codePointAt(0)!; return point >= 0xd800 && point <= 0xdfff; })) {
          report('invalid-escape', 'Unicode surrogate escapes must form a valid pair.');
        }
      }
    }
    start = end - 1;
  }
  return diagnostics;
}
