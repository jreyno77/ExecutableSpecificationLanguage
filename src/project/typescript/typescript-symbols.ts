import ts from 'typescript';
import type { Diagnostic } from '../../compiler/checking.js';
import type { ArtifactAssociation, ArtifactLocator, ObservedRelationship, RelationshipObservation } from '../../model/specification-identity.js';
import { canonical } from '../../model/identity-baseline.js';
import { TypeScriptCapture, diagnostic, ordinal } from './typescript-capture.js';

export interface Selector { readonly kind: string; readonly name: string; readonly static?: boolean }
interface Selection { readonly id: string; readonly nodes: readonly ts.Declaration[]; readonly key: ts.Symbol | ts.ConstructorDeclaration }
interface Use { readonly node: ts.Node; readonly symbol: ts.Symbol; readonly role: string; readonly construction?: ts.ConstructorDeclaration }
type Unresolved = RelationshipObservation['unresolved'][number];
const named = (node: ts.Node): ts.DeclarationName | undefined => 'name' in node ? node.name as ts.DeclarationName | undefined : undefined;
const nameOf = (node: ts.Node): string | undefined => {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  const name = named(node);
  if (!name) return undefined;
  if (ts.isComputedPropertyName(name)) return ts.isStringLiteralLike(name.expression) || ts.isNumericLiteral(name.expression) ? name.expression.text : undefined;
  return ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : undefined;
};
const parameterProperty = (node: ts.Node): node is ts.ParameterDeclaration => ts.isParameter(node) && ts.isConstructorDeclaration(node.parent)
  && !!(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.ParameterPropertyModifier);
const kindOf = (node: ts.Node): string | undefined => ts.isClassDeclaration(node) ? 'class' : ts.isInterfaceDeclaration(node) ? 'interface'
  : ts.isTypeAliasDeclaration(node) ? 'type' : ts.isEnumDeclaration(node) ? 'enum' : ts.isModuleDeclaration(node) ? 'namespace'
  : ts.isFunctionDeclaration(node) ? 'function' : ts.isVariableDeclaration(node) || ts.isBindingElement(node) ? 'variable'
  : ts.isMethodDeclaration(node) || ts.isMethodSignature(node) ? 'method' : ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) || parameterProperty(node) ? 'property'
  : ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ? 'accessor' : ts.isConstructorDeclaration(node) ? 'constructor' : undefined;
const inside = (node: ts.Node, owner: ts.Node): boolean => node.getSourceFile() === owner.getSourceFile() && node.pos >= owner.pos && node.end <= owner.end;
const walk = (node: ts.Node, visit: (node: ts.Node) => void): void => { visit(node); ts.forEachChild(node, child => walk(child, visit)); };
function children(owner: ts.Node): ts.Declaration[] {
  const found: ts.Declaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isConstructorDeclaration(node) && ts.isClassDeclaration(owner)) found.push(...node.parameters.filter(parameterProperty));
    if (kindOf(node) && nameOf(node) !== undefined) found.push(node as ts.Declaration);
    else if (ts.isFunctionLike(node) || ts.isClassLike(node) || ts.isBlock(node) && (!ts.isFunctionLike(owner) || node.parent !== owner)
      || ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isCatchClause(node)) return;
    else ts.forEachChild(node, visit);
  };
  ts.forEachChild(owner, visit); return found;
}

/** Resolves an exact lexical address without claiming a specification identity. */
export function nativeSelection(source: ts.SourceFile, selectors: readonly Selector[]): readonly ts.Node[] {
  let nodes: readonly ts.Node[] = [source];
  for (const selector of selectors) nodes = nodes.flatMap(owner => children(owner).filter(node => kindOf(node) === selector.kind && nameOf(node) === selector.name
    && (selector.static === undefined || !!(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Static) === selector.static)));
  return nodes;
}

/** Native declaration selection, reference identities and source-level relationship attribution. */
export class TypeScriptSymbols {
  readonly problems: Diagnostic[] = [];
  readonly selections: Selection[] = [];
  private readonly claims = new Map<ts.Symbol | ts.ConstructorDeclaration, Set<string>>();
  private readonly checker: ts.TypeChecker | undefined;
  constructor(readonly capture: TypeScriptCapture, readonly associations: readonly ArtifactAssociation[]) {
    this.checker = capture.program?.getTypeChecker();
    for (const association of associations) {
      const at = association.locator;
      if (at.format !== 'typescript-symbol-1') continue;
      const value = at.value as unknown as { file: string; declaration: readonly Selector[] };
      const source = capture.program?.getSourceFile(capture.absolute(value.file));
      if (!capture.snapshot.files.some(file => file.path === value.file)) { this.problem('missing-project-artifact', value.file, 'Associated project file is absent.'); continue; }
      if (!source) { this.problem('outside-project-program', value.file, 'The associated source is outside the captured TypeScript program.'); continue; }
      const nodes = nativeSelection(source, value.declaration);
      if (!nodes.length) { this.problem('missing-project-symbol', value.file, 'The exact associated declaration is absent.'); continue; }
      const constructors = nodes.filter(ts.isConstructorDeclaration);
      const keys = new Set<ts.Symbol | ts.ConstructorDeclaration>(constructors.length ? constructors.map(node => this.construction(node)) : nodes.map(node => this.symbol(named(node)!)).filter((symbol): symbol is ts.Symbol => !!symbol));
      if (keys.size !== 1) { this.problem('ambiguous-project-symbol', value.file, 'The exact declaration address does not identify one native symbol.'); continue; }
      const key = [...keys][0]!;
      const declarations = 'kind' in key ? (key.parent as ts.ClassLikeDeclaration).members.filter(ts.isConstructorDeclaration) : key.declarations ?? [];
      this.selections.push({ id: association.specId, key, nodes: declarations.filter(node => capture.projectPath(node.getSourceFile().fileName) !== undefined) });
      const ids = this.claims.get(key) ?? new Set<string>(); ids.add(association.specId); this.claims.set(key, ids);
    }
    for (const [key, ids] of this.claims) if (ids.size > 1) {
      const node = 'kind' in key ? key : key.declarations![0]!;
      this.problem('conflicting-project-association', capture.projectPath(node.getSourceFile().fileName)!, 'Different specification identities claim the same native symbol.');
    }
  }
  private problem(code: string, file: string, message: string): void { this.problems.push(diagnostic(code, message, file)); }
  selected(id: string): readonly Selection[] { return this.selections.filter(item => item.id === id); }
  definitions(id: string): ArtifactLocator[] {
    return unique(this.selected(id).flatMap(selection => selection.nodes
      .filter(node => this.capture.snapshot.files.some(file => this.capture.absolute(file.path) === node.getSourceFile().fileName))
      .map(node => this.capture.site(node, 'definition')))).sort(siteOrder);
  }
  private symbol(node: ts.Node): ts.Symbol | undefined {
    if (parameterProperty(node.parent)) {
      const owner = node.parent.parent.parent;
      const property = this.checker?.getPropertyOfType(this.checker.getTypeAtLocation(owner), nameOf(node.parent)!);
      if (property) return this.rootSymbol(property);
    }
    const symbol = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
      ? this.checker?.getShorthandAssignmentValueSymbol(node.parent) : this.checker?.getSymbolAtLocation(node);
    return symbol ? this.rootSymbol(symbol.flags & ts.SymbolFlags.Alias ? this.checker!.getAliasedSymbol(symbol) : symbol) : undefined;
  }
  private rootSymbol(symbol: ts.Symbol): ts.Symbol {
    const roots = [...new Set(this.checker!.getRootSymbols(symbol))]; return roots.length === 1 ? roots[0]! : symbol;
  }
  private construction(node: ts.ConstructorDeclaration): ts.ConstructorDeclaration { return (node.parent as ts.ClassLikeDeclaration).members.find(ts.isConstructorDeclaration)!; }
  private claim(key: ts.Symbol | ts.ConstructorDeclaration): string | undefined { const ids = this.claims.get(key); return ids?.size === 1 ? [...ids][0] : undefined; }
  private target(symbol: ts.Symbol, construction?: ts.ConstructorDeclaration): ObservedRelationship['target'] | undefined {
    if (construction) { const id = this.claim(construction); if (id) return { kind: 'specified', id }; if ((this.claims.get(construction)?.size ?? 0) > 1) return undefined; }
    const id = this.claim(symbol); if (id) return { kind: 'specified', id };
    if ((this.claims.get(symbol)?.size ?? 0) > 1) return undefined;
    const declaration = symbol.declarations?.find(node => this.capture.projectPath(node.getSourceFile().fileName) !== undefined);
    if (!declaration) return undefined;
    for (let owner = declaration.parent; owner && !ts.isSourceFile(owner); owner = owner.parent) {
      const name = named(owner), symbol = name && this.symbol(name);
      if (symbol) { const id = this.claim(symbol); if (id) return { kind: 'specified', id }; if ((this.claims.get(symbol)?.size ?? 0) > 1) return undefined; }
    }
    return { kind: 'project', id: this.projectId(declaration) };
  }
  private projectId(node: ts.Node): string { return canonical({ file: this.capture.projectPath(node.getSourceFile().fileName), start: node.getStart(), end: node.getEnd() }); }
  private owner(node: ts.Node): ObservedRelationship['target'] {
    for (let owner: ts.Node | undefined = node; owner && !ts.isSourceFile(owner); owner = owner.parent)
      if (ts.isImportDeclaration(owner) || ts.isExportDeclaration(owner) || ts.isImportEqualsDeclaration(owner)) return { kind: 'project', id: this.projectId(node.getSourceFile()) };
    let nearest: ts.Node | undefined;
    for (let owner = node.parent; owner && !ts.isSourceFile(owner); owner = owner.parent) {
      if (ts.isImportDeclaration(owner) || ts.isExportDeclaration(owner)) break;
      if (ts.isConstructorDeclaration(owner)) { const id = this.claim(this.construction(owner)); if (id) return { kind: 'specified', id }; }
      if (kindOf(owner) && nameOf(owner) !== undefined) nearest ??= owner;
      const name = kindOf(owner) ? named(owner) : undefined, symbol = name && this.symbol(name), id = symbol && this.claim(symbol);
      if (id) return { kind: 'specified', id };
    }
    return { kind: 'project', id: this.projectId(nearest ?? node.getSourceFile()) };
  }
  relationships(id: string, within?: readonly ts.Node[]): { incoming: { uses: ObservedRelationship[]; unresolved: Unresolved[] }; outgoing: { uses: ObservedRelationship[]; unresolved: Unresolved[] } } {
    const selected = this.selected(id), nodes = within ?? selected.flatMap(item => item.nodes), keys = new Set(selected.map(item => item.key));
    const incoming = { uses: [] as ObservedRelationship[], unresolved: [] as Unresolved[] }, outgoing = { uses: [] as ObservedRelationship[], unresolved: [] as Unresolved[] };
    const namedMembers = selected.length > 0 && selected.every(({ key, nodes }) => !('kind' in key) && nodes.length > 0
      && nodes.every(node => ['property', 'method', 'accessor'].includes(kindOf(node) ?? ''))
      && key.name !== 'NaN' && Number.isNaN(Number(key.name)));
    const unrelatedNumericArray = (node: ts.ElementAccessExpression): boolean => {
      if (!namedMembers || !this.checker) return false;
      const receiver = this.checker.getTypeAtLocation(node.expression), key = this.checker.getTypeAtLocation(node.argumentExpression);
      return (this.checker.isArrayType(receiver) || this.checker.isTupleType(receiver))
        && (key.isUnion() ? key.types : [key]).every(type => !!(type.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)));
    };
    const contains = (node: ts.Node) => nodes.some(owner => inside(node, owner));
    const references = new Set<string>(), imports = new Set<ts.ImportDeclaration | ts.ExportDeclaration>();
    // Native reference search supplies alias/merge/member occurrences; the checker supplies each target.
    for (const declaration of nodes) walk(declaration, node => {
      const name = named(node);
      if (!name || !kindOf(node) && !ts.isEnumMember(node)) return;
      const target = ts.isComputedPropertyName(name) ? name.expression : name;
      for (const group of this.capture.service.findReferences(node.getSourceFile().fileName, target.getStart() + (ts.isStringLiteralLike(target) ? 1 : 0)) ?? [])
        for (const reference of group.references) references.add(reference.fileName + ':' + reference.textSpan.start);
    });
    const possibleTarget = (symbol: ts.Symbol): boolean => this.checker!.getRootSymbols(symbol)
      .some(root => keys.has(root) || root.declarations?.some(contains));
    const unresolved = (node: ts.Node, reason: string, relevant = contains(node), incomingRelevant = true): void => {
      const finding = { at: this.capture.site(node, 'unresolved'), reason };
      if (incomingRelevant) incoming.unresolved.push(finding); if (relevant) outgoing.unresolved.push(finding);
    };
    const observe = (use: Use): void => {
      if (new Set(this.checker!.getRootSymbols(use.symbol)).size > 1) {
        unresolved(use.node, 'The native member identifies multiple declarations.', contains(use.node), possibleTarget(use.symbol)); return;
      }
      use = { ...use, symbol: this.rootSymbol(use.symbol) };
      const symbolDeclarations = use.symbol.declarations ?? [], internal = symbolDeclarations.some(contains);
      const targetSelected = keys.has(use.symbol) || internal || !!use.construction && keys.has(use.construction);
      const facetOnly = selected.every(item => ts.isConstructorDeclaration(item.nodes[0]!));
      if (targetSelected && (!facetOnly || !!use.construction && keys.has(use.construction)) && !contains(use.node)
        && (use.construction || references.has(use.node.getSourceFile().fileName + ':' + (use.node.getStart() + (ts.isStringLiteralLike(use.node) ? 1 : 0))))) {
        incoming.uses.push({ target: this.owner(use.node), at: this.capture.site(use.node, use.role) });
      }
      if (!contains(use.node) || internal || symbolDeclarations.some(node => ts.isParameter(node) && !parameterProperty(node))) return;
      const target = this.target(use.symbol, use.construction);
      if (target && !(target.kind === 'specified' && target.id === id)) outgoing.uses.push({ target, at: this.capture.site(use.node, use.role) });
    };
    for (const source of this.capture.sources) walk(source, node => {
      if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && !node.dotDotDotToken) {
        const property = node.propertyName ?? node.name;
        const key = ts.isComputedPropertyName(property) ? property.expression : property;
        if (ts.isIdentifier(key) && !ts.isComputedPropertyName(property) || ts.isStringLiteralLike(key) || ts.isNumericLiteral(key)) {
          const receiver = this.checker!.getTypeAtLocation(node.parent);
          const members = receiver.isUnion() ? new Set(receiver.types.flatMap(type => {
            const property = this.checker!.getPropertyOfType(type, key.text); return property ? [this.rootSymbol(property)] : [];
          })) : undefined;
          if (members && members.size > 1) unresolved(key, 'Union members identify different declarations.', contains(key), [...members].some(possibleTarget));
          else {
            const symbol = this.checker!.getPropertyOfType(receiver, key.text);
            if (symbol) observe({ node: key, symbol, role: 'value' });
          }
        } else if (ts.isComputedPropertyName(property)) unresolved(property, 'Computed member lookup has no unique static target.');
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && ['require', 'eval'].includes(node.expression.text))) {
        if (node.expression.getText() === 'eval' || !node.arguments[0] || !ts.isStringLiteralLike(node.arguments[0])) unresolved(node, 'Dynamic code/module lookup has no single static target.');
      }
      if (ts.isElementAccessExpression(node) && !ts.isStringLiteralLike(node.argumentExpression) && !ts.isNumericLiteral(node.argumentExpression))
        unresolved(node, 'Computed member lookup has no unique static target.', contains(node), !unrelatedNumericArray(node));
      if (node.kind === ts.SyntaxKind.SuperKeyword && ts.isCallExpression(node.parent)) {
        const declaration = this.checker?.getResolvedSignature(node.parent)?.declaration;
        if (declaration && ts.isConstructorDeclaration(declaration)) {
          const symbol = this.symbol(named(declaration.parent)!);
          if (symbol) observe({ node, symbol, role: 'construct', construction: this.construction(declaration) });
        }
      }
      const literalMember = (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node))
        && (ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node
          || ts.isLiteralTypeNode(node.parent) && ts.isIndexedAccessTypeNode(node.parent.parent) && node.parent.parent.indexType === node.parent);
      if (!(ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || literalMember)) return;
      const role = this.role(node); if (!role) return;
      if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node || ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node) {
        const receiver = this.checker!.getTypeAtLocation(node.parent.expression);
        if (receiver.isUnion()) {
          const name = ts.isPropertyAccessExpression(node.parent) ? node.parent.name.text : ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) ? node.text : '';
          const members = new Set(receiver.types.flatMap(type => {
            const property = this.checker!.getPropertyOfType(type, name); return property ? [this.rootSymbol(property)] : [];
          }));
          if (members.size > 1) { unresolved(node.parent, 'Union members identify different declarations.', contains(node), [...members].some(possibleTarget)); return; }
        }
      }
      const raw = this.checker?.getSymbolAtLocation(node);
      if (contains(node)) for (const declaration of raw?.declarations ?? []) {
        for (let owner: ts.Node | undefined = declaration; owner; owner = owner.parent) if (ts.isImportDeclaration(owner) || ts.isExportDeclaration(owner)) { imports.add(owner); break; }
      }
      const symbol = this.symbol(node);
      if (!symbol?.declarations?.length) return;
      let construction: ts.ConstructorDeclaration | undefined;
      if (role === 'construct') {
        let expression: ts.Node = node; while (ts.isPropertyAccessExpression(expression.parent)) expression = expression.parent;
        if (ts.isNewExpression(expression.parent)) { const declaration = this.checker?.getResolvedSignature(expression.parent)?.declaration; if (declaration && ts.isConstructorDeclaration(declaration)) construction = this.construction(declaration); }
      }
      observe({ node, symbol, role, ...(construction ? { construction } : {}) });
    });
    // Preserve native unresolved causes, including an unavailable import actually used by the subject.
    for (const problem of this.capture.problems) if (/^typescript-(2304|2307|2339|2551|7016|2792)$/.test(problem.code) && problem.at.kind === 'dependency') {
      const [, file, start, length] = problem.at.path;
      if (typeof file !== 'string' || typeof start !== 'number' || typeof length !== 'number') continue;
      if (!this.capture.snapshot.files.some(item => item.path === file)) continue;
      const source = this.capture.program?.getSourceFile(this.capture.absolute(file)); if (!source) continue;
      const at: ArtifactLocator = { outputId: this.capture.outputId, format: 'typescript-site-1', value: { file, version: this.capture.snapshot.files.find(item => item.path === file)!.version, start, end: start + length, role: 'unresolved' } };
      const finding = { at, reason: problem.message }; incoming.unresolved.push(finding);
      if (nodes.some(node => node.getSourceFile() === source && start >= node.pos && start < node.end)
        || [...imports].some(node => node.getSourceFile() === source && start >= node.pos && start < node.end)) outgoing.unresolved.push(finding);
    }
    for (const observation of [incoming, outgoing]) { observation.uses = unique(observation.uses).sort((a, b) => siteOrder(a.at, b.at) || ordinal(canonical(a.target), canonical(b.target))); observation.unresolved = unique(observation.unresolved).sort((a, b) => siteOrder(a.at, b.at)); }
    return { incoming, outgoing };
  }
  private role(node: ts.Node): string | undefined {
    for (let owner: ts.Node | undefined = node.parent; owner && !ts.isSourceFile(owner); owner = owner.parent) {
      if (ts.isImportDeclaration(owner) || ts.isImportEqualsDeclaration(owner)) return 'import';
      if (ts.isExportDeclaration(owner) || ts.isExportAssignment(owner)) return 'export';
    }
    if (named(node.parent) === node && !ts.isPropertyAccessExpression(node.parent) && !ts.isShorthandPropertyAssignment(node.parent)
      || ts.isBindingElement(node.parent) && node.parent.propertyName === node) return undefined;
    let expression = node;
    if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node || ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node) expression = node.parent;
    if (ts.isNewExpression(expression.parent) && expression.parent.expression === expression) return 'construct';
    if (ts.isCallExpression(expression.parent) && expression.parent.expression === expression) return 'call';
    for (let owner: ts.Node | undefined = node.parent; owner && !ts.isStatement(owner); owner = owner.parent) if (ts.isTypeNode(owner)) return 'type';
    return 'value';
  }
}

export function unique<T>(items: readonly T[]): T[] { return [...new Map(items.map(item => [canonical(item), item])).values()]; }
export function siteOrder(a: ArtifactLocator, b: ArtifactLocator): number {
  const left = a.value as { file: string; start: number; role: string }, right = b.value as typeof left;
  return ordinal(left.file, right.file) || left.start - right.start || ordinal(left.role, right.role);
}
