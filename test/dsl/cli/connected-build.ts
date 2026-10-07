import { readFile, stat } from 'node:fs/promises';
import ts from 'typescript';
import { expect } from 'vitest';
import { ConnectedBuildDriver } from '../../driver/cli/connected-build.js';

export class ConnectedBuild {
  private manifestRegions: string[] = [];
  private directories = new Map<string, { path: string; text: string }[]>();
  private constructor(private readonly driver: ConnectedBuildDriver) {}
  static async create(options: { connected?: boolean } = {}): Promise<ConnectedBuild> {
    const driver = new ConnectedBuildDriver(); await driver.initialize(options.connected ?? true); return new ConnectedBuild(driver);
  }
  static prepare = ConnectedBuildDriver.prepare;
  source(name: string, text: string): Promise<void> { return this.driver.write('spec/' + name, text); }
  file(name: string, text: string): Promise<void> { return this.driver.write('project/' + name, text); }
  async entries(entries: string[]): Promise<void> { this.driver.manifest.build = { entries }; await this.driver.saveManifest(); }
  async rememberAllBytes(): Promise<void> { this.driver.before = await this.driver.capture(); }
  async requirePackage(alias: string, name: string, version: string, phases: string[]): Promise<void> {
    this.driver.manifest.packages = [{ alias, name, version, phases }]; await this.driver.saveManifest();
  }
  nativeAcceptance(): Promise<void> { return this.driver.nativeAcceptance(); }
  async expectGeneratedCall(name: string, args: number[], expected: number): Promise<void> {
    const tests = await this.driver.filesUnder('project/test/acceptance'), calls: ts.CallExpression[] = [];
    for (const file of tests) {
      const source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => { if (ts.isCallExpression(node)) calls.push(node); node.forEachChild(visit); }; visit(source);
    }
    expect(calls.filter(call => call.expression.getText() === name).map(call => call.arguments.map(arg => arg.getText()))).toEqual([args.map(String)]);
    expect(calls.filter(call => call.expression.getText() === 'expectData').map(call => call.arguments[1]?.getText())).toEqual([String(expected)]);
  }
  async expectGeneratedImport(directory: string, from: string): Promise<void> {
    const files = await this.driver.filesUnder('project/' + directory);
    const imports = files.flatMap(file => [...ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true).statements]
      .filter(ts.isImportDeclaration).map(item => (item.moduleSpecifier as ts.StringLiteral).text));
    expect(imports).toContain(from);
  }
  async expectLayerDirectories(names: string[]): Promise<void> { for (const name of names) expect((await stat(this.driver.path('project/' + name))).isDirectory()).toBe(true); }
  servePinnedCompiler(destination: string): Promise<void> { return this.driver.serveCompiler(destination); }
  expectNativeBuild(destination: string): Promise<void> { return this.driver.nativeBuild(destination); }
  async expectNativeClassIn(destination: string, name: string): Promise<void> {
    const files = await this.driver.filesUnder(destination + '/src');
    const nodes = files.filter(file => file.path.endsWith('.ts')).flatMap(file => [...ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true).statements]);
    expect(nodes.filter(ts.isClassDeclaration).filter(node => node.name?.text === name)).toHaveLength(1);
  }
  serveRealPackage(name: string, version: string): Promise<void> { return this.driver.servePackage(name, version); }
  async expectActualInstalledVersion(name: string, version: string): Promise<void> {
    expect(JSON.parse(await readFile(this.driver.path('project/node_modules/' + name + '/package.json'), 'utf8'))).toMatchObject({ name, version });
    expect(JSON.parse(await readFile(this.driver.path('project/package-lock.json'), 'utf8')).packages['node_modules/' + name].version).toBe(version);
  }
  expectByteReceipts(): void {
    const writes = this.driver.report.stages.flatMap((stage: any) => [stage.write, stage.initialization?.write].filter(Boolean));
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) for (const outcome of write.outcomes) for (const observation of [...outcome.before, ...outcome.after]) {
      if (observation.state === 'file') {
        expect(observation.bytes).toEqual({ encoding: 'base64', data: expect.any(String) });
        expect(Buffer.from(observation.bytes.data, 'base64').length).toBeGreaterThan(0);
      }
    }
  }
  registerOutputs(outputs: { id: string; stage: 'contracts' | 'tests'; subject?: string; file?: string; text?: string; malformedPlan?: boolean; readFailure?: string; afterPlan?: { path: string; text: string } }[]): Promise<void> { return this.driver.registerOutputs(outputs); }
  async rememberDirectory(path: string): Promise<void> { this.directories.set(path, await this.driver.filesUnder('project/' + path)); }
  async expectRememberedDirectoryUnchanged(path: string): Promise<void> { expect(await this.driver.filesUnder('project/' + path)).toEqual(this.directories.get(path)); }
  async outputs(outputs: { id: string; options: object }[]): Promise<void> { this.driver.manifest.outputs = outputs; await this.driver.saveManifest(); }
  destinationFile(name: string, text: string): Promise<void> { return this.driver.write(name, text); }
  runInteractive(args: string[], answers: string[]): Promise<void> { return this.driver.run(args, '', answers); }
  afterInitializationBeforeManifestWrite(change: Record<string, unknown>): void { this.driver.manifestChange = change; }
  async rememberManifestOutsideConnection(): Promise<void> {
    const text = await readFile(this.driver.path('spec/expec.json'), 'utf8');
    this.manifestRegions = text.split('\n').filter(line => /"formatVersion"|"version"|"build"|"entries"|"main.expec"/.test(line));
    expect(this.manifestRegions.length).toBeGreaterThan(3);
  }
  async expectRememberedManifestRegionsUnchanged(): Promise<void> {
    const text = await readFile(this.driver.path('spec/expec.json'), 'utf8');
    for (const region of this.manifestRegions) expect(text).toContain(region);
  }
  async expectManifestValue(path: string[], value: unknown): Promise<void> {
    let actual = JSON.parse(await readFile(this.driver.path('spec/expec.json'), 'utf8'));
    for (const part of path) actual = actual?.[part];
    expect(actual).toEqual(value);
  }
  expectNoManifestProperty(path: string[]): Promise<void> { return this.expectManifestValue(path, undefined); }
  async expectSelectedOutputs(ids: string[]): Promise<void> {
    const manifest = JSON.parse(await readFile(this.driver.path('spec/expec.json'), 'utf8'));
    expect(manifest.outputs.map((output: any) => output.id)).toEqual(ids);
  }
  async expectDeclaredPackage(alias: string, name: string, version: string, phases: string[]): Promise<void> {
    const manifest = JSON.parse(await readFile(this.driver.path('spec/expec.json'), 'utf8'));
    expect(manifest.packages).toContainEqual({ alias, name, version, phases });
  }
  async expectDestinationText(path: string, text: string): Promise<void> { expect(await readFile(this.driver.path(path), 'utf8')).toBe(text); }
  async expectNoDestinationFile(path: string): Promise<void> { await expect(stat(this.driver.path(path))).rejects.toMatchObject({ code: 'ENOENT' }); }
  expectStage(name: string, status: string): void {
    if (this.driver.report) expect(this.driver.report.stages, JSON.stringify({problems:this.driver.report.problems,stages:this.driver.report.stages.map((stage:any)=>({name:stage.name,status:stage.status}))})).toEqual(expect.arrayContaining([expect.objectContaining({ name, status })]));
    else expect(this.driver.result.stdout + this.driver.result.stderr).toContain(name + ': ' + status);
  }
  expectProblem(code: string): void { expect(this.driver.report.problems, JSON.stringify(this.driver.report)).toEqual(expect.arrayContaining([expect.objectContaining({ code })])); }
  async runFrom(directory: string, args: string[]): Promise<void> { await this.driver.write(directory + '/.keep', ''); await this.driver.run(args, directory); }
  async version(version: string): Promise<void> { this.driver.manifest.version = version; await this.driver.saveManifest(); }
  expectReportedVersion(version: string): void { expect(this.driver.report.version).toBe(version); }
  async identity(path: string): Promise<string> {
    const ledger = JSON.parse(await readFile(this.driver.path('project/.expec/identity.json'), 'utf8'));
    const elements = ledger.baseline.elements as { id: string; address: { owner: string | null; name: string | null } }[];
    let owner: string | null = null;
    for (const name of path.split('.')) {
      const matches = elements.filter(item => item.address.owner === owner && item.address.name === name);
      expect(matches).toHaveLength(1); owner = matches[0]!.id;
    }
    return owner!;
  }
  async expectIdentity(path: string, id: string): Promise<void> { expect(await this.identity(path)).toBe(id); }
  decisions(data: unknown): Promise<void> { return this.driver.write('changes.json', JSON.stringify(data)); }
  async implementMethod(owner: string, name: string, body: string): Promise<void> {
    const sources = await this.driver.nativeSources();
    const source = sources.find(source => source.statements.some(node => ts.isClassDeclaration(node) && node.name?.text === owner))!;
    const declaration = source.statements.filter(ts.isClassDeclaration).find(node => node.name?.text === owner)!;
    const method = declaration.members.filter(ts.isMethodDeclaration).find(node => node.name.getText() === name)!;
    expect(method.body).toBeDefined();
    await this.driver.write(source.fileName, source.text.slice(0, method.body!.getStart() + 1) + '\n' + body + '\n' + source.text.slice(method.body!.end - 1));
  }
  async afterTestPlanningChangeVitestDeclaration(): Promise<void> {
    const metadata = JSON.parse(await readFile(this.driver.path('project/node_modules/vitest/package.json'), 'utf8'));
    const path = 'project/node_modules/vitest/' + metadata.types.replace(/^\.\//, '');
    const text = await readFile(this.driver.path(path), 'utf8');
    await this.registerOutputs([{ id: 'native-edit', stage: 'tests', afterPlan: { path, text: text + '\nexport declare const changedAfterPlanning: unique symbol;\n' } }]);
    await this.outputs([{ id: 'acceptance', options: { domain: 'numbers', configFile: 'tsconfig.json' } }, { id: 'native-edit', options: {} }]);
  }
  async afterPlanningEditMethod(owner: string, name: string, body: string): Promise<void> {
    const source = (await this.driver.nativeSources()).find(source => source.statements.some(node => ts.isClassDeclaration(node) && node.name?.text === owner))!;
    const declaration = source.statements.filter(ts.isClassDeclaration).find(node => node.name?.text === owner)!;
    const method = declaration.members.filter(ts.isMethodDeclaration).find(node => node.name.getText() === name)!;
    expect(method.body).toBeDefined();
    const text = source.text.slice(0, method.body!.getStart() + 1) + '\n' + body + '\n' + source.text.slice(method.body!.end - 1);
    await this.registerOutputs([{ id: 'handwritten-edit', stage: 'contracts', afterPlan: { path: source.fileName, text } }]);
    await this.outputs([{ id: 'typescript', options: { directory: 'src' } }, { id: 'handwritten-edit', options: {} }]);
  }
  async afterPlanningChangePackageVersion(name: string, version: string): Promise<void> {
    const path = 'project/node_modules/' + name + '/package.json';
    const current = JSON.parse(await readFile(this.driver.path(path), 'utf8'));
    await this.registerOutputs([{ id: 'package-observer', stage: 'contracts', file: 'package-note.txt', text: 'observed package', afterPlan: { path, text: JSON.stringify({ ...current, version }) } }]);
    await this.outputs([{ id: 'package-observer', options: {} }]);
  }
  async expectInstalledMetadataVersion(name: string, version: string): Promise<void> {
    expect(JSON.parse(await readFile(this.driver.path('project/node_modules/' + name + '/package.json'), 'utf8')).version).toBe(version);
  }
  async expectNoNativeMethod(owner: string, name: string): Promise<void> {
    const declarations = (await this.driver.nativeSources()).flatMap(source => [...source.statements]).filter(ts.isClassDeclaration).filter(node => node.name?.text === owner);
    expect(declarations).toHaveLength(1);
    expect(declarations[0]!.members.filter(ts.isMethodDeclaration).filter(node => node.name.getText() === name)).toHaveLength(0);
  }
  async expectMethodBody(owner: string, name: string, body: string): Promise<void> {
    const declarations = (await this.driver.nativeSources()).flatMap(source => [...source.statements]).filter(ts.isClassDeclaration).filter(node => node.name?.text === owner);
    expect(declarations).toHaveLength(1);
    const methods = declarations[0]!.members.filter(ts.isMethodDeclaration).filter(node => node.name.getText() === name);
    expect(methods).toHaveLength(1); expect(methods[0]!.body?.getText()).toContain(body);
  }
  async rememberIdentities(): Promise<void> { this.driver.identities = await readFile(this.driver.path('project/.expec/identity.json'), 'utf8'); }
  async expectIdentitiesUnchanged(): Promise<void> { expect(await readFile(this.driver.path('project/.expec/identity.json'), 'utf8')).toBe(this.driver.identities); }
  changeAfterOutputWrite(source: string, path: string, text: string): void { this.driver.afterOutputWrite = { source, path, text }; }
  changeAfterWriterRelease(count: number, path: string, text: string): void { this.driver.afterWriterRelease = { count, path, text }; }
  interruptAfterOutputWrite(path: string): void { this.driver.signalAfterOutputWrite = path; }
  failActualWrite(path: string): void { this.driver.failure = { operation: 'write', path }; }
  failPendingRemoval(): void { this.driver.failure = { operation: 'remove', path: '.expec/build-pending.json' }; }
  clearActualWriteFailure(): void { delete this.driver.failure; }
  async expectPendingBuildRetained(): Promise<void> { expect((await stat(this.driver.path('project/.expec/build-pending.json'))).isFile()).toBe(true); }
  async rememberPendingIdentities(names = ['First', 'Second']): Promise<void> {
    const pending = JSON.parse(await readFile(this.driver.path('project/.expec/build-pending.json'), 'utf8'));
    this.driver.pendingIds = Object.fromEntries(pending.candidate.elements.filter((item: any) => item.address.owner === null).map((item: any) => [item.address.name, item.id]));
    expect(Object.keys(this.driver.pendingIds!)).toEqual(names);
  }
  async expectPendingIdentitiesBecameConfirmed(): Promise<void> {
    expect(this.driver.pendingIds).toBeDefined();
    for (const [name, id] of Object.entries(this.driver.pendingIds!)) await this.expectIdentity(name, id);
  }
  expectFileOutcome(path: string, state: string): void {
    const outcomes = this.driver.report.stages.flatMap((stage: any) => stage.receipt?.outcomes ?? []);
    expect(outcomes).toContainEqual(expect.objectContaining({ change: expect.objectContaining({ path }), state }));
  }
  async expectNativeClass(name: string): Promise<void> {
    const nodes = (await this.driver.nativeSources()).flatMap(source => [...source.statements]).filter(ts.isClassDeclaration).filter(node => node.name?.text === name);
    expect(nodes).toHaveLength(1);
  }
  expectNoPendingBuild(): Promise<void> { return this.expectNoDestinationFile('project/.expec/build-pending.json'); }
  async expectNoOutputUnder(path: string): Promise<void> { expect((await this.driver.filesUnder(path)).map(file => file.path.split(/[\\/]/).at(-1))).toEqual(['.keep']); }
  async expectNativeMethod(owner: string, name: string, returns: string): Promise<void> {
    const declarations = (await this.driver.nativeSources()).flatMap(source => [...source.statements]).filter(ts.isClassDeclaration).filter(node => node.name?.text === owner);
    expect(declarations).toHaveLength(1);
    const methods = declarations[0]!.members.filter(ts.isMethodDeclaration).filter(node => node.name.getText() === name);
    expect(methods).toHaveLength(1); expect(methods[0]!.type?.getText()).toBe(returns);
  }
  async expectNativeType(name: string, fields: Record<string, string>, optional: string[] = []): Promise<void> {
    const declarations = (await this.driver.nativeSources()).flatMap(source => [...source.statements]).filter(ts.isTypeAliasDeclaration).filter(node => node.name.text === name);
    expect(declarations).toHaveLength(1);
    expect(ts.isTypeLiteralNode(declarations[0]!.type)).toBe(true);
    const members = (declarations[0]!.type as ts.TypeLiteralNode).members.filter(ts.isPropertySignature);
    expect(Object.fromEntries(members.map(field => [field.name.getText(), field.type?.getText()]))).toEqual(fields);
    expect((declarations[0]!.type as ts.TypeLiteralNode).members.filter(ts.isPropertySignature).filter(item => item.questionToken).map(item => item.name.getText())).toEqual(optional);
  }
  async expectDocumentation(subject: string, text: string): Promise<void> {
    const docs = (await this.driver.filesUnder('project/docs')).map(file => file.text).join('\n');
    expect(docs).toContain(subject); expect(docs).toContain(text);
  }
  async expectNativeInvocationThrows(name: string, message: string): Promise<void> { expect(await this.driver.invoke(name)).toContain(message); }
  runNative(args: string[]): Promise<void> { return this.driver.run(args, '', undefined, 180_000); }
  run(args: string[]): Promise<void> { return this.driver.run(args); }
  expectExit(code: number): void { expect(this.driver.result, this.driver.result.stdout + this.driver.result.stderr).toMatchObject({ code }); }
  expectStatus(status: string): void { if (this.driver.report) expect(this.driver.report).toMatchObject({ format: 1, status }); else expect(this.driver.result.stdout + this.driver.result.stderr).toContain(status + ':'); }
  async expectAllBytesUnchanged(): Promise<void> { expect(await this.driver.capture()).toEqual(this.driver.before); }
  expectObligation(code: string, name: string): void {
    expect(this.driver.report.obligations).toContainEqual(expect.objectContaining({ code, message: expect.stringContaining(name), at: expect.objectContaining({ kind: 'source' }) }));
  }
  expectNoObligations(): void { expect(this.driver.report.obligations).toEqual([]); }
  expectNoNativeExecution(): void {
    expect(this.driver.report.stages.every((stage: any) => stage.native === undefined && stage.execution === undefined)).toBe(true);
  }
  expectNoInitializationPrompt(): void { expect(this.driver.result.stdout + this.driver.result.stderr).not.toContain('Initialize'); }
  expectReportedProjectRoot(): void { this.expectMessageContains(this.driver.path('project')); }
  expectMessageContains(text: string): void { expect(this.driver.result.stdout + this.driver.result.stderr).toContain(text); }
  async expectLocatedProblem(code: string, file: string, text: string): Promise<void> {
    const source = await this.driver.sourceText(file);
    const finding = this.driver.report.problems.find((problem: any) => problem.code === code && problem.at.kind === 'source'
      && problem.at.range.sourceId.endsWith('/' + file) && Array.from(source).slice(problem.at.range.start.offset, problem.at.range.end.offset).join('') === text);
    expect(finding, JSON.stringify(this.driver.report)).toBeDefined();
  }
  async expectNativeProblemAt(code: string, file: string, token: string): Promise<void> {
    const finding = this.driver.report.problems.find((problem: any) => problem.code === code && problem.at.kind === 'dependency'
      && problem.at.path[0] === 'typescript' && problem.at.path[1] === file);
    expect(finding, JSON.stringify(this.driver.report)).toBeDefined();
    const [, , start, length] = finding.at.path;
    expect(Number.isInteger(start) && start >= 0).toBe(true);
    expect(Number.isInteger(length) && length > 0).toBe(true);
    const source = await readFile(this.driver.path('project/' + file), 'utf8');
    expect(source.slice(start, start + length)).toBe(token);
  }

  expectSyntaxIn(file: string): void {
    expect(this.driver.report.syntax.some((finding: any) => finding.primaryRange.sourceId.endsWith('/' + file))).toBe(true);
  }
  dispose(): Promise<void> { return this.driver.dispose(); }
}
