import ts from 'typescript';
import type { Diagnostic } from './checking.js';
import { diagnostic } from './typescript-capture.js';

export type NativeDeclaration = ts.Declaration & { readonly name?: ts.DeclarationName; readonly type?: ts.TypeNode;
  readonly parameters?: ts.NodeArray<ts.ParameterDeclaration>; readonly typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration>;
  readonly body?: ts.Block; readonly questionToken?: ts.QuestionToken; readonly initializer?: ts.Expression };
export interface NativeEdit { readonly start: number; readonly end: number; readonly text: string }
export const nativeName = (node: ts.Node): string => ts.isConstructorDeclaration(node) ? 'constructor'
  : 'name' in node && node.name ? (node.name as ts.Node).getText().replace(/^["']|["']$/g, '') : '';
export const nativeMembers = (node: ts.Node): readonly NativeDeclaration[] => ts.isSourceFile(node) ? node.statements.filter(statement => ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isFunctionDeclaration(statement)) as readonly NativeDeclaration[]
  : ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) ? node.members as readonly NativeDeclaration[]
  : ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type) ? node.type.members as readonly NativeDeclaration[] : [];
export const headerEnd = (node: NativeDeclaration): number => node.body?.getStart() ?? (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)
  ? node.members.pos - 1 : ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type) ? node.type.members.pos - 1 : node.end);
export const tokens = (text: string, comments = false): string => {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, !comments, ts.LanguageVariant.Standard, text), values: unknown[] = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan())
    if (![ts.SyntaxKind.WhitespaceTrivia, ts.SyntaxKind.NewLineTrivia].includes(token)) values.push([token, scanner.getTokenValue() || scanner.getTokenText()]);
  return JSON.stringify(values);
};

/** Nonoverlapping native source spans retain every byte outside the proposed edits. */
export class NativeEdits {
  readonly problems: Diagnostic[] = [];
  private readonly files = new Map<string, NativeEdit[]>();
  add(file: string, start: number, end: number, text: string, replacesTokens = false): void {
    const edits = this.files.get(file) ?? [];
    if (replacesTokens) for (let index = edits.length - 1; index >= 0; index--) if (edits[index]!.start >= start && edits[index]!.end <= end) edits.splice(index, 1);
    if (edits.some(edit => edit.start === start && edit.end === end && edit.text === text)) return;
    const insertion = edits.find(edit => start === end && edit.start === start && edit.end === end);
    if (insertion) { edits[edits.indexOf(insertion)] = { start, end, text: insertion.text + text }; return; }
    if (edits.some(edit => start < edit.end && end > edit.start)) { this.problems.push(diagnostic('overlapping-native-edits', 'Native edits overlap.', file, start, end - start)); return; }
    edits.push({ start, end, text }); this.files.set(file, edits);
  }
  apply(file: string, text: string): string {
    for (const edit of [...this.files.get(file) ?? []].sort((a, b) => b.start - a.start || b.end - a.end)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    return text;
  }
  within(file: string, start: number, end: number): NativeEdits {
    const result = new NativeEdits();
    for (const edit of this.files.get(file) ?? []) if (edit.start >= start && edit.end <= end) result.add('', edit.start - start, edit.end - start, edit.text);
    return result;
  }
  source(file: string, text: string): string {
    const edited = this.apply(file, text), parsed = ts.createSourceFile(file, edited, ts.ScriptTarget.Latest, true) as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] };
    for (const issue of parsed.parseDiagnostics) this.problems.push(diagnostic('typescript-' + issue.code, ts.flattenDiagnosticMessageText(issue.messageText, '\n'), file, issue.start ?? 0, issue.length ?? 0));
    return edited;
  }
  get paths(): readonly string[] { return [...this.files.keys()]; }
}
