import { AstUtils, type AstNode } from 'langium';
import type { SourceDocument, SourceRange, SyntaxDiagnostic } from '../grammar/source.js';
import type { Source } from './generated/ast.js';
import { isDo, isGiven, isMessage, isName, isWhen } from './generated/ast.js';
import { Coordinates } from './coordinates.js';
import { literalDiagnostics } from './literals.js';
import { createExpecServices } from './services.js';

const documentBrand: unique symbol = Symbol('AcceptedDocument');
export interface AcceptedDocument {
  readonly source: Readonly<SourceDocument>;
  readonly [documentBrand]: true;
}
export type ReadResult =
  | { readonly status: 'accepted'; readonly grammarVersion: 'candidate-0.1'; readonly document: AcceptedDocument }
  | { readonly status: 'rejected'; readonly grammarVersion: 'candidate-0.1'; readonly diagnostics: readonly SyntaxDiagnostic[] };

interface ParsedDocument {
  readonly ast: Source;
  readonly source: Readonly<SourceDocument>;
  readonly coordinates: Coordinates;
  range(node: AstNode): SourceRange;
}
const documents = new WeakMap<AcceptedDocument, ParsedDocument>();
/** Package-internal access: accepted documents never expose mutable parser data. */
export function getParsedDocument(document: AcceptedDocument): ParsedDocument {
  const parsed = documents.get(document);
  if (!parsed) throw new TypeError('An accepted document must come from LangiumReader.');
  return parsed;
}

/** Parses supplied text; acceptance makes no claim about names or types. */
export class LangiumReader {
  private readonly services = createExpecServices();
  read(input: SourceDocument): ReadResult {
    const source = Object.freeze({ ...input });
    const coordinates = new Coordinates(source);
    const diagnostics = literalDiagnostics(source, coordinates);
    const reject = (): ReadResult => ({ status: 'rejected', grammarVersion: 'candidate-0.1', diagnostics });
    if (diagnostics.length) return reject();
    const lexed = this.services.parser.Lexer.tokenize(source.text);
    for (const error of lexed.errors) diagnostics.push({ category: 'invalid-character', explanation: error.message,
      primaryRange: coordinates.range(error.offset, error.offset + error.length), relatedRanges: [] });
    if (diagnostics.length) return reject();
    const result = this.services.parser.LangiumParser.parse<Source>(source.text);
    for (const error of result.parserErrors) {
      const relatedRanges: SourceRange[] = [];
      const eof = !Number.isFinite(error.token.startOffset) || error.token.startOffset < 0;
      if (eof) {
        const open: typeof lexed.tokens = [];
        for (const token of lexed.tokens) {
          if (['{', '(', '['].includes(token.image)) open.push(token);
          else if (['}', ')', ']'].includes(token.image)) open.pop();
        }
        const delimiter = open.at(-1);
        if (delimiter) relatedRanges.push(coordinates.range(delimiter.startOffset, delimiter.endOffset! + 1));
      }
      diagnostics.push({ category: error.name === 'MismatchedTokenException' ? 'expected-token' : 'unexpected-token', explanation: error.message,
        primaryRange: eof ? coordinates.range(source.text.length, source.text.length)
          : coordinates.range(error.token.startOffset, (error.token.endOffset ?? source.text.length - 1) + 1), relatedRanges });
    }
    if (diagnostics.length) return reject();
    const ranges = new WeakMap<AstNode, SourceRange>();
    for (const node of AstUtils.streamAllContents(result.value)) {
      if (isName(node)) node.quoted = node.$cstNode!.text.startsWith('`');
      if (isMessage(node)) ranges.set(node.receiver,
        coordinates.range(node.receiver.$cstNode!.offset, node.receiver.segments.at(-1)!.$cstNode!.end));
      const call = isDo(node) ? node.expression : isGiven(node) || isWhen(node) ? node.content : undefined;
      if (call && call.$type !== 'CallExpression') diagnostics.push({ category: 'expected-token', explanation: 'This step requires a call expression.',
        primaryRange: coordinates.node(call), relatedRanges: [] });
    }
    if (diagnostics.length) return reject();
    const document: AcceptedDocument = Object.freeze({ source, [documentBrand]: true as const });
    documents.set(document, { ast: result.value, source, coordinates, range: node => ranges.get(node) ?? coordinates.node(node) });
    return { status: 'accepted', grammarVersion: 'candidate-0.1', document };
  }
}
