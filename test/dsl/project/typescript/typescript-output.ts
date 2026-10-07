import { expect } from 'vitest';
import ts from 'typescript';
import { TypeScriptOutputDriver } from '../../../driver/project/typescript/typescript-output.js';
import type { OutputContext } from '../../../../src/index.js';

export class TypeScriptExamples {
  private rememberedBaseline: string | undefined;
  private static readonly instances: TypeScriptExamples[] = [];
  private constructor(readonly driver: TypeScriptOutputDriver) {}
  static async connect(): Promise<TypeScriptExamples> {
    const example = new TypeScriptExamples(new TypeScriptOutputDriver()); this.instances.push(example); await example.driver.initialize(); return example;
  }
  static async dispose(): Promise<void> { for (const example of this.instances.splice(0)) await example.driver.dispose(); }
  static async withStoreGameScaffold(): Promise<TypeScriptExamples> {
    const example = await this.connect();
    example.source('type Snapshot { title: Text }\nclass StoreGame { public save\ncapability save(snapshot: Snapshot) returns Nothing { promises "Save to disk." } }');
    await example.create({ directory: 'src' }); return example;
  }
  source(text: string): void { this.driver.source(text); }
  library(locator: string, text: string): void {
    const model = this.driver.model(locator, text); this.driver.libraries.push(model); this.driver.libraryBefore.push(this.driver.libraryState(model));
  }
  availablePackage(alias: string, phase: 'build' | 'runtime' | 'test'): void { this.driver.packages.push({ alias, phases: [phase] }); }
  workspace(files: Record<string, string>): Promise<void> { return this.driver.workspace(files); }
  changeWorkspace(files: Record<string, string>, retained: (string | readonly [string, string])[] = []): Promise<void> { return this.driver.workspace(files, true, retained); }
  mapClass(name: string, file: string, nativeName = name): void {
    const result = this.driver.identity.withArtifacts(this.driver.current, [{ specId: this.driver.subject(name),
      locator: { outputId: 'typescript', format: 'typescript-symbol-1', value: { file, declaration: [{ kind: 'class', name: nativeName }] } } }]);
    expect(result.problems).toEqual([]); this.driver.current = result.value!;
  }
  declarationIdentity(name: string): string { return this.driver.subject(name); }
  expectDeclarationIdentity(name: string, id: string): void { expect(this.driver.subject(name)).toBe(id); }
  create(options: Record<string, unknown>): Promise<void> { return this.driver.create(options); }
  open(options: Record<string, unknown>, context?: OutputContext): void { this.driver.open(options, context); }
  async openWithInvalidContext(context: unknown): Promise<void> { this.driver.open({ directory: 'src' }, context as OutputContext); }
  createOpened(): Promise<void> { return this.driver.createOpened(); }
  change(text: string, decisions?: { rename?: Record<string, string> }): void { this.driver.change(text, decisions); }
  update(): Promise<void> { return this.driver.update(); }
  insert(): Promise<void> { return this.driver.insert(); }
  delete(name: string): Promise<void> { return this.driver.delete(name); }
  read(name: string): Promise<void> { return this.driver.read(name); }
  search(name: string): Promise<void> { return this.driver.search(name); }
  file(path: string, text: string): Promise<void> { return this.driver.file(path, text); }
  append(path: string, text: string): Promise<void> { return this.driver.append(path, text); }
  async checkNativeTypes(): Promise<void> { await this.driver.check(); }
  async checkConsumer(text: string): Promise<void> { await this.driver.check(text); }
  runConsumer(text: string): Promise<void> { return this.driver.run(text); }
  expectNativeCheckPassed(): void { expect(this.driver.nativeDiagnostics).toEqual([]); }
  expectNativeTypeErrorAt(text: string, code?: string): void {
    expect(this.driver.nativeDiagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ text, ...(code ? { code } : {}) })]));
  }
  expectThrownError(message: string): void { expect(this.driver.nativeDiagnostics).toEqual([]); expect(this.driver.runtime.code).not.toBe(0); expect(this.driver.runtime.stderr).toContain('Error: ' + message); }
  expectPrintedJson(value: unknown): void { expect(this.driver.nativeDiagnostics).toEqual([]); expect(this.driver.runtime.code).toBe(0); expect(JSON.parse(this.driver.runtime.stdout.trim())).toEqual(value); }
  private native(name: string): ts.Declaration { const node = this.driver.native(name); expect(node, 'Native declaration ' + name).toBeDefined(); return node!; }
  expectNativeAlias(name: string, parameters: string[], value: string): void {
    const node = this.native(name) as ts.TypeAliasDeclaration; expect(ts.isTypeAliasDeclaration(node)).toBe(true);
    expect(node.typeParameters?.map(parameter => parameter.name.text) ?? []).toEqual(parameters); expect(node.type.getText()).toBe(value);
  }
  expectNativeFields(name: string, fields: string[]): void {
    const node = this.native(name) as ts.TypeAliasDeclaration;
    expect(ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)).toBe(true);
    expect((node.type as ts.TypeLiteralNode).members.map(member => member.getText().replace(/;$/, '').replace(/\/\*\*[\s\S]*?\*\//g, '').trim())).toEqual(fields);
  }
  private signature(name: string, parameters: string[], result?: string): ts.SignatureDeclaration {
    const node = this.native(name) as ts.SignatureDeclaration;
    expect(node.parameters.map(parameter => parameter.getText().replace(/\/\*\*[\s\S]*?\*\//g, '').trim())).toEqual(parameters);
    if (result !== undefined) expect(node.type?.getText()).toBe(result); return node;
  }
  expectNativeMethod(name: string, parameters: string[], result: string): void { const node = this.signature(name, parameters, result); expect(ts.isMethodDeclaration(node) || ts.isMethodSignature(node)).toBe(true); }
  expectNativeFunction(name: string, parameters: string[], result: string): void { expect(ts.isFunctionDeclaration(this.signature(name, parameters, result))).toBe(true); }
  expectPrivateMethod(name: string, parameters: string[]): void { const node = this.signature(name, parameters); expect(ts.getModifiers(node as ts.MethodDeclaration)?.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword)).toBe(true); }
  expectMethodBody(name: string, text: string): void { const body = (this.native(name) as ts.MethodDeclaration).body; expect(body).toBeDefined(); expect(body!.getText().slice(1, -1).trim()).toBe(text); }
  expectNativeDeclaration(name: string, kind: 'class' | 'interface'): void { expect(kind === 'class' ? ts.isClassDeclaration(this.native(name)) : ts.isInterfaceDeclaration(this.native(name))).toBe(true); }
  expectNativeConstructor(name: string, parameters: string[]): void {
    const node = this.native(name) as ts.ClassDeclaration, constructor = node.members.find(ts.isConstructorDeclaration);
    expect(constructor).toBeDefined(); expect(constructor!.parameters.map(parameter => parameter.getText())).toEqual(parameters);
  }
  expectNativeConstructSignature(name: string, parameters: string[], result: string): void {
    const node = this.native(name) as ts.InterfaceDeclaration, construction = node.members.find(ts.isConstructSignatureDeclaration);
    expect(construction).toBeDefined(); expect(construction!.parameters.map(parameter => parameter.getText())).toEqual(parameters); expect(construction!.type?.getText()).toBe(result);
  }
  expectNoInstanceConstructSignature(name: string): void { expect((this.native(name) as ts.InterfaceDeclaration).members.some(ts.isConstructSignatureDeclaration)).toBe(false); }
  expectUnexportedTypeInFile(name: string, path: string): void { const node = this.native(name); expect(node.getSourceFile().fileName).toBe(path); expect(ts.getModifiers(node as ts.TypeAliasDeclaration)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false).toBe(false); }
  expectDocumentation(name: string, text: string): void {
    let node = this.driver.native(name);
    if (!node && name.includes('.')) { const parts = name.split('.'), parameter = parts.pop()!; const owner = this.driver.native(parts.join('.')) as ts.SignatureDeclaration | undefined; node = owner?.parameters.find(item => item.name.getText() === parameter); }
    expect(node, name).toBeDefined(); expect(node!.getSourceFile().text.slice(node!.getFullStart(), node!.getEnd())).toContain(text);
  }
  expectNativeImport(name: string, binding: string, from: string): void { this.expectNativeImportAlias(name, binding, binding, from); }
  expectNativeImportAlias(name: string, exported: string, local: string, from: string): void {
    const file = this.native(name).getSourceFile();
    const imports = file.statements.filter(ts.isImportDeclaration).flatMap(statement => statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
      ? statement.importClause.namedBindings.elements.map(item => ({ exported: item.propertyName?.text ?? item.name.text, local: item.name.text, from: (statement.moduleSpecifier as ts.StringLiteral).text })) : []);
    expect(imports).toContainEqual({ exported, local, from });
  }
  expectGeneratedFiles(paths: string[]): void { expect([...this.driver.files.keys()].filter(path => path.startsWith('src/') && path.endsWith('.ts')).sort()).toEqual([...paths].sort()); }
  expectGeneratedFile(path: string): void { expect(this.driver.files.has(path), path).toBe(true); }
  expectNoGeneratedFile(path: string): void { expect(this.driver.files.has(path), path).toBe(false); }
  expectNoNativeDeclaration(name: string): void { expect(this.driver.native(name)).toBeUndefined(); }
  expectNoGeneratedFactory(name: string): void { expect(this.driver.native('create' + name)).toBeUndefined(); expect(this.driver.native(name + 'Factory')).toBeUndefined(); }
  expectNoInventedImplementationClass(name: string): void { expect(this.driver.nativeFiles().flatMap(file => [...file.statements]).filter(ts.isClassDeclaration).map(node => node.name?.text)).not.toContain(name + 'Implementation'); }
  expectNoGeneratedTestFiles(): void { expect([...this.driver.files.keys()].filter(path => /test|spec\.[cm]?ts/.test(path))).toEqual([]); }
  expectNoGeneratedPersistence(): void { expect([...this.driver.files.values()].join('\n')).not.toMatch(/localStorage|supabase|writeFile/); }
  expectNoPackageInstall(): void { expect(this.driver.rootEntries).not.toContain('node_modules'); expect(this.driver.rootEntries).not.toContain('package-lock.json'); }
  expectNoSourceProviderFilesChanged(): void {
    expect(this.driver.libraries.length).toBeGreaterThan(0);
    expect(this.driver.libraries.map(model => this.driver.libraryState(model))).toEqual(this.driver.libraryBefore);
  }
  expectCallerContext(value: OutputContext): void { expect(this.driver.callerContext).toEqual(value); }
  expectCheckedSpecificationUnchanged(): void { expect(JSON.stringify({ baseline: this.driver.current.baseline, roots: [...this.driver.current.specification.inspection.roots()] })).toBe(this.driver.beforeModel); }
  expectAdapterNotOpened(): void { expect(this.driver.openedCount).toBe(0); }
  expectProblem(code: string): void { expect(this.driver.problems.map(problem => problem.code)).toContain(code); }
  private located(code: string, text: string): void { expect(this.driver.problems).toEqual(expect.arrayContaining([expect.objectContaining({ code, message: expect.stringContaining(text) })])); }
  expectNativeNameConflict(name: string): void { this.located('native-name-conflict', name); }
  expectInvalidNativeName(name: string): void { this.located('invalid-native-name', name); }
  expectMissingNativeMapping(name: string): void { this.located('missing-native-mapping', name); }
  expectUnsupportedAugmentation(name: string): void { this.located('unsupported-augmentation', name); }
  expectUnsupportedNumberAt(text: string): void {
    expect(this.driver.problems).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unsupported-number', at: expect.objectContaining({ kind: 'source' }) })]));
    const problem = this.driver.problems.find(problem => problem.code === 'unsupported-number')!;
    if (problem.at.kind !== 'source') throw new Error('Expected actual source position'); expect(this.driver.text.slice(problem.at.range.start.offset, problem.at.range.end.offset)).toBe(text);
  }
  expectConflictAt(path: string): void { expect(this.driver.problems).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'output-conflict', at: expect.objectContaining({ path: expect.arrayContaining([path]) }) })])); }
  expectWriteStatus(status: string): void { expect(this.driver.written?.receipt?.status, JSON.stringify(this.driver.written)).toBe(status); }
  expectNoAppliedReceipt(): void { expect(this.driver.written?.receipt).toBeUndefined(); }
  expectNoConfirmedArtifacts(): void { expect(this.driver.written?.artifacts).toBeUndefined(); }
  async expectNoWrites(): Promise<void> { expect(this.driver.written?.receipt).toBeUndefined(); expect([...this.driver.files.keys()].filter(path => path.startsWith('src/') || path.startsWith('.expec/'))).toEqual([]); }
  async expectFile(path: string, text: string): Promise<void> { await this.driver.capture(); expect(this.driver.files.get(path)).toBe(text); }
  expectDocumentedNumberProfile(profile: string): void { expect([...this.driver.files.values()].filter(text => text.includes('export type')).every(text => text.includes(profile))).toBe(true); }
  expectSourceResultStillUnspecified(name: string): void { const result = this.driver.current.specification.types.callable(this.driver.item(name).id).result; expect(result).toMatchObject({ status: 'known', value: { kind: 'unspecified' } }); }
  expectNoNativeDefaultInitializer(name: string): void { const parts = name.split('.'), parameter = parts.pop()!; const callable = this.native(parts.join('.')) as ts.SignatureDeclaration; expect(callable.parameters.find(item => item.name.getText() === parameter)?.initializer).toBeUndefined(); }
  async rememberProject(): Promise<void> { await this.driver.capture(); this.driver.remembered = new Map(this.driver.files); }
  async expectProjectBytesUnchanged(): Promise<void> { await this.driver.capture(); expect(this.driver.files).toEqual(this.driver.remembered); }
  async rememberFile(path: string): Promise<void> { await this.driver.capture(); this.driver.rememberedFile = { path, text: this.driver.files.get(path)! }; }
  async expectRememberedFileUnchanged(path: string): Promise<void> { await this.driver.capture(); expect(this.driver.rememberedFile?.path).toBe(path); expect(this.driver.files.get(path)).toBe(this.driver.rememberedFile?.text); }
  rememberIdentityWithoutGenerating(): void { /* The actual current identity already supplies the next build's baseline. */ }
  expectSameIdentity(from: string, to: string): void { expect(this.driver.subject(to)).toBe(this.driver.originalIds.get(from)); }
  expectWholeCurrentFile(path: string, parts: string[]): void { const found = this.driver.readResult.artifacts.find(item => item.file.path === path); expect(found).toBeDefined(); const text = Buffer.from(found!.file.bytes).toString('utf8'); expect(text).toBe(this.driver.files.get(path)); for (const part of parts) expect(text).toContain(part); }
  expectUnmodeledConsumer(path: string, text: string): void {
    expect(this.driver.searchResult.problems).toEqual([]); expect(this.driver.searchResult.incoming.coverage.complete).toBe(true);
    const source = this.driver.files.get(path)!, call = source.indexOf(text); expect(call).toBeGreaterThanOrEqual(0);
    expect(this.driver.searchResult.incoming.uses.some(use => {
      const at = use.at.value as { file: string; start: number; end: number; role: string };
      return use.target.kind === 'project' && at.file === path && at.role === 'construct' && at.start === call + 'new '.length
        && at.end === call + text.indexOf('(') && source.slice(at.start, at.end) === 'StoreGame';
    }), JSON.stringify(this.driver.searchResult.incoming.uses)).toBe(true);
  }
  expectNativeDefinitions(names: string[]): void {
    const files = this.driver.nativeFiles();
    const found = this.driver.searchResult.definitions.map(item => {
      const at = item.value as { file: string; start: number; end: number }, source = files.find(file => file.fileName === at.file);
      const node = source?.statements.find(node => node.getStart() === at.start && node.getEnd() === at.end);
      expect(node, 'Located native definition').toBeDefined(); return node && 'name' in node ? (node.name as ts.Node).getText() : undefined;
    }); expect(found.sort()).toEqual([...names].sort());
  }
  failActualOutputStateWrite(): void { this.driver.failStateWrite(); }
  restoreWriter(): void { this.driver.restoreFailure?.(); this.driver.restoreFailure = undefined; }
  async replaceSaveBody(body: string): Promise<void> { const method = this.native('StoreGame.save') as ts.MethodDeclaration, file = method.getSourceFile(); await this.file(file.fileName, file.text.slice(0, method.body!.pos) + ' {\n' + body + '\n}' + file.text.slice(method.body!.end)); }
  async addPrivateMethod(name: string, body: string): Promise<void> { const node = this.native('StoreGame') as ts.ClassDeclaration, file = node.getSourceFile(); await this.file(file.fileName, file.text.slice(0, node.end - 1) + '\nprivate running = false;\nprivate ' + name + '() { ' + body + ' }\n' + file.text.slice(node.end - 1)); }
  renameSaveAndPromise(name: string, promise: string): void { this.change(this.driver.text.replaceAll('save', name).replace('Save to disk.', promise), { rename: { 'StoreGame.save': 'StoreGame.' + name } }); }
  private statePath(): string { return '.expec/outputs/' + Buffer.from('typescript').toString('hex') + '.json'; }
  async rememberGeneratedBaseline(path: string): Promise<void> {
    const text = this.driver.files.get(this.statePath()); expect(text, 'Actual persisted TypeScript baseline').toBeDefined();
    const state = JSON.parse(text!); expect(state.files.find((file: { path: string }) => file.path === path)?.generated).toBe(this.driver.files.get(path)); this.rememberedBaseline = text;
  }
  async expectGeneratedBaselineUnchanged(): Promise<void> { await this.driver.capture(); expect(this.driver.files.get(this.statePath())).toBe(this.rememberedBaseline); }
  expectBaselineExcludes(text: string): void { expect(this.driver.files.get(this.statePath())).not.toContain(text); }
  expectGeneratedBaselineContains(path: string, text: string): void { const state = JSON.parse(this.driver.files.get(this.statePath())!); expect(state.files.find((file: { path: string }) => file.path === path)?.generated).toContain(text); }
  async tamperGeneratedBaseline(path: string, generated: string): Promise<void> {
    const text = this.driver.files.get(this.statePath()); expect(text, 'Actual persisted TypeScript baseline').toBeDefined();
    const state = JSON.parse(text!); state.files.find((file: { path: string }) => file.path === path).generated = generated; await this.file(this.statePath(), JSON.stringify(state));
  }
}
