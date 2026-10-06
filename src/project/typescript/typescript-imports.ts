import ts from 'typescript';
import { posix } from 'node:path';
import type { Diagnostic } from '../../compiler/checking.js';
import type { ArtifactAssociation } from '../../model/specification-identity.js';
import type { NativeFile } from './typescript-declarations.js';
import { TypeScriptCapture, diagnostic } from './typescript-capture.js';
import { TypeScriptSymbols } from './typescript-symbols.js';
import { NativeEdits } from './typescript-edits.js';

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
  const scope = checker.getSymbolsInScope(source, ts.SymbolFlags.Type | ts.SymbolFlags.Value | ts.SymbolFlags.Alias);
  for (const statement of wanted.statements.filter(ts.isImportDeclaration)) {
    const binding = statement.importClause?.namedBindings; if (!binding || !ts.isNamedImports(binding) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text, renderedTarget = module.startsWith('.') ? posix.normalize(posix.join(posix.dirname(desired.path), module)).replace(/\.js$/, '.ts') : undefined,
      target = declarations.find(file => file.path === renderedTarget);
    for (const item of binding.elements) {
      const imported = item.propertyName?.text ?? item.name.text, association = target?.artifacts.find(association => {
        const location = association.locator.value as { declaration: { name: string }[] }; return location.declaration.length === 1 && location.declaration[0]!.name === imported;
      });
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
        const declaration = selected.nodes[0]!, moduleSymbol = checker.getSymbolAtLocation(declaration.getSourceFile()),
          exported = moduleSymbol && checker.getExportsOfModule(moduleSymbol).find(symbol => underlying(symbol) === selected.key);
        if (!exported) { problems.push(diagnostic('native-mapping-conflict', 'The adopted declaration is not visible or exported from its actual placement.', path, source.getStart(), 0)); continue; }
        actualName = exported.getName();
      }
      let from = targetPath ? posix.relative(posix.dirname(path), targetPath).replace(/\.ts$/, '.js') : module;
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

export function nativeTypeText(node: ts.Node, aliases: ReadonlyMap<string, string>): string {
  const edits = new NativeEdits(), start = node.getStart();
  const visit = (child: ts.Node): void => {
    if (ts.isTypeReferenceNode(child) && ts.isIdentifier(child.typeName) && aliases.has(child.typeName.text))
      edits.add('', child.typeName.getStart() - start, child.typeName.end - start, aliases.get(child.typeName.text)!);
    ts.forEachChild(child, visit);
  };
  visit(node); return edits.apply('', node.getText());
}
