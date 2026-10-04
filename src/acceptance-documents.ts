import ts from 'typescript';
import type { Diagnostic } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { ProjectRead, ProjectSearch } from './project-inspection.js';
import type { ArtifactAssociation, ArtifactLocator } from './specification-identity.js';
import type { AcceptanceOptions } from './acceptance-bindings.js';
import { testIdentities, type AcceptanceState } from './acceptance-state.js';
import { canonical } from './identity-baseline.js';
import { hash } from './project-files.js';
import { TypeScriptCapture, diagnostic } from './typescript-capture.js';
import { TypeScriptSymbols, nativeSelection, unique, type Selector } from './typescript-symbols.js';

interface NativeTest { id: string; call: ts.CallExpression; callback: ts.ArrowFunction | ts.FunctionExpression; at: ArtifactLocator }
const pathOf = (at: ArtifactLocator): string => (at.value as { file: string }).file;
const bound = (checker: ts.TypeChecker, node: ts.Node): ts.Symbol | undefined => {
  const symbol = checker.getSymbolAtLocation(node); return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
};
export function nativeFixture(capture: TypeScriptCapture, options: AcceptanceOptions): ts.Symbol | undefined {
  const location = options.fixture?.value as unknown as { file: string; declaration: Selector[] } | undefined,
    path = location?.file ?? options.testRoot + '/dsl/' + options.domain + '-test.ts', source = capture.program?.getSourceFile(capture.absolute(path));
  if (!source || location && (location.declaration.length !== 1 || location.declaration[0]!.kind !== 'variable')) return undefined;
  const checker = capture.program!.getTypeChecker(), module = checker.getSymbolAtLocation(source);
  const exported = module && checker.getExportsOfModule(module).find(symbol => symbol.name === (location?.declaration[0]!.name ?? 'test'));
  return exported?.flags && exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
}
export function isNativeTest(capture: TypeScriptCapture, symbol: ts.Symbol | undefined, seen = new Set<ts.Symbol>()): boolean {
  if (!symbol || seen.has(symbol)) return false; seen.add(symbol);
  const checker = capture.program!.getTypeChecker();
  const expression = (node: ts.Expression): boolean => ts.isIdentifier(node) ? isNativeTest(capture, bound(checker, node), seen)
    : ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'extend' && expression(node.expression.expression);
  return (symbol.declarations ?? []).some(node => {
    const path = capture.projectPath(node.getSourceFile().fileName);
    if (path && /^(?:.*\/)?node_modules\/(?:vitest|@vitest\/runner)\//.test(path)) return ['test', 'it'].includes(symbol.name);
    return ts.isVariableDeclaration(node) && !!node.initializer && expression(node.initializer);
  });
}

/** Reads real native callbacks, bindings and generated contracts from one supplied capture. */
export class AcceptanceDocuments {
  readonly problems: Diagnostic[];
  readonly tests: NativeTest[] = [];
  private readonly capture: TypeScriptCapture;
  private readonly symbols: TypeScriptSymbols;
  private readonly associations: readonly ArtifactAssociation[];
  constructor(snapshot: ProjectSnapshot, private readonly options: AcceptanceOptions, private readonly state?: AcceptanceState, findings: readonly Diagnostic[] = []) {
    this.capture = new TypeScriptCapture(snapshot, 'acceptance', options.configFile);
    this.associations = state?.files.flatMap(file => file.artifacts) ?? [];
    this.symbols = new TypeScriptSymbols(this.capture, this.associations);
    this.problems = [...findings, ...this.capture.problems, ...this.symbols.problems];
    try { this.collect(); this.integrity(); } catch (error) { this.close(); throw error; }
  }
  close(): void { this.capture.service.dispose(); }
  private problem(code: string, message: string, node: ts.Node): void {
    this.problems.push(diagnostic(code, message, this.capture.projectPath(node.getSourceFile().fileName)!, node.getStart(), node.end - node.getStart()));
  }
  private collect(): void {
    const fixture = nativeFixture(this.capture, this.options), checker = this.capture.program?.getTypeChecker();
    for (const source of this.capture.sources) for (const statement of source.statements) {
      const markers = testIdentities(statement);
      if (!markers.length) continue;
      const call = ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) ? statement.expression : undefined,
        callback = call?.arguments[1], title = call?.arguments[0];
      let callee = call?.expression;
      if (callee && ts.isPropertyAccessExpression(callee) && callee.name.text === 'concurrent') callee = callee.expression;
      if (markers.length !== 1 || !call || !title || !ts.isStringLiteralLike(title) || !callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
        || !callee || !checker || bound(checker, callee) !== fixture || !isNativeTest(this.capture, fixture)) {
        this.problem('unsupported-native-test', 'The identity marker must select one literal-title callback of the captured native Vitest fixture.', statement); continue;
      }
      const id = markers[0]!, file = this.capture.projectPath(source.fileName)!;
      this.tests.push({ id, call, callback, at: { outputId: 'acceptance', format: 'vitest-test-1', value: { file, id } } });
    }
    for (const association of this.associations.filter(item => item.locator.format === 'vitest-test-1')) {
      const found = this.tests.filter(test => test.id === association.specId);
      if (found.length !== 1 || pathOf(found[0]!.at) !== pathOf(association.locator)) this.problems.push(diagnostic(found.length > 1 ? 'ambiguous-native-test' : 'missing-native-test',
        'The saved identity must have one current callback at its associated file.', pathOf(association.locator)));
    }
  }
  private integrity(): void {
    if (!this.state) return;
    const snapshot = this.capture.snapshot, owned = this.state.files.filter(file => file.container?.role !== 'driver'), paths = new Set(owned.map(file => file.path));
    const baseline = new TypeScriptCapture({ ...snapshot, files: [...snapshot.files.filter(file => !paths.has(file.path)), ...owned.map(file => ({
      path: file.path, bytes: Buffer.from(file.generated), version: hash(Buffer.from(file.generated)),
    }))] }, 'acceptance', this.options.configFile);
    try {
      const compare = (before: ts.Node | undefined, current: ts.Node | undefined): void => {
        if (!before || !current) return;
        const changed = difference(before, current, baseline, this.capture);
        if (changed) this.problem('generated-test-drift', 'Current generated assertion, call or composition differs from its recorded authored contract.', changed);
      };
      for (const test of this.tests) {
        const source = baseline.program?.getSourceFile(baseline.absolute(pathOf(test.at))), file = this.state.files.find(file => file.path === pathOf(test.at));
        if (!source || !file?.artifacts.some(item => item.specId === test.id)) continue;
        const original = source.statements.find(statement => testIdentities(statement).includes(test.id));
        compare(original && ts.isExpressionStatement(original) ? original.expression : undefined, test.call);
      }
      for (const file of this.state.files) {
        const current = this.capture.program?.getSourceFile(this.capture.absolute(file.path)), original = baseline.program?.getSourceFile(baseline.absolute(file.path));
        if (!current || !original) continue;
        if (file.path === this.options.testRoot + '/dsl/comparison.ts' || file.path === this.options.testRoot + '/dsl/' + this.options.domain + '-test.ts') compare(original, current);
        if (file.container?.role !== 'dsl') continue;
        for (const item of file.artifacts.filter(item => this.state!.authored.includes(item.specId) && !file.adopted?.includes(item.specId))) {
          const selectors = (item.locator.value as unknown as { declaration: Selector[] }).declaration;
          const before = nativeSelection(original, selectors)[0], after = nativeSelection(current, selectors)[0];
          if (before && after && ts.isMethodDeclaration(before) && ts.isMethodDeclaration(after)) compare(before.body, after.body);
        }
      }
    } finally { baseline.service.dispose(); }
  }
  read(id: string): ProjectRead {
    const selected = this.associations.filter(item => item.specId === id), problems = [...this.problems];
    if (!selected.length) problems.push(diagnostic('unassociated-subject', 'This output has no current association for the subject.', '<associations>'));
    const paths = new Set(selected.map(item => pathOf(item.locator)));
    for (const file of this.state?.files ?? []) if (!file.artifacts.some(item => item.locator.format === 'vitest-test-1' || item.locator.format === 'typescript-file-1')) paths.add(file.path);
    if (this.options.fixture) paths.add(pathOf(this.options.fixture));
    const artifacts = [...paths].flatMap(path => {
      const file = this.capture.snapshot.files.find(file => file.path === path); if (!file) { problems.push(diagnostic('missing-project-artifact', 'Associated native file is absent.', path)); return []; }
      const locations = selected.filter(item => pathOf(item.locator) === path).map(item => item.locator);
      return (locations.length ? locations : [{ outputId: 'acceptance', format: 'typescript-file-1', value: { file: path } }]).map(at => ({ at, file }));
    });
    return { artifacts: unique(artifacts), problems: unique(problems), coverage: this.coverage(problems) };
  }
  search(id: string): ProjectSearch {
    const selected = this.associations.filter(item => item.specId === id), problems = [...this.problems];
    if (!selected.length) problems.push(diagnostic('unassociated-subject', 'This output has no current association for the subject.', '<associations>'));
    const group = selected.find(item => item.locator.format === 'typescript-file-1'), tests = this.tests.filter(test => group ? pathOf(test.at) === pathOf(group.locator) : test.id === id);
    const uses = this.symbols.relationships(id, tests.length ? tests.map(test => test.callback) : undefined);
    uses.incoming.uses = uses.incoming.uses.map(use => {
      const site = use.at.value as { file: string; start: number; end: number }, test = this.tests.find(test => pathOf(test.at) === site.file && site.start >= test.callback.getStart() && site.end <= test.callback.end);
      return test ? { ...use, target: { kind: 'specified', id: test.id } } : use;
    });
    const observation = (direction: 'incoming' | 'outgoing') => ({ subject: id, direction, ...uses[direction], coverage: this.coverage(problems, uses[direction].unresolved.map(item => item.reason)) });
    return { definitions: unique([...tests.map(test => test.at), ...this.symbols.definitions(id)]), incoming: observation('incoming'), outgoing: observation('outgoing'), problems: unique(problems) };
  }
  private coverage(problems: readonly Diagnostic[], extra: readonly string[] = []) {
    const limitations = [...new Set([...problems.map(problem => problem.message), ...extra])]; return { scope: this.capture.scope(), complete: !limitations.length, limitations };
  }
}

function difference(before: ts.Node, current: ts.Node, oldCapture: TypeScriptCapture, capture: TypeScriptCapture): ts.Node | undefined {
  const value = (node: ts.Node, context: TypeScriptCapture): unknown => {
    if (ts.isIdentifier(node)) {
      const checker = context.program!.getTypeChecker(), symbol = bound(checker, node);
      return symbol ? [checker.getFullyQualifiedName(symbol), symbol.declarations?.map(declaration => context.projectPath(declaration.getSourceFile().fileName) ?? declaration.getSourceFile().fileName)] : node.text;
    }
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    return node.getChildCount() ? undefined : node.getText();
  };
  if (before.kind !== current.kind || canonical(value(before, oldCapture)) !== canonical(value(current, capture))) return current;
  const left: ts.Node[] = [], right: ts.Node[] = []; before.forEachChild(node => { left.push(node); }); current.forEachChild(node => { right.push(node); });
  if (left.length !== right.length) return current;
  for (let index = 0; index < left.length; index++) { const changed = difference(left[index]!, right[index]!, oldCapture, capture); if (changed) return changed; }
  return undefined;
}
