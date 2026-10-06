import { expect, onTestFinished } from 'vitest';
import ts from 'typescript';
import { PreservationDriver, originalStoreGame } from '../../../driver/project/typescript/typescript-preservation.js';
import type { Correspondence } from '../../../driver/project/typescript/typescript-preservation.js';
import type { Diagnostic } from '../../../../src/index.js';

type Callable = ts.MethodDeclaration | ts.FunctionDeclaration | ts.ConstructorDeclaration;

export class PreservationExamples {
  private constructor(readonly driver: PreservationDriver) {}
  private files = new Map<string, Uint8Array>();
  private bodies = new Map<string, string>();
  private regions = new Map<string, string>();
  private exports = new Map<string, string[]>();
  private userDocumentation = new Map<string, string>();
  private outside?: { name: string; before: string; after: string };
  static async connect(): Promise<PreservationExamples> {
    const driver = new PreservationDriver(); await driver.initialize(); onTestFinished(() => driver.dispose()); return new PreservationExamples(driver);
  }
  static async generated(source: string): Promise<PreservationExamples> {
    const project = await this.connect(); project.source(source); await project.create({ directory: 'src' }); project.expectApplied(); return project;
  }
  static async mappedStoreGame(method = 'save(snapshot: string): void { console.log(snapshot); }'): Promise<PreservationExamples> {
    const project = await this.connect(); project.source('class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing }');
    await project.file('game.ts', 'export class StoreGame { ' + method + ' }\n');
    project.mapClass('StoreGame', 'game.ts', 'StoreGame'); project.mapMethod('StoreGame.save', 'game.ts', 'StoreGame', 'save'); return project;
  }
  static async adoptSingleFileStoreAndCart(): Promise<PreservationExamples> {
    const project = await this.mappedStoreGame(); await project.appendNativeCode('game.ts', '\nexport class Cart { count = 3; }\n');
    await project.create({ directory: 'src', adoptExisting: true }); project.expectApplied(); return project;
  }
  static async adoptOriginalStoreGame(): Promise<PreservationExamples> {
    const project = await this.connect(); project.source('opaque type SystemConfig\nopaque type PlayerStateSnapshot\nclass StoreGame { public startup, save, delete, new, shutDown\ncapability startup(configurations: SystemConfig) returns Nothing\ncapability save(snapshot: PlayerStateSnapshot) returns Nothing\ncapability delete() returns Nothing\ncapability new() returns PlayerStateSnapshot\ncapability shutDown() returns Nothing\n}');
    await project.file('game.ts', originalStoreGame);
    await project.file('launcher.ts', 'import { storeGame } from "./game.js";\nexport const game = storeGame;\n');
    project.mapClass('StoreGame', 'game.ts', 'StoreGame');
    for (const name of ['startup', 'save', 'delete', 'new', 'shutDown']) project.mapMethod('StoreGame.' + name, 'game.ts', 'StoreGame', name);
    await project.create({ directory: 'src', adoptExisting: true, imports: [
      { module: 'main', declaration: ['SystemConfig'], name: 'SystemConfig' },
      { module: 'main', declaration: ['PlayerStateSnapshot'], name: 'PlayerStateSnapshot' },
    ] }); project.expectApplied(); return project;
  }
  source(text: string) { this.driver.source(text); }
  file(path: string, text: string) { return this.driver.file(path, text); }
  mapClass(name: string, file: string, native: string) { this.driver.map(name, file, [{ kind: 'class', name: native }]); }
  mapMethod(name: string, file: string, owner: string, native: string) { this.driver.map(name, file, [{ kind: 'class', name: owner }, { kind: 'method', name: native, static: false }]); }
  mapType(name: string, file: string, native: string) { this.driver.map(name, file, [{ kind: 'type', name: native }]); }
  mapProperty(name: string, file: string, owner: string, native: string) { this.driver.map(name, file, [{ kind: 'type', name: owner }, { kind: 'property', name: native }]); }
  async create(options: Record<string, unknown>) { await this.driver.create(options); }
  change(text: string, decisions?: Correspondence) { this.driver.revise(text, decisions); }
  rename(from: string, to: string) { this.driver.rename(from, to); }
  addCapability(owner: string, name: string, inputs: string[], result: string) { this.driver.addCapability(owner, name, inputs, result); }
  update() { return this.driver.update(); }
  delete(name: string) { return this.driver.delete(name); }
  search(name: string) { return this.driver.search(name); }
  implement(name: string, text: string) { return this.driver.implement(name, text); }
  implementConstruction(name: string, text: string) { return this.implement(name + '.constructor', text); }
  replaceSignature(name: string, text: string) { return this.driver.replaceSignature(name, text); }
  appendNativeCode(file: string, text: string) { return this.driver.append(file, text); }
  addNativeField(owner: string, text: string) { return this.driver.addMember(owner, text); }
  addNativeMethod(owner: string, text: string) { return this.driver.addMember(owner, text); }
  async rememberFiles(paths?: string[]) { this.files = new Map((await this.driver.context.readSnapshot()).files.filter(file => !paths || paths.includes(file.path)).map(file => [file.path, file.bytes])); }
  async expectFileBytesUnchanged(file: string) { const current = (await this.driver.context.readSnapshot()).files.find(item => item.path === file); expect(current, file).toBeDefined(); expect(Buffer.from(current!.bytes)).toEqual(Buffer.from(this.files.get(file)!)); }
  async expectNoWrites() { const current = new Map((await this.driver.context.readSnapshot()).files.map(file => [file.path, Buffer.from(file.bytes)])); expect(current).toEqual(new Map([...this.files].map(([path, bytes]) => [path, Buffer.from(bytes)]))); }
  expectConflict(code: string) { expect(this.driver.problems.map(problem => problem.code), JSON.stringify(this.driver.problems)).toContain(code); expect(this.driver.written?.receipt).toBeUndefined(); }
  expectConflictAt(code: string, file: string, text: string) {
    this.expectConflict(code);
    const problems = this.driver.problems.filter(problem => problem.code === code);
    expect(problems.some(problem => this.located(problem, file, text)), JSON.stringify(problems)).toBe(true);
  }
  private located(problem: Diagnostic, file: string, text: string): boolean {
    if (problem.at.kind !== 'dependency') return false;
    const path = problem.at.path, start = path.at(-2), length = path.at(-1);
    return path.includes(file) && typeof start === 'number' && typeof length === 'number'
      && (this.driver.files.get(file)?.slice(start, start + length).includes(text) ?? false);
  }
  expectApplied() { expect(this.driver.problems).toEqual([]); expect(this.driver.written?.receipt?.status).toBe('applied'); }
  expectUnchanged() { expect(this.driver.problems).toEqual([]); expect(this.driver.written?.receipt?.status).toBe('unchanged'); }
  expectNativeMethod(name: string, parameters: string[], result: string) {
    const node = this.driver.native(name) as ts.MethodDeclaration;
    expect(node, name).toBeDefined(); expect(node.parameters.map(parameter => parameter.getText())).toEqual(parameters); expect(node.type?.getText()).toBe(result);
  }
  expectImplementation(name: string, text: string) { expect((this.driver.native(name) as ts.MethodDeclaration).body?.getText()).toBe(text); }
  async rememberImplementation(names: string[]) { this.bodies = new Map(names.map(name => [name, this.body(name)])); }
  async expectImplementationBytesKept() { await this.driver.capture(); for (const [name, body] of this.bodies) expect(this.body(this.driver.renameTargets.get(name) ?? name), name).toBe(body); }
  private body(name: string): string { const body = (this.driver.native(name) as Callable | undefined)?.body; expect(body, name + ' body').toBeDefined(); return body!.getText(); }
  async rememberNativeRegions(names: string[]) { this.regions = new Map(names.map(name => [name, this.region(name)])); }
  async expectNativeRegionBytesKept() { await this.driver.capture(); for (const [name, text] of this.regions) expect(this.region(name), name).toBe(text); }
  private region(name: string): string {
    const node = this.driver.native(name); expect(node, name).toBeDefined(); const file = node!.getSourceFile();
    const end = ts.getTrailingCommentRanges(file.text, node!.end)?.at(-1)?.end ?? node!.end; return file.text.slice(node!.getStart(), end);
  }
  expectConfirmedDefinition(name: string, file: string) { expect(this.driver.written?.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ specId: this.driver.subject(name), locator: expect.objectContaining({ value: expect.objectContaining({ file }) }) })])); }
  expectNoOwnedSubject(name: string) { expect(this.driver.written?.artifacts).toBeDefined(); expect(JSON.stringify(this.driver.written!.artifacts)).not.toContain(name); }
  private nativeExports(file: ts.SourceFile): string[] { return file.statements.flatMap(node => ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ? ts.isVariableStatement(node) ? node.declarationList.declarations.map(declaration => declaration.name.getText()) : 'name' in node && node.name ? [(node.name as ts.Node).getText()] : [] : []); }
  expectNativeExports(file: string, names: string[]) { expect(this.nativeExports(this.driver.nativeFiles().find(item => item.fileName === file)!)).toEqual(names); }
  async rememberNativeExports() { this.exports = new Map(this.driver.nativeFiles().map(file => [file.fileName, file.statements.filter(ts.isExportDeclaration).map(node => node.getText())])); }
  async expectNativeExportBytesKept() { await this.driver.capture(); for (const [file, declarations] of this.exports) expect(this.driver.nativeFiles().find(item => item.fileName === file)?.statements.filter(ts.isExportDeclaration).map(node => node.getText())).toEqual(declarations); }
  expectNoFile(file: string) { expect(this.driver.files.has(file)).toBe(false); }
  async expectFile(file: string, text: string) { await this.driver.capture(); expect(this.driver.files.get(file)).toBe(text); }
  expectSourceContains(text: string) { expect([...this.driver.files].filter(([file]) => file.endsWith('.ts')).some(([, source]) => source.includes(text))).toBe(true); }
  expectSourceIn(file: string, texts: string[]) { for (const text of texts) expect(this.driver.files.get(file), file).toContain(text); }
  expectNoInventedSupabaseCall() { expect(this.body('StoreGame.save')).toBe('{ localStorage.setItem("save", snapshot); }'); }
  expectNoRuntimeConformanceClaim() {
    expect(Object.keys(this.driver.written!).sort()).toEqual(['artifacts', 'obligations', 'problems', 'receipt']);
    expect(this.driver.written!.obligations).toEqual([]);
  }
  expectOwnedDocumentation(name: string, text: string) { expect(this.driver.documentation(name).some(comment => comment.includes(text))).toBe(true); }
  expectObligationMarkedUnverified(name: string) { expect(this.driver.documentation(name).join('\n')).toMatch(/unverified|not (executed|verified)|implementation obligation/i); }
  async addUserDocumentation(name: string, text: string) { await this.driver.document(name, text); this.userDocumentation.set(name, text); }
  async rememberUserDocumentation() { for (const [name, text] of this.userDocumentation) expect(this.driver.documentation(name)).toContain(text); }
  async expectUserDocumentationBytesKept() { await this.driver.capture(); for (const [name, text] of this.userDocumentation) expect(this.driver.documentation(name)).toContain(text); }
  appendToGeneratedDocumentation(name: string, text: string) { return this.driver.document(name, text, true); }
  expectNativeField(name: string, type: string, options: { optional: boolean }) { const field = this.driver.native(name) as ts.PropertySignature; expect(field, name).toBeDefined(); expect(field.type?.getText()).toBe(type); expect(!!field.questionToken).toBe(options.optional); }
  expectNativeFunction(name: string, parameters: string[], result: string) { this.expectNativeMethod(name, parameters, result); }
  expectNativeConstructor(name: string, parameters: string[]) { const node = this.driver.native(name + '.constructor') as ts.ConstructorDeclaration; expect(node?.parameters.map(parameter => parameter.getText())).toEqual(parameters); }
  expectNoNativeMethod(name: string) { expect(this.driver.native(name), name).toBeUndefined(); }
  expectNoNativeDeclaration(name: string) { expect(this.driver.native(name), name).toBeUndefined(); }
  expectNativeDeclaration(file: string, name: string) { expect(this.driver.native(name)?.getSourceFile().fileName).toBe(file); }
  expectSameIdentity(from: string, to: string) { expect(this.driver.subject(to)).toBe(this.driver.originalIds.get(from)); }
  expectNativeImport(file: string, expected: { exported: string; local: string; from: string }) {
    const imports = this.driver.nativeFiles().find(source => source.fileName === file)!.statements.filter(ts.isImportDeclaration).flatMap(node => {
      const bindings = node.importClause?.namedBindings; return bindings && ts.isNamedImports(bindings) ? bindings.elements.map(element => ({ exported: element.propertyName?.text ?? element.name.text, local: element.name.text, from: (node.moduleSpecifier as ts.StringLiteral).text })) : [];
    }); expect(imports).toContainEqual(expected);
  }
  expectNativeExport(file: string, expected: { name: string; from: string }) { const exports = this.driver.nativeFiles().find(source => source.fileName === file)!.statements.filter(ts.isExportDeclaration).flatMap(node => node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map(element => ({ name: element.name.text, from: (node.moduleSpecifier as ts.StringLiteral)?.text })) : []); expect(exports).toContainEqual(expected); }
  expectIncoming(name: string, file: string) { expect(this.driver.searchResult.problems).toEqual([]); expect(this.driver.searchResult.incoming.uses).toEqual(expect.arrayContaining([expect.objectContaining({ target: { kind: 'specified', id: this.driver.subject(name) }, at: expect.objectContaining({ value: expect.objectContaining({ file }) }) })])); }
  expectIncomingProjectFile(file: string) { expect(this.driver.searchResult.problems).toEqual([]); expect(this.driver.searchResult.incoming.uses.some(use => use.target.kind === 'project' && (use.at.value as { file: string }).file === file), JSON.stringify(this.driver.searchResult.incoming)).toBe(true); }
  checkNativeTypes() { return this.driver.check(); }
  expectNativeCheckPassed() { expect(this.driver.nativeDiagnostics).toEqual([]); }
  expectNativeTypeError(actual: string, expected: string) { expect(this.driver.nativeDiagnostics.some(problem => problem.code === 'typescript-2322' && problem.message.includes("Type '" + actual + "'") && problem.message.includes("type '" + expected + "'")), JSON.stringify(this.driver.nativeDiagnostics)).toBe(true); }
  run(expression: string) { return this.driver.runExpression(expression); }
  expectThrownMessage(text: string) { expect(this.driver.runtime.code, JSON.stringify(this.driver.runtime)).toBe(1); expect(this.driver.runtime.stderr).toContain(text); }
  expectStandardOutput(text: string) { expect(this.driver.runtime.code, JSON.stringify(this.driver.runtime)).toBe(0); expect(this.driver.runtime.stdout.trim()).toBe(text); }
  async reformatAs(file: string, options: { bom: boolean; newline: string; indent: string }) { const text = this.driver.files.get(file)!; await this.file(file, (options.bom ? '\uFEFF' : '') + text.replace(/^(?: {4})+/gm, spaces => options.indent.repeat(spaces.length / 4)).replace(/\r?\n/g, options.newline)); }
  async rememberOutsideSignature(name: string) { const node = this.driver.native(name) as Callable, source = node.getSourceFile().text; this.outside = { name, before: source.slice(0, node.getStart()), after: source.slice(node.body!.getStart()) }; }
  async expectOutsideSignatureBytesKept() { await this.driver.capture(); const node = this.driver.native(this.outside!.name) as Callable, source = node.getSourceFile().text; expect(source.slice(0, node.getStart())).toBe(this.outside!.before); expect(source.slice(node.body!.getStart())).toBe(this.outside!.after); }
  expectFileEncoding(file: string, options: { bom: boolean; newline: string }) { const source = this.driver.files.get(file)!; expect(source.startsWith('\uFEFF')).toBe(options.bom); expect(source).toContain(options.newline); expect(source.replaceAll(options.newline, '')).not.toMatch(/[\r\n]/); }
  planUpdate() { return this.driver.plan('update'); }
  planDelete(name: string) { return this.driver.plan('delete', name); }
  applyPreparedPlan() { return this.driver.applyPrepared(); }
  expectStopped(code: string) { expect(this.driver.written?.receipt?.status).toBe('stopped'); expect(this.driver.written?.problems.map(problem => problem.code)).toContain(code); }
  failWriteTo(file: string) { this.driver.failWrite(file); }
  restoreWriter() { this.driver.restoreFailure?.(); this.driver.restoreFailure = undefined; }
  expectStoppedWithAppliedFile(file: string) { expect(this.driver.written?.receipt?.status).toBe('stopped'); expect(this.driver.written?.receipt?.outcomes).toEqual(expect.arrayContaining([expect.objectContaining({ change: expect.objectContaining({ path: file }), state: 'applied' })])); }
  expectNoConfirmedAssociations() { expect(this.driver.written?.artifacts).toBeUndefined(); }
  denyAmbientProjectAccess() { return this.driver.denyAmbientAccess(); }
  expectApplicablePlan() { expect(this.driver.prepared?.problems).toEqual([]); expect(this.driver.prepared?.value).toBeDefined(); }
  expectNoUserCodeExecution() { expect(this.driver.executed).toBe(0); }
  expectNoAmbientProjectAccess() { expect(this.driver.ambientAttempts).toEqual([]); }
  async expectPlanningMadeNoWrites() { this.driver.restoreAccess(); const current = await this.driver.context.readSnapshot(); expect(current.files).toEqual(this.driver.captured!.files); }
}
