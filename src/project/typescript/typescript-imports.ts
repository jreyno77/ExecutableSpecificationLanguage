import ts from 'typescript';
import { posix } from 'node:path';
import type { Diagnostic } from '../../compiler/checking.js';
import type { ArtifactAssociation } from '../../model/specification-identity.js';
import type { NativeFile } from './typescript-declarations.js';
import { TypeScriptCapture, diagnostic } from './typescript-capture.js';
import { TypeScriptSymbols } from './typescript-symbols.js';
import { NativeEdits } from './typescript-edits.js';

function nativeExportName(capture: TypeScriptCapture, symbols: TypeScriptSymbols, id: string, edits: NativeEdits): string | undefined {
  const selected = symbols.selections.find(selection => selection.id === id), declaration = selected?.nodes[0];
  if (!selected || !declaration) return undefined;
  const checker = capture.program!.getTypeChecker(), module = checker.getSymbolAtLocation(declaration.getSourceFile());
  const exported = module && checker.getExportsOfModule(module).find(symbol =>
    (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol) === selected.key);
  if (!exported) return undefined;
  if (exported.getName() === 'default') return 'default';
  const named = exported.declarations?.find(ts.isExportSpecifier)
    ?? exported.declarations?.find(node => 'name' in node && node.name !== undefined);
  const name = named && 'name' in named ? named.name as ts.DeclarationName : undefined;
  if (!name || !ts.isIdentifier(name) && !ts.isStringLiteralLike(name)) return undefined;
  const path = capture.projectPath(name.getSourceFile().fileName);
  if (!path) return undefined;
  if (ts.isStringLiteralLike(name)) return name.text;
  return edits.within(path, name.getStart(), name.end).apply('', name.text);
}
/** Uses existing native aliases and adds only imports required by the new contract. */
export function nativeImports(capture: TypeScriptCapture, symbols: TypeScriptSymbols, source: ts.SourceFile, desired: NativeFile,
  declarations: readonly NativeFile[], placements: ReadonlyMap<string, string>, mappings: readonly ArtifactAssociation[], edits: NativeEdits,
  problems: Diagnostic[]): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>(), imports = source.statements.filter(ts.isImportDeclaration), checker = capture.program!.getTypeChecker(),
    wanted = ts.createSourceFile(desired.path, desired.text, ts.ScriptTarget.Latest, true), path = capture.projectPath(source.fileName)!, newline = source.text.includes('\r\n') ? '\r\n' : '\n';
  const underlying = (symbol: ts.Symbol | undefined): ts.Symbol | undefined => symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const targetId = (name: ts.Node): string | undefined => {
    const symbol = underlying(checker.getSymbolAtLocation(name));
    return symbols.selections.find(item => item.key === symbol)?.id;
  };
  const scope = capture.program!.getSourceFile(source.fileName) === source
    ? checker.getSymbolsInScope(source, ts.SymbolFlags.Type | ts.SymbolFlags.Value | ts.SymbolFlags.Alias) : [];
  const destination = placements.get(desired.id) ?? desired.path;
  for (const file of declarations.filter(file => (placements.get(file.id) ?? file.path) === destination)) {
    for (const association of file.artifacts) {
      const at = association.locator.value as { declaration: { name: string }[] };
      if (at.declaration.length !== 1) continue;
      const selected = symbols.selections.find(selection => selection.id === association.specId);
      const declaration = selected?.nodes.find(node => capture.projectPath(node.getSourceFile().fileName) === path && 'name' in node);
      const name = declaration && 'name' in declaration ? declaration.name as ts.DeclarationName : undefined;
      if (name && ts.isIdentifier(name)) aliases.set(at.declaration[0]!.name, edits.within(path, name.getStart(), name.end).apply('', name.text));
    }
  }
  for (const statement of wanted.statements.filter(ts.isImportDeclaration)) {
    const binding = statement.importClause?.namedBindings; if (!binding || !ts.isNamedImports(binding) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text, renderedTarget = module.startsWith('.') ? posix.normalize(posix.join(posix.dirname(desired.path), module)).replace(/\.js$/, '.ts') : undefined,
      targets = declarations.filter(file => file.path === renderedTarget);
    for (const item of binding.elements) {
      const imported = item.propertyName?.text ?? item.name.text, association = targets.flatMap(file => file.artifacts).find(association => {
        const location = association.locator.value as { declaration: { name: string }[] }; return location.declaration.length === 1 && location.declaration[0]!.name === imported;
      }), target = association && targets.find(file => file.artifacts.includes(association));
      const existing = imports.flatMap(declaration => {
        const named = declaration.importClause?.namedBindings; return named && ts.isNamedImports(named) ? named.elements.filter(candidate => association
          ? targetId(candidate.name) === association.specId : ts.isStringLiteral(declaration.moduleSpecifier) && declaration.moduleSpecifier.text === module && (candidate.propertyName?.text ?? candidate.name.text) === imported) : [];
      })[0];
      if (existing) { aliases.set(item.name.text, edits.within(path, existing.name.getStart(), existing.name.end).apply('', existing.name.text)); continue; }
      const selected = association && symbols.selections.find(selection => selection.id === association.specId),
        visible = selected && scope.find(symbol => underlying(symbol) === selected.key);
      if (visible) { aliases.set(item.name.text, visible.getName()); continue; }
      if (scope.some(symbol => symbol.name === item.name.text)) { problems.push(diagnostic('native-name-conflict', 'A native binding already occupies the required import name.', path, source.getStart(), 0)); continue; }
      const actual = association && mappings.find(mapping => mapping.specId === association.specId && (mapping.locator.value as { declaration: unknown[] }).declaration.length === 1),
        targetPath = target && placements.get(target.id);
      let actualName = actual ? (actual.locator.value as { declaration: { name: string }[] }).declaration[0]!.name : imported;
      if (selected) {
        const exported = nativeExportName(capture, symbols, selected.id, edits);
        if (exported === undefined) { problems.push(diagnostic('native-mapping-conflict', 'The adopted declaration is not visible or exported from its actual placement.', path, source.getStart(), 0)); continue; }
        actualName = exported;
      }
      let from = targetPath ? posix.relative(posix.dirname(placements.get(desired.id) ?? path), targetPath).replace(/\.ts$/, '.js') : module;
      if (targetPath && !from.startsWith('.')) from = './' + from;
      const added = ts.factory.createImportDeclaration(undefined, ts.factory.createImportClause(statement.importClause!.isTypeOnly, undefined, ts.factory.createNamedImports([
        ts.factory.createImportSpecifier(false, actualName === item.name.text ? undefined : ts.factory.createIdentifier(actualName), ts.factory.createIdentifier(item.name.text))
      ])), ts.factory.createStringLiteral(from));
      const text = ts.createPrinter().printNode(ts.EmitHint.Unspecified, added, wanted).replace(/\r?\n/g, newline);
      const at = imports.at(-1)?.end ?? (source.text.startsWith('\uFEFF') ? 1 : 0);
      edits.add(path, at, at, (at > 1 ? newline : '') + text + newline);
    }
  }
  return aliases;
}

/** Normalize native rename edits against both endpoints of a multi-file move. */
export function moveImports(capture: TypeScriptCapture, moves: ReadonlyMap<string, string>, edits: NativeEdits, problems: Diagnostic[]): void {
  for (const [before, after] of moves) {
    for (const edit of capture.service.getEditsForFileRename(capture.absolute(before), capture.absolute(after), {}, {})) {
      const path = capture.projectPath(edit.fileName), source = capture.program?.getSourceFile(edit.fileName);
      if (!path) { problems.push(diagnostic('incomplete-native-rename', 'Native module edits escape captured scope.', before)); continue; }
      for (const change of edit.textChanges) {
        let text = change.newText;
        const visit = (node: ts.Node): void => {
          if (ts.isStringLiteralLike(node) && node.getStart() + 1 === change.span.start && node.text.length === change.span.length) {
            const target = capture.resolveModule(node.text, source!.fileName), targetPath = target && capture.projectPath(target.fileName);
            if (targetPath && moves.has(path) && moves.has(targetPath)) {
              text = posix.relative(posix.dirname(moves.get(path) ?? path), moves.get(targetPath) ?? targetPath);
              const extension = posix.extname(change.newText);
              text = text.replace(/\.[cm]?tsx?$/, extension);
              if (!text.startsWith('.')) text = './' + text;
            }
          } else ts.forEachChild(node, visit);
        };
        if (source) visit(source);
        edits.add(path, change.span.start, change.span.start + change.span.length, text);
      }
    }
  }
}

export function nativeTypeText(node: ts.Node, aliases: ReadonlyMap<string, string>): string {
  const edits = new NativeEdits(), start = node.getStart();
  const visit = (child: ts.Node): void => {
    if (ts.isTypeReferenceNode(child) && ts.isIdentifier(child.typeName) && aliases.has(child.typeName.text))
      edits.add('', child.typeName.getStart() - start, child.typeName.end - start, aliases.get(child.typeName.text)!);
    ts.forEachChild(child, visit);
  };
  visit(node); return edits.apply('', node.getText());
}
