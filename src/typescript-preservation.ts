import ts from 'typescript';
import type { Diagnostic } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { ArtifactAssociation, SpecDiff } from './specification-identity.js';
import type { FileChange } from './project-writer.js';
import { canonical } from './identity-baseline.js';
import { hash } from './project-files.js';
import { TypeScriptCapture, diagnostic } from './typescript-capture.js';
import { TypeScriptSymbols, nativeSelection, type Selector } from './typescript-symbols.js';
import { NativeEdits, headerEnd, nativeMembers, nativeName, tokens, type NativeDeclaration } from './typescript-edits.js';
import type { NativeContainer, NativeFile, TypeScriptOptions } from './typescript-declarations.js';
import { nativeImports, nativeTypeText } from './typescript-imports.js';

export interface NativeBaseline {
  id: string; path: string; generated: string; hash: string; artifacts: ArtifactAssociation[];
  container?: NativeContainer;
  renderedArtifacts?: ArtifactAssociation[] | undefined; adopted?: string[] | undefined; documentation?: string[] | undefined; confirmed?: string | undefined;
}
const address = (item: ArtifactAssociation) => item.locator.value as unknown as { file: string; declaration: Selector[] };
const kind = (node: ts.Node) => ts.isClassDeclaration(node) ? 'class' : ts.isInterfaceDeclaration(node) ? 'interface'
  : ts.isTypeAliasDeclaration(node) ? 'type' : ts.isFunctionDeclaration(node) ? 'function'
  : ts.isConstructorDeclaration(node) ? 'constructor' : ts.isMethodDeclaration(node) || ts.isMethodSignature(node) ? 'method' : 'property';
const selectionKey = (item: ArtifactAssociation) => item.specId + ':' + address(item).declaration.map(part => part.kind).join('/');
type Located = Pick<ts.Node, 'end' | 'getStart' | 'getSourceFile'>;
const docs = (node: ts.Node) => {
  const file = node.getSourceFile(), ranges = [...ts.getLeadingCommentRanges(file.text, node.pos) ?? [], ...ts.getTrailingCommentRanges(file.text, node.pos) ?? []];
  return [...new Map(ranges.filter(range => range.end <= node.getStart() && file.text.startsWith('/**', range.pos)).map(range => [range.pos, range])).values()]
    .filter(range => file.text.slice(range.pos, range.end) !== '/** Number profile: JavaScript binary64. */')
    .map(range => ({ end: range.end, getStart: () => range.pos, getSourceFile: () => file, getText: () => file.text.slice(range.pos, range.end) }));
};
const within = (node: ts.Node, owner: ts.Node): boolean => node.getSourceFile() === owner.getSourceFile() && node.getStart() >= owner.getStart() && node.end <= owner.end;
function declarations(files: readonly NativeFile[]): Map<string, NativeDeclaration> {
  const nodes = new Map<string, NativeDeclaration>();
  for (const file of files) {
    const source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true);
    for (const item of file.artifacts) {
      let owners: readonly ts.Node[] = [source];
      for (const part of address(item).declaration) owners = owners.flatMap(owner => nativeMembers(owner).filter(node => kind(node) === part.kind && nativeName(node) === part.name));
      if (owners.length === 1) nodes.set(selectionKey(item), owners[0] as NativeDeclaration);
    }
  }
  return nodes;
}

/** Compares generated contracts with captured native declarations, preserving implementation spans. */
export class TypeScriptPreservation {
  readonly problems: Diagnostic[] = [];
  readonly files: NativeBaseline[] = [];
  readonly changes: FileChange[] = [];
  private readonly edits = new NativeEdits();
  constructor(private readonly snapshot: ProjectSnapshot, private readonly options: TypeScriptOptions, private readonly diff?: SpecDiff, private readonly outputId = 'typescript') {}
  reconcile(previous: readonly NativeBaseline[], desired: readonly NativeFile[], mappings: readonly ArtifactAssociation[], adoption: boolean): void {
    if (!previous.length && !mappings.some(item => item.locator.outputId === this.outputId) && !desired.some(file => file.container && this.snapshot.files.some(item => item.path === file.path))) {
      for (const file of desired) {
        this.files.push({ id: file.id, path: file.path, generated: file.text, hash: hash(Buffer.from(file.text)), artifacts: structuredClone(file.artifacts) as ArtifactAssociation[], confirmed: hash(Buffer.from(file.text)), ...file.container ? { container: file.container } : {} });
        this.changes.push({ kind: 'write', path: file.path, bytes: Buffer.from(file.text) });
      }
      return;
    }
    const capture = new TypeScriptCapture(this.snapshot, this.outputId, this.options.configFile);
    try {
      const oldArtifacts = previous.flatMap(file => file.artifacts), claimed = mappings.filter(item => item.locator.outputId === this.outputId);
      const placements = new Map(desired.map(file => {
        const prior = previous.find(item => item.id === file.id), mapped = claimed.find(item => item.specId === file.id);
        return [file.id, prior?.adopted?.length ? prior.path : !prior && mapped ? address(mapped).file : file.path];
      }));
      const associations = [...oldArtifacts, ...claimed.filter(item => !oldArtifacts.some(old => old.specId === item.specId))];
      const symbols = new TypeScriptSymbols(capture, associations), actual = new Map<string, NativeDeclaration>();
      this.problems.push(...symbols.problems);
      for (const association of associations) {
        const selected = symbols.selected(association.specId).find(item => item.nodes.some(node => kind(node) === address(association).declaration.at(-1)!.kind));
        const node = selected?.nodes.find(node => !('body' in node) || !!node.body) ?? selected?.nodes[0];
        if (node) actual.set(selectionKey(association), node as NativeDeclaration);
      }
      const old = declarations(previous.map(file => ({ id: file.id, path: file.path,
        text: file.generated, artifacts: file.renderedArtifacts ?? file.artifacts }))), next = declarations(desired);
      if (previous.some(file => (file.renderedArtifacts ?? file.artifacts).some(item => !old.has(selectionKey(item))))) {
        this.problems.push(diagnostic('invalid-output-state', 'Recorded generated syntax does not describe its associated declarations.', '.expec/outputs/74797065736372697074.json')); return;
      }
      const touched = new Set(associations.map(item => address(item).file));
      const syntax = capture.program?.getSyntacticDiagnostics().filter(item => item.file && touched.has(capture.projectPath(item.file.fileName)!)) ?? [];
      if (syntax.length) { this.problems.push(...syntax.map(item => capture.nativeDiagnostic(item))); return; }
      const beforeByKey = new Map(oldArtifacts.map(item => [selectionKey(item), item])), nextArtifacts = desired.flatMap(file => file.artifacts),
        afterByKey = new Map(nextArtifacts.map(item => [selectionKey(item), item])), removed = new Set<string>(), moves = new Map<string, string>();
      const ownerId = (item: ArtifactAssociation, items: readonly ArtifactAssociation[]) => items.find(candidate => address(candidate).file === address(item).file
        && canonical(address(candidate).declaration) === canonical(address(item).declaration.slice(0, -1)))?.specId;
      const problem = (code: string, node: Located, message: string) => this.problems.push(diagnostic(code, message, capture.projectPath(node.getSourceFile().fileName)!, node.getStart(), node.end - node.getStart()));
      const manual = (key: string, node: NativeDeclaration): boolean => {
        const baseline = old.get(key), record = previous.find(file => file.artifacts.some(item => selectionKey(item) === key));
        if (!baseline || record?.adopted?.includes(beforeByKey.get(key)!.specId)) return true;
        if (node.body && (!baseline.body || tokens(node.body.getText(), true) !== tokens(baseline.body.getText(), true))) return true;
        if (node.initializer && (!baseline.initializer || tokens(node.initializer.getText(), true) !== tokens(baseline.initializer.getText(), true))) return true;
        const ownedDocs = docs(baseline).map(doc => doc.getText());
        if (docs(node).some(doc => !ownedDocs.includes(doc.getText())) || ownedDocs.some(text => docs(node).filter(doc => doc.getText() === text).length !== 1)) return true;
        const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, node.getText()), allowed = [...actual.entries()]
          .filter(([, member]) => within(member, node)).flatMap(([key, member]) => docs(member).filter(comment => docs(old.get(key) ?? member).some(owned => owned.getText() === comment.getText())));
        for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan())
          if ((token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia)
            && !allowed.some(comment => comment.getStart() === node.getStart() + scanner.getTokenPos())) return true;
        return nativeMembers(node).some(member => ![...actual.entries()].some(([childKey, child]) => child === member && !manual(childKey, child)));
      };
      for (const [key, node] of actual) {
        const before = beforeByKey.get(key), after = afterByKey.get(key); if (!before) continue;
        const moved = after && ownerId(before, oldArtifacts) !== ownerId(after, nextArtifacts);
        if (!after || moved) {
          if (!after && nextArtifacts.some(item => item.specId === before.specId)) { problem('implemented-kind-change', node, 'Changing this native declaration kind cannot preserve its implementation.'); continue; }
          if (manual(key, node)) { problem(moved ? 'unsupported-implementation-move' : 'handwritten-removal', node, 'This declaration contains handwritten implementation or documentation.'); continue; }
          if (!this.complete(capture, symbols, before.specId, node, after ? 'incomplete-native-rename' : 'incomplete-output-search')) continue;
          const incoming = symbols.relationships(before.specId).incoming.uses;
          for (const use of incoming) {
            const site = use.at.value as { file: string; start: number; end: number };
            const disappearing = [...actual].some(([candidate, owner]) => !afterByKey.has(candidate) && capture.projectPath(owner.getSourceFile().fileName) === site.file && site.start >= owner.getStart() && site.end <= owner.end);
            if (!disappearing) this.problems.push(diagnostic('remaining-native-use', 'A native consumer still uses this declaration.', site.file, site.start, site.end - site.start));
          }
          removed.add(key);
        }
      }
      for (const key of removed) {
        const node = actual.get(key)!;
        if ([...removed].some(parent => parent !== key && within(node, actual.get(parent)!))) continue;
        this.edits.add(capture.projectPath(node.getSourceFile().fileName)!, docs(node)[0]?.getStart() ?? node.getStart(), node.end, '');
      }
      const typeNames = new Map<string, string>();
      for (const file of [...previous.map(file => ({ artifacts: file.renderedArtifacts ?? file.artifacts })), ...desired])
        for (const item of file.artifacts) if (address(item).declaration.length === 1) typeNames.set(address(item).declaration[0]!.name, item.specId);
      const contracts = new NativeContracts(capture, symbols, typeNames, [...new Set([...old.values(), ...next.values()].map(node => node.getSourceFile()))]);
      for (const [key, node] of actual) {
        const prior = old.get(key), wanted = next.get(key), association = beforeByKey.get(key);
        if (!prior || !wanted || !association || nativeName(prior) === nativeName(wanted)) continue;
        if (nativeMembers(node.parent).some(sibling => sibling !== node && nativeName(sibling) === nativeName(wanted))) problem('native-name-conflict', node, 'The requested native name is already declared.');
        else this.rename(capture, symbols, node, nativeName(wanted), association.specId);
      }
      for (const file of desired) {
        const before = previous.find(item => item.id === file.id), rootMapping = claimed.find(item => item.specId === file.id),
          isAdopted = !before && (!!rootMapping || !!file.container && this.snapshot.files.some(item => item.path === file.path)),
          path = before?.adopted?.length ? before.path : isAdopted && rootMapping ? address(rootMapping).file : file.path;
        if (isAdopted && !adoption) { this.problems.push(diagnostic('unowned-project-artifact', 'Explicit adoption permission is required for this existing declaration.', path)); continue; }
        const artifacts: ArtifactAssociation[] = [], adopted = before?.adopted?.filter(id => file.artifacts.some(item => item.specId === id)) ?? (isAdopted ? file.artifacts.map(item => item.specId) : []);
        const documentation = new Set(before?.documentation ?? []);
        const existingSource = capture.program?.getSourceFile(capture.absolute(before?.path ?? path));
        const aliases = existingSource && before ? nativeImports(capture, symbols, existingSource, file, desired, placements, associations, this.edits, this.problems) : new Map<string, string>();
        if (before && before.path !== path) {
          if (this.snapshot.files.some(item => item.path.toLowerCase() === path.toLowerCase())) { this.problems.push(diagnostic('native-name-conflict', 'The renamed file destination is occupied or aliases its source.', path)); continue; }
          moves.set(before.path, path);
          for (const edit of capture.service.getEditsForFileRename(capture.absolute(before.path), capture.absolute(path), {}, {})) {
            const file = capture.projectPath(edit.fileName);
            if (!file) { this.problems.push(diagnostic('incomplete-native-rename', 'Native module edits escape captured scope.', before.path)); continue; }
            for (const change of edit.textChanges) this.edits.add(file, change.span.start, change.span.start + change.span.length, change.newText);
          }
        }
        for (const association of file.artifacts) {
          const key = selectionKey(association), wanted = next.get(key)!, prior = old.get(key), node = removed.has(key) ? undefined : actual.get(key);
          if (isAdopted && !claimed.some(item => selectionKey(item) === key)) { this.problems.push(diagnostic('incomplete-adoption', 'Every represented declaration needs an explicit native association.', path)); continue; }
          const placement = isAdopted ? claimed.find(item => selectionKey(item) === key)! : beforeByKey.get(key);
          const parts = address(association).declaration.map((part, index) => {
            const original = placement && address(placement).declaration[index], rendered = (before?.renderedArtifacts ?? before?.artifacts)?.find(item => selectionKey(item) === key);
            return { ...part, ...(original && (!rendered || address(rendered).declaration[index]?.name === part.name) ? { name: original.name } : {}) };
          });
          artifacts.push({ specId: association.specId, locator: { ...association.locator, value: { file: path, declaration: parts } } });
          if (!before && !isAdopted) continue;
          if (node) {
            const baseline = prior ?? wanted;
            if (contracts.shape(node, true) !== contracts.shape(baseline, false)) {
              const at = node.parameters?.find((parameter, index) => canonical(contracts.type(parameter.type, true)) !== canonical(contracts.type(baseline.parameters?.[index]?.type, false)))?.type ?? node.type ?? node;
              this.problems.push(diagnostic(isAdopted ? 'adoption-contract-mismatch' : 'contract-drift', 'Current native contract differs from the recorded contract.', capture.projectPath(node.getSourceFile().fileName)!, at.getStart(), at.end - at.getStart())); continue;
            }
            const actualPath = capture.projectPath(node.getSourceFile().fileName)!;
            if (prior && contracts.shape(prior, false) !== contracts.shape(wanted, false)) this.signature(contracts, node, prior, wanted, association.specId, aliases);
            if (prior && canonical(docs(prior).map(doc => doc.getText())) !== canonical(docs(wanted).map(doc => doc.getText()))) {
              this.documentation(node, prior, wanted, actualPath, !adopted.includes(association.specId) || documentation.has(association.specId));
              documentation.add(association.specId);
            }
          } else if (prior && !removed.has(key)) this.problems.push(diagnostic('missing-project-symbol', 'Recorded declaration is absent.', path));
          else {
            const parentId = ownerId(association, nextArtifacts), parentAssociation = oldArtifacts.find(item => item.specId === parentId),
              container = file.container && existingSource ? nativeSelection(existingSource, file.container.declaration) : [],
              parent = parentAssociation ? actual.get(selectionKey(parentAssociation)) : container.length === 1 ? container[0] : undefined;
            if (!parent) { this.problems.push(diagnostic('missing-project-symbol', 'The parent for this member is unavailable.', path)); continue; }
            const collision = nativeMembers(parent).find(member => nativeName(member) === nativeName(wanted));
            if (collision) { problem('native-name-conflict', collision, 'An existing unowned member occupies this native name.'); continue; }
            const source = parent.getSourceFile(), newline = source.text.includes('\r\n') ? '\r\n' : '\n';
            const body = ts.isTypeAliasDeclaration(parent) && ts.isTypeLiteralNode(parent.type) ? parent.type : parent;
            const documentation = docs(wanted).map(doc => doc.getText() + newline).join('');
            this.edits.add(capture.projectPath(source.fileName)!, body.end - 1, body.end - 1, newline + documentation + nativeTypeText(wanted, aliases).replace(/\r?\n/g, newline) + newline);
          }
        }
        this.files.push({ id: file.id, path, generated: file.text, hash: hash(Buffer.from(file.text)), artifacts,
          ...file.container ? { container: file.container } : {},
          ...(adopted.length ? { adopted, renderedArtifacts: structuredClone(file.artifacts) as ArtifactAssociation[], documentation: [...documentation].sort() } : {}) });
      }
      if (this.problems.length) return;
      this.finish(previous, moves);
    } finally { capture.service.dispose(); }
  }
  private signature(contracts: NativeContracts, node: NativeDeclaration, prior: NativeDeclaration, wanted: NativeDeclaration, id: string, aliases: ReadonlyMap<string, string>): void {
    const { capture, symbols } = contracts, source = node.getSourceFile(), actualPath = capture.projectPath(source.fileName)!, newline = source.text.includes('\r\n') ? '\r\n' : '\n';
    if (symbols.selected(id).some(selection => selection.nodes.filter(candidate => 'parameters' in candidate).length > 1)) {
      this.problem(capture, 'unsupported-overload-change', node, 'A changed contract has no safe correspondence to every native overload signature.'); return;
    }
    for (const change of this.diff?.changes ?? []) {
      if (change.before?.address.owner !== id || change.after?.address.owner !== id || !change.kinds.includes('rename')) continue;
      const parameters = change.before.address.kind === 'type-parameter' ? prior.typeParameters : prior.parameters,
        nextParameters = change.before.address.kind === 'type-parameter' ? wanted.typeParameters : wanted.parameters,
        currentParameters = change.before.address.kind === 'type-parameter' ? node.typeParameters : node.parameters;
      const index = parameters?.findIndex(parameter => nativeName(parameter) === change.before!.address.name) ?? -1,
        nextParameter = nextParameters?.find(parameter => nativeName(parameter) === change.after!.address.name), currentParameter = currentParameters?.[index];
      if (nextParameter && currentParameter) this.rename(capture, symbols, currentParameter, nativeName(nextParameter), id, [node]);
    }
    if (canonical(prior.typeParameters?.map(parameter => parameter.getText())) !== canonical(wanted.typeParameters?.map(parameter => parameter.getText()))) {
      const text = wanted.typeParameters?.map(parameter => nativeTypeText(parameter, aliases)).join(', ');
      if (node.typeParameters) this.edits.replaceSyntax(actualPath, source.text, node.typeParameters.pos - 1, node.typeParameters.end + 1, text === undefined ? '' : '<' + text + '>');
      else if (text !== undefined) this.edits.add(actualPath, node.name!.end, node.name!.end, '<' + text + '>');
    }
    if (node.parameters && wanted.parameters) {
      const retained: { start: number; end: number }[] = [];
      const parameters = wanted.parameters.map(parameter => {
        const renamed = this.diff?.changes.find(change => change.before?.address.owner === id && change.after?.address.name === nativeName(parameter) && change.kinds.includes('rename'));
        const priorParameter = prior.parameters?.find(candidate => nativeName(candidate) === (renamed?.before?.address.name ?? nativeName(parameter))),
          currentParameter = priorParameter && node.parameters?.[prior.parameters!.indexOf(priorParameter)];
        let text = nativeTypeText(parameter, aliases);
        if (currentParameter) {
          const start = currentParameter.getStart(), local = this.edits.within(actualPath, start, currentParameter.end);
          if (nativeName(currentParameter) !== nativeName(parameter)) local.add('', currentParameter.name.getStart() - start, currentParameter.name.end - start, parameter.name.getText());
          if (parameter.type && currentParameter.type && canonical(contracts.type(parameter.type, false)) !== canonical(contracts.type(priorParameter?.type, false)))
            local.replaceSyntax('', currentParameter.getText(), currentParameter.type.getStart() - start, currentParameter.type.end - start, nativeTypeText(parameter.type, aliases));
          if (!!currentParameter.questionToken !== !!parameter.questionToken) local.add('', (currentParameter.questionToken?.getStart() ?? currentParameter.name.end) - start, (currentParameter.questionToken?.end ?? currentParameter.name.end) - start, parameter.questionToken ? '?' : '');
          text = local.apply('', currentParameter.getText());
        }
        const prefix = currentParameter ? source.text.slice(currentParameter.pos, currentParameter.getStart()).trimStart() : '',
          suffix = currentParameter ? source.text.slice(currentParameter.end, ts.getTrailingCommentRanges(source.text, currentParameter.end)?.at(-1)?.end ?? currentParameter.end) : '';
        if (currentParameter) retained.push({ start: currentParameter.pos, end: currentParameter.end + suffix.length });
        return prefix + text + suffix;
      });
      const children = node.getChildren(), opening = children.find(child => child.kind === ts.SyntaxKind.OpenParenToken)!, closing = children.find(child => child.kind === ts.SyntaxKind.CloseParenToken)!;
      const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source.text.slice(opening.end, closing.getStart())), orphaned: string[] = [];
      for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
        if (token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
        const at = opening.end + scanner.getTokenPos();
        if (retained.some(range => at >= range.start && at < range.end)) continue;
        const generated = node.parameters.some((parameter, index) => docs(parameter).filter(comment => comment.getText() === scanner.getTokenText()).length === 1
          && docs(parameter).some(comment => comment.getStart() === at) && docs(prior.parameters![index]!).some(comment => comment.getText() === scanner.getTokenText()));
        if (!generated) orphaned.push(scanner.getTokenText() + (token === ts.SyntaxKind.SingleLineCommentTrivia ? newline : ' '));
      }
      this.edits.add(actualPath, opening.end, closing.getStart(), (parameters.join(', ') + (orphaned.length ? ' ' + orphaned.join('') : '')).replace(/\r?\n/g, newline), true);
    }
    if (node.type && wanted.type && !(ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) && canonical(contracts.type(prior.type, false)) !== canonical(contracts.type(wanted.type, false)))
      this.edits.replaceSyntax(actualPath, source.text, node.type.getStart(), node.type.end, nativeTypeText(wanted.type, aliases));
    const question = (node as NativeDeclaration).questionToken;
    if (!!question !== !!wanted.questionToken) this.edits.add(actualPath, question?.getStart() ?? node.name!.end, question?.end ?? node.name!.end, wanted.questionToken ? '?' : '');
    for (const modifierKind of [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.ReadonlyKeyword]) {
      const current = ts.canHaveModifiers(node) ? ts.getModifiers(node)?.find(modifier => modifier.kind === modifierKind) : undefined,
        desired = ts.canHaveModifiers(wanted) ? ts.getModifiers(wanted)?.find(modifier => modifier.kind === modifierKind) : undefined;
      if (current && !desired) this.edits.add(actualPath, current.getStart(), current.end, '');
      else if (!current && desired) this.edits.add(actualPath, node.name?.getStart() ?? node.getStart(), node.name?.getStart() ?? node.getStart(), desired.getText() + ' ');
    }
  }
  private documentation(node: NativeDeclaration, prior: NativeDeclaration, wanted: NativeDeclaration, actualPath: string, ownedPreviously: boolean): void {
    const newline = node.getSourceFile().text.includes('\r\n') ? '\r\n' : '\n';
    const baselineDocs = ownedPreviously ? docs(prior) : [], currentDocs = docs(node), replacements = docs(wanted);
    const owned = baselineDocs.map(doc => currentDocs.filter(candidate => candidate.getText() === doc.getText()));
    if (owned.some(matches => matches.length !== 1)) {
      const at = currentDocs.at(-1) ?? node; this.problems.push(diagnostic('owned-documentation-drift', 'The generated documentation was changed or cannot be identified unambiguously.', actualPath, at.getStart(), at.end - at.getStart()));
    } else {
      const text = replacements.map(doc => doc.getText()).join(newline).replace(/\r?\n/g, newline);
      if (owned.length) { this.edits.add(actualPath, owned[0]![0]!.getStart(), owned[0]![0]!.end, text); for (const matches of owned.slice(1)) this.edits.add(actualPath, matches[0]!.getStart(), matches[0]!.end, ''); }
      else if (text) this.edits.add(actualPath, node.getStart(), node.getStart(), text + newline);
    }
  }
  private rename(capture: TypeScriptCapture, symbols: TypeScriptSymbols, node: ts.Node, newName: string, id: string, boundaries: readonly ts.Node[] = []): void {
    let name = 'name' in node ? node.name as ts.Node : node; if (ts.isComputedPropertyName(name)) name = name.expression;
    const source = name.getSourceFile(), position = name.getStart() + (ts.isStringLiteralLike(name) ? 1 : 0), checker = capture.program!.getTypeChecker(), selected = checker.getSymbolAtLocation(name);
    const namespace = ts.isParameter(node) ? ts.SymbolFlags.Value : ts.isTypeParameterDeclaration(node) ? ts.SymbolFlags.Type : ts.SymbolFlags.Value | ts.SymbolFlags.Type;
    const member = ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node);
    if (!member && checker.getSymbolsInScope(node, namespace).some(symbol => symbol.getName() === newName && symbol !== selected)) { this.problem(capture, 'native-name-conflict', node, 'The new name conflicts with an existing native binding.'); return; }
    if (!this.complete(capture, symbols, id, node, 'incomplete-native-rename')) return;
    const info = capture.service.getRenameInfo(source.fileName, position, { providePrefixAndSuffixTextForRename: true });
    const locations = info.canRename ? capture.service.findRenameLocations(source.fileName, position, false, false, { providePrefixAndSuffixTextForRename: true }) : undefined;
    if (!locations?.length) { this.problem(capture, 'incomplete-native-rename', node, 'The native language service could not establish rename locations.'); return; }
    for (const location of locations) {
      const path = capture.projectPath(location.fileName); if (!path) { this.problem(capture, 'incomplete-native-rename', node, 'A rename location is outside the captured project.'); continue; }
      if (boundaries.some(boundary => boundary.getSourceFile().fileName === location.fileName && location.textSpan.start >= boundary.getStart() && location.textSpan.start + location.textSpan.length <= headerEnd(boundary as NativeDeclaration))) continue;
      let bareExport = false, token: ts.Node | undefined;
      const visit = (node: ts.Node): void => { if (node.getStart() <= location.textSpan.start && node.end >= location.textSpan.start + location.textSpan.length) {
        if (ts.isExportSpecifier(node) && !node.propertyName) bareExport = true; token = node; ts.forEachChild(node, visit);
      } };
      const file = capture.program?.getSourceFile(location.fileName); if (file) visit(file);
      const receiver = token && (ts.isPropertyAccessExpression(token.parent) && token.parent.name === token
        || ts.isElementAccessExpression(token.parent) && token.parent.argumentExpression === token) ? token.parent.expression : undefined;
      if (receiver) {
        const property = checker.getPropertyOfType(checker.getTypeAtLocation(receiver), newName), roots = selected && new Set(checker.getRootSymbols(selected));
        if (property && checker.getRootSymbols(property).some(root => !roots?.has(root))) {
          this.problem(capture, 'native-name-conflict', token!, 'The new member name selects a different native receiver property.'); continue;
        }
      }
      if (token && ts.isIdentifier(token) && !(ts.isPropertyAccessExpression(token.parent) && token.parent.name === token)
        && !(ts.isPropertyDeclaration(token.parent) || ts.isPropertySignature(token.parent) || ts.isMethodDeclaration(token.parent) || ts.isMethodSignature(token.parent))) {
        const siteSymbol = checker.getSymbolAtLocation(token);
        if (checker.getSymbolsInScope(token, namespace | ts.SymbolFlags.Alias).some(symbol => symbol.getName() === newName && symbol !== selected && symbol !== siteSymbol)) {
          this.problem(capture, 'native-name-conflict', token, 'The new name conflicts with a binding at this native reference.'); continue;
        }
      }
      this.edits.add(path, location.textSpan.start, location.textSpan.start + location.textSpan.length, bareExport ? newName : (location.prefixText ?? '') + newName + (location.suffixText ?? ''));
    }
  }
  private complete(capture: TypeScriptCapture, symbols: TypeScriptSymbols, id: string, node: ts.Node, code: string): boolean {
    const observation = symbols.relationships(id);
    if (capture.problems.length || observation.incoming.unresolved.length) { this.problem(capture, code, node, 'Captured native references do not establish a complete refactoring scope.'); return false; }
    return true;
  }
  private problem(capture: TypeScriptCapture, code: string, node: Located, message: string): void {
    this.problems.push(diagnostic(code, message, capture.projectPath(node.getSourceFile().fileName)!, node.getStart(), node.end - node.getStart()));
  }
  private finish(previous: readonly NativeBaseline[], moves: ReadonlyMap<string, string>): void {
    const texts = new Map<string, string>();
    for (const path of new Set([...this.edits.paths, ...previous.map(file => file.path), ...this.files.map(file => file.path)])) {
      const original = [...moves].find(([, after]) => after === path)?.[0] ?? path, captured = this.snapshot.files.find(item => item.path === original);
      if (captured) texts.set(moves.get(original) ?? original, this.edits.source(original, new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(captured.bytes)));
      else if (this.files.some(file => file.path === path)) texts.set(path, this.files.find(file => file.path === path)!.generated);
    }
    for (const [path, text] of texts) {
      const original = [...moves].find(([, after]) => after === path)?.[0] ?? path, captured = this.snapshot.files.find(item => item.path === original), bytes = Buffer.from(text);
      for (const file of this.files.filter(file => file.path === path)) file.confirmed = hash(bytes);
      if (original !== path) this.changes.push({ kind: 'move', from: original, to: path, bytes });
      else if (!text.trim() && !this.files.some(file => file.path === path)) this.changes.push({ kind: 'remove', path });
      else if (!captured || hash(bytes) !== captured.version) this.changes.push({ kind: 'write', path, bytes });
    }
    this.problems.push(...this.edits.problems);
  }
}

class NativeContracts {
  private readonly imports = new Map<ts.SourceFile, Map<string, string>>();
  private readonly imported = new Map<ts.Symbol, string>();
  constructor(readonly capture: TypeScriptCapture, readonly symbols: TypeScriptSymbols, private readonly names: ReadonlyMap<string, string>, sources: readonly ts.SourceFile[]) {
    const checker = capture.program!.getTypeChecker();
    for (const source of sources) {
      const bindings = new Map<string, string>(); this.imports.set(source, bindings);
      for (const statement of source.statements.filter(ts.isImportDeclaration)) {
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const members = statement.importClause?.namedBindings;
        if (!members || !ts.isNamedImports(members)) continue;
        const target = capture.resolveModule(statement.moduleSpecifier.text, source.fileName), module = target && checker.getSymbolAtLocation(target);
        for (const member of members.elements) {
          const name = member.propertyName?.text ?? member.name.text;
          let symbol = module && checker.getExportsOfModule(module).find(symbol => symbol.getName() === name);
          if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
          let key = symbol && this.imported.get(symbol);
          if (symbol && !key) { key = 'native-import-' + this.imported.size; this.imported.set(symbol, key); }
          bindings.set(member.name.text, key ?? 'unavailable-import:' + statement.moduleSpecifier.text + ':' + name);
        }
      }
    }
  }
  type(node: ts.Node | undefined, native: boolean): unknown {
    if (!node) return null;
    if (ts.isTypeReferenceNode(node)) {
      const spelling = node.typeName.getText(); let name: unknown;
      if (native) {
        const checker = this.capture.program!.getTypeChecker(); let symbol = checker.getSymbolAtLocation(node.typeName);
        if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        const claim = this.symbols.selections.find(item => item.key === symbol), imported = symbol && this.imported.get(symbol);
        name = claim ? { declaration: claim.id } : imported !== undefined ? { imported } : { name: symbol?.getName() ?? spelling };
      } else {
        const declaration = this.names.get(spelling), imported = this.imports.get(node.getSourceFile())?.get(spelling);
        name = declaration !== undefined ? { declaration } : imported !== undefined ? { imported } : { name: spelling };
      }
      return [node.kind, name, node.typeArguments?.map(argument => this.type(argument, native)) ?? []];
    }
    const children: unknown[] = []; ts.forEachChild(node, child => { children.push(this.type(child, native)); });
    return [node.kind, children.length ? children : tokens(node.getText())];
  }
  shape(node: NativeDeclaration, native: boolean): string { return canonical({ kind: kind(node),
    visibility: ts.getCombinedModifierFlags(node) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected | ts.ModifierFlags.Static | ts.ModifierFlags.Readonly),
    parameters: node.parameters?.map(parameter => [nativeName(parameter), !!parameter.questionToken, !!parameter.dotDotDotToken, this.type(parameter.type, native), parameter.initializer ? tokens(parameter.initializer.getText()) : null]),
    generics: node.typeParameters?.map(parameter => [nativeName(parameter), this.type(parameter.constraint, native), this.type(parameter.default, native)]),
    optional: !!node.questionToken, type: ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type) ? null : this.type(node.type, native) }); }
}
