/** Source coordinates use Unicode scalar offsets and one-based lines and columns. */
export interface SourceDocument { sourceId: string; text: string }
export interface SourcePosition { readonly offset: number; readonly line: number; readonly column: number }
export interface SourceRange { readonly sourceId: string; readonly start: SourcePosition; readonly end: SourcePosition }
export interface SourceNodeId { readonly sourceId: string; readonly ordinal: number }
export interface SyntaxDiagnostic {
  readonly category: 'unexpected-token' | 'expected-token' | 'unterminated-string' | 'unterminated-name' | 'invalid-escape' | 'invalid-character';
  readonly explanation: string;
  readonly primaryRange: SourceRange;
  readonly relatedRanges: readonly SourceRange[];
}
