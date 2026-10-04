import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import ts from 'typescript';
import { vi } from 'vitest';
import { NativeContextDriver } from './typescript-context.js';
import { Compiler, Outputs, SpecificationIdentity, FileProjectWriter, TypeScriptContext, LangiumReader, LangiumModel, acceptanceOutput,
  type IdentifiedSpecification, type Output, type OutputWrite, type OutputPlan, type SpecDiff, type ProjectSearch } from '../../src/index.js';

/** Owns actual project arrangement and public generation; native syntax supplies observations. */
export class AcceptanceGenerationDriver extends NativeContextDriver {
  readonly identities = new SpecificationIdentity(randomUUID);
  readonly outputs = new Outputs();
  current!: IdentifiedSpecification;
  output!: Output;
  written!: OutputWrite;
  diff!: SpecDiff;
  searched!: ProjectSearch;
  sourceText = '';
  private rememberedFiles: { path: string; version: string }[] = [];
  private bodyBefore = '';
  private rememberedFile = { path: '', text: '' };
  settings: Record<string, unknown> = {};
  private openedOptions: Record<string, unknown> = {};
  nativeResult: { success: boolean; testResults: { assertionResults: { title: string; status: string; failureMessages: string[] }[] }[] } | undefined;
  private installed = false;
  private observer: string | undefined;
  private releases: (() => void)[] = [];
  prepared!: OutputPlan;
  rememberedIdentity = '';
  constructor() { super(); this.outputs.register(acceptanceOutput); }
  source(text: string): void {
    this.sourceText = text;
    const compilation = new Compiler().compile({ source: { sourceId: 'shopping.expec', text }, locator: 'shopping', dependencies: { modules: [], packages: [] } });
    if (!compilation.value) throw Error(JSON.stringify(compilation));
    const identified = this.identities.associate(compilation.value);
    if (!identified.value) throw Error(JSON.stringify(identified)); this.current = identified.value;
  }
  provider(): void {
    const read = new LangiumReader().read({ sourceId: 'library.expec', text: 'function availableCopies() returns Number\nexamples { example "provider self check": availableCopies() => 1 }' });
    if (read.status !== 'accepted') throw Error(JSON.stringify(read));
    const compilation = new Compiler().compile({ source: { sourceId: 'shopping.expec', text: 'use availableCopies from "library"\nexamples { example "imported actual result": availableCopies() => 1 }' },
      locator: 'shopping', dependencies: { modules: [new LangiumModel('library', read.document)], packages: [] } });
    if (!compilation.value) throw Error(JSON.stringify(compilation)); const identified = this.identities.associate(compilation.value);
    if (!identified.value) throw Error(JSON.stringify(identified)); this.current = identified.value;
  }
  async generate(options: Record<string, unknown>): Promise<void> {
    this.openedOptions = { ...this.installed ? { configFile: 'tsconfig.json' } : {}, ...this.settings, ...options };
    const opened = this.outputs.open('acceptance', this.openedOptions, this.context, new FileProjectWriter(this.context), { workspaceModules: ['shopping'] });
    if (!opened.value) { this.written = { problems: opened.problems }; return; }
    this.output = opened.value; this.written = await this.output.create(this.current);
    this.confirm();
  }
  reopen(options: Record<string, unknown>): void {
    const opened = this.outputs.open('acceptance', { ...this.openedOptions, ...options }, this.context, new FileProjectWriter(this.context), { workspaceModules: ['shopping'] });
    if (!opened.value) throw Error(JSON.stringify(opened.problems)); this.output = opened.value;
  }
  private confirm(): void {
    if (this.written.artifacts) {
      const result = this.identities.withArtifacts(this.current, [...this.current.baseline.artifacts.filter(item => item.locator.outputId !== 'acceptance'), ...this.written.artifacts]);
      if (!result.value) throw Error(JSON.stringify(result.problems)); this.current = result.value;
    }
  }
  revise(text: string, decisions: readonly { from: string; to?: string }[] = []): void {
    const before = this.current, compilation = new Compiler().compile({ source: { sourceId: 'shopping.expec', text }, locator: 'shopping', dependencies: { modules: [], packages: [] } });
    if (!compilation.value) throw Error(JSON.stringify(compilation));
    const correspondence = decisions.map(decision => {
      const id = before.baseline.elements.find(item => item.address.name === decision.from)!.id;
      const target = decision.to && [...compilation.value!.inspection.query('action'), ...compilation.value!.inspection.query('check'), ...compilation.value!.inspection.query('scenario')].find(item => ('name' in item ? item.name : item.title.value) === decision.to);
      return target ? { id, to: target.id } : { retire: id };
    });
    const identified = this.identities.associate(compilation.value, before.baseline, correspondence);
    if (!identified.value) throw Error(JSON.stringify(identified.problems));
    const compared = this.identities.compare(before.baseline, identified.value);
    if (!compared.value) throw Error(JSON.stringify(compared.problems));
    this.sourceText = text; this.current = identified.value; this.diff = compared.value;
  }
  async update(): Promise<void> { this.written = await this.output.update(this.diff, this.current); this.confirm(); }
  async insert(): Promise<void> { this.written = await this.output.insert(this.diff, this.current); this.confirm(); }
  async mapDifferentDriverName(from: string, to: string): Promise<void> {
    const path = 'test/driver/basket.ts'; await this.file(path, (await this.text(path)).replace(from + '(', to + '('));
    const mapped = this.identities.withArtifacts(this.current, this.current.baseline.artifacts.map(item => item.specId === this.subject(from)
      ? { ...item, locator: { ...item.locator, value: { file: path, declaration: [{ kind: 'class', name: 'BasketDriver' }, { kind: 'method', name: to, static: false }] } } } : item));
    if (!mapped.value) throw Error(JSON.stringify(mapped.problems)); this.current = mapped.value;
  }
  async deleteSubject(name: string): Promise<void> { this.written = await this.output.delete(this.subject(name)); this.confirm(); }
  async deleteGroup(): Promise<void> {
    const groups = this.current.baseline.elements.filter(item => item.address.kind === 'examples'); if (groups.length !== 1) throw Error('Arrange one group.');
    this.written = await this.output.delete(groups[0]!.id); this.confirm();
  }
  async scenarioComment(title: string, comment: string): Promise<void> {
    const { path, source, call } = await this.callback(title), callback = call.arguments[1] as ts.ArrowFunction;
    await this.file(path, source.text.slice(0, callback.body.getStart() + 1) + '\n// ' + comment + '\n' + source.text.slice(callback.body.getStart() + 1));
  }
  subject(name: string): string { const record = this.current.baseline.elements.find(item => item.address.name === name); if (!record) throw Error('Unknown fixture subject: ' + name); return record.id; }
  async readSubject(name: string): Promise<void> { this.read = await this.output.read(this.subject(name)); }
  async readGroup(): Promise<void> {
    const groups = this.current.baseline.elements.filter(item => item.address.kind === 'examples');
    if (groups.length !== 1) throw Error('Arrange one group.'); this.read = await this.output.read(groups[0]!.id);
  }
  async searchSubject(name: string): Promise<void> { this.searched = await this.output.search(this.subject(name)); }
  async prepareUpdate(): Promise<void> {
    const report = await this.output.plan({ operation: 'update', diff: this.diff, current: this.current }, await this.context.readSnapshot());
    if (!report.value) throw Error(JSON.stringify(report.problems)); this.prepared = report.value;
  }
  async applyPrepared(): Promise<void> { const receipt = await new FileProjectWriter(this.context).apply(this.prepared); this.written = { receipt, problems: receipt.problems }; }
  async callback(title: string): Promise<{ path: string; source: ts.SourceFile; statement: ts.ExpressionStatement; call: ts.CallExpression }> {
    const artifact = this.current.baseline.artifacts.find(item => item.specId === this.subject(title) && item.locator.format === 'vitest-test-1')!;
    const path = (artifact.locator.value as { file: string }).file, source = ts.createSourceFile(path, await this.text(path), ts.ScriptTarget.Latest, true);
    const statement = source.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
      && ts.isStringLiteralLike(node.expression.arguments[0]!) && node.expression.arguments[0]!.text === title);
    if (!statement || !ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) throw Error('Actual callback is absent.');
    return { path, source, statement, call: statement.expression };
  }
  async changeCallback(title: string, from: string, to: string): Promise<void> {
    const { path, source, call } = await this.callback(title), edits: ts.Identifier[] = [];
    const scan = (node: ts.Node): void => { if (ts.isPropertyAccessExpression(node) && node.name.text === from && ts.isIdentifier(node.name)) edits.push(node.name); node.forEachChild(scan); };
    scan(call.arguments[1]!); if (edits.length !== 1) throw Error('Arrange exactly one native call.');
    const name = edits[0]!; await this.file(path, source.text.slice(0, name.getStart()) + to + source.text.slice(name.end));
  }
  async duplicateCallback(title: string): Promise<void> { const { path, source, statement } = await this.callback(title); await this.file(path, source.text + '\n' + statement.getFullText()); }
  async removeNativeVitestDeclaration(): Promise<void> { await fs.unlink(this.path('node_modules/vitest/dist/index.d.ts')); }
  async emptyCheck(name: string): Promise<void> {
    const path = 'test/dsl/shopping.ts', source = ts.createSourceFile(path, await this.text(path), ts.ScriptTarget.Latest, true);
    const method = source.statements.filter(ts.isClassDeclaration).flatMap(node => node.members).find(node => ts.isMethodDeclaration(node) && node.name.getText() === name) as ts.MethodDeclaration;
    await this.file(path, source.text.slice(0, method.body!.getStart()) + '{}' + source.text.slice(method.body!.end));
  }
  async changeExpected(value: number): Promise<void> { const path = 'test/acceptance/shopping.test.ts'; await this.file(path, (await this.text(path)).replace('expectBookQuantity("Dune", 1)', 'expectBookQuantity("Dune", ' + value + ')')); }
  async emptyCallback(): Promise<void> {
    const path = 'test/acceptance/shopping.test.ts', source = ts.createSourceFile(path, await this.text(path), ts.ScriptTarget.Latest, true);
    const statement = source.statements.find(item => ts.isExpressionStatement(item) && ts.isCallExpression(item.expression)) as ts.ExpressionStatement;
    const callback = (statement.expression as ts.CallExpression).arguments[1] as ts.ArrowFunction;
    await this.file(path, source.text.slice(0, callback.body.getStart()) + '{}' + source.text.slice(callback.body.end));
  }
  async aliasFixture(): Promise<void> {
    const path = 'test/acceptance/shopping.test.ts'; await this.file(path, (await this.text(path)).replace('import { test }', 'import { test as scenario }').replace('\ntest(', '\nscenario(').replaceAll('\n', '\r\n').replace('  await', '\t// Keep this explanation of the shopper action.\r\n\tawait'));
  }
  async redirectFixture(): Promise<void> {
    await this.file('test/dsl/other-test.ts', `import { test as base } from 'vitest';
      import { Shopping } from './shopping.js'; import { BasketDriver } from '../driver/basket.js';
      export const test = base.extend('shopping', () => new Shopping(new BasketDriver()));`);
    const path = 'test/acceptance/shopping.test.ts';
    await this.file(path, (await this.text(path)).replace('../dsl/shopping-test.js', '../dsl/other-test.js'));
  }
  denyWrite(path: string): void {
    const open = fs.open.bind(fs);
    this.releases.push(vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (String(args[0]) === this.path(path) && args[1] !== 'r') throw Object.assign(Error('Test denied this native file write'), { code: 'EACCES' });
      return open(...args);
    }).mockRestore);
  }
  async partialFilesAgree(): Promise<boolean> {
    const snapshot = await this.context.readSnapshot();
    for (const outcome of this.written.receipt!.outcomes) for (const observed of outcome.after) {
      const actual = snapshot.files.find(file => file.path === observed.path);
      if (observed.state === 'file' && (!actual || actual.version !== observed.version || !Buffer.from(actual.bytes).equals(observed.bytes))) return false;
      if (observed.state === 'absent' && actual) return false;
    }
    return this.written.receipt!.outcomes.some(item => item.state === 'applied') && this.written.receipt!.outcomes.some(item => item.state === 'not-applied');
  }
  async implementBasketExcept(except: string): Promise<void> {
    const path = 'test/driver/shopping.ts';
    await this.file(path, (await this.text(path)).replace('export class ShoppingDriver {', `export class ShoppingDriver {
      private readonly available = new Set<string>();
      private readonly quantities = new Map<string, number>();`));
    const bodies: Record<string, string> = { bookIsAvailable: 'this.available.add(title);', startWithEmptyBasket: 'this.quantities.clear();',
      addBook: 'if (!this.available.has(title)) throw Error("Unknown book"); this.quantities.set(title, (this.quantities.get(title) ?? 0) + 1);', bookQuantity: 'return this.quantities.get(title) ?? 0;' };
    for (const [name, body] of Object.entries(bodies)) if (name !== except) await this.replaceStub(name, body);
  }
  override async dispose(): Promise<void> { for (const release of this.releases.reverse()) release(); await super.dispose(); }
  async remember(): Promise<void> { this.rememberedFiles = (await this.context.readSnapshot()).files.map(({ path, version }) => ({ path, version })); }
  async unchanged(): Promise<boolean> { return JSON.stringify((await this.context.readSnapshot()).files.map(({ path, version }) => ({ path, version }))) === JSON.stringify(this.rememberedFiles); }
  async rememberFile(path: string): Promise<void> { this.rememberedFile = { path, text: await this.text(path) }; }
  async sameFile(): Promise<boolean> { return this.rememberedFile.text === await this.text(this.rememberedFile.path); }
  async existingFixture(): Promise<void> {
    await this.basket();
    await this.file('test/dsl/shopping.ts', `import { expect } from 'vitest';
import { BasketDriver } from '../driver/basket.js';
export class Shopping {
  constructor(private readonly driver: BasketDriver) {}
  async bookIsAvailable(title: string): Promise<void> { this.driver.bookIsAvailable(title); }
  async startWithEmptyBasket(): Promise<void> { this.driver.startWithEmptyBasket(); }
  async addBook(title: string): Promise<void> { this.driver.addBook(title); }
  async bookQuantity(title: string): Promise<number> { return this.driver.bookQuantity(title); }
  async expectBookQuantity(title: string, expected: number): Promise<void> {
    // Keep this independently authored expectation.
    expect(await this.bookQuantity(title)).toStrictEqual(expected);
  }
}`);
    await this.file('test/dsl/existing-test.ts', `import { test as base } from 'vitest';
import { Shopping } from './shopping.js';
import { BasketDriver } from '../driver/basket.js';
// Keep this explanation of the fixture.
export const test = base.extend('shopping', () => new Shopping(new BasketDriver()));`);
    const artifacts = this.current.baseline.elements.filter(item => ['setup', 'action', 'observation', 'check'].includes(item.address.kind)).map(item => ({
      specId: item.id, locator: { outputId: 'acceptance', format: 'typescript-symbol-1', value: { file: 'test/dsl/shopping.ts', declaration: [
        { kind: 'class', name: 'Shopping' }, { kind: 'method', name: item.address.name!, static: false },
      ] } },
    }));
    const mapped = this.identities.withArtifacts(this.current, [...this.current.baseline.artifacts, ...artifacts]);
    if (!mapped.value) throw Error(JSON.stringify(mapped.problems)); this.current = mapped.value;
  }
  async driverMethod(name: string): Promise<ts.MethodDeclaration> {
    const locator = this.current.baseline.artifacts.find(item => item.locator.format === 'typescript-symbol-1'
      && (item.locator.value as { file: string }).file.includes('/driver/') && (item.locator.value as { declaration: { name: string }[] }).declaration.at(-1)?.name === name)?.locator;
    if (!locator) throw Error('No mapped native driver method: ' + name);
    const file = (locator.value as { file: string }).file, source = ts.createSourceFile(file, await this.text(file), ts.ScriptTarget.Latest, true);
    const node = source.statements.filter(ts.isClassDeclaration).flatMap(item => item.members).find(item => ts.isMethodDeclaration(item) && item.name.getText() === name);
    if (!node || !ts.isMethodDeclaration(node)) throw Error('Mapped native method is absent.'); return node;
  }
  async rememberBody(name: string): Promise<void> { this.bodyBefore = (await this.driverMethod(name)).body!.getText(); }
  async sameBody(name: string): Promise<boolean> { return (await this.driverMethod(name)).body!.getText() === this.bodyBefore; }
  rename(from: string, to: string): void { this.revise(this.sourceText.replaceAll(from, to), [{ from, to }]); }
  renameCheck(from: string, to: string, comparison: string): void { this.revise(this.sourceText.replaceAll(from, to).replace('actual == expected', comparison), [{ from, to }]); }
  retireScenario(title: string): void {
    const node = [...this.current.specification.inspection.query('scenario')].find(item => item.title.value === title)!;
    if (node.origin.kind !== 'source') throw Error('Fixture scenario must be source-backed.');
    this.revise(this.sourceText.slice(0, node.origin.range.start.offset) + this.sourceText.slice(node.origin.range.end.offset), [{ from: title }]);
  }
  async editCheck(name: string, text: string): Promise<void> {
    const path = 'test/dsl/shopping.ts', source = ts.createSourceFile(path, await this.text(path), ts.ScriptTarget.Latest, true),
      node = source.statements.filter(ts.isClassDeclaration).flatMap(item => item.members).find(item => ts.isMethodDeclaration(item) && item.name.getText() === name) as ts.MethodDeclaration;
    await this.file(path, source.text.slice(0, node.body!.getStart() + 1) + '\n' + text + source.text.slice(node.body!.getStart() + 1));
  }
  mapDriverMethods(names: readonly string[]): void {
    const driver = this.settings.driver as { value: { file: string; declaration: { kind: string; name: string }[] } };
    const artifacts = this.current.baseline.elements.filter(item => names.includes(item.address.name ?? '') && ['setup', 'action', 'observation'].includes(item.address.kind)).map(item => ({
      specId: item.id, locator: { outputId: 'acceptance', format: 'typescript-symbol-1', value: { file: driver.value.file,
        declaration: [...driver.value.declaration, { kind: 'method', name: item.address.name!, static: false }] } },
    }));
    const mapped = this.identities.withArtifacts(this.current, artifacts); if (!mapped.value) throw Error(JSON.stringify(mapped.problems)); this.current = mapped.value;
  }
  async nativeDependencies(): Promise<void> {
    if (this.installed) return;
    await this.install({ vitest: '5.0.2', '@types/node': '24.13.6' }); this.installed = true;
    await this.file('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, types: ['node'], skipLibCheck: true }, include: ['**/*.ts'] }));
    this.context = new TypeScriptContext(this.context, { configFile: 'tsconfig.json', imports: ['vitest'] });
  }
  async basket(): Promise<void> {
    await this.nativeDependencies();
    await this.file('basket.ts', `export class Basket {
  readonly available = new Set<string>();
  readonly contents = new Map<string, number>();
  add(title: string): void {
    if (!this.available.has(title)) throw Error("Unavailable book");
    this.contents.set(title, (this.contents.get(title) ?? 0) + 1);
  }
  quantity(title: string): number { return this.contents.get(title) ?? 0; }
}`);
    await this.file('test/driver/basket.ts', `import { Basket } from '../../basket.js';
export class BasketDriver {
  private readonly basket = new Basket();
  bookIsAvailable(title: string): void { this.basket.available.add(title); }
  startWithEmptyBasket(): void { this.basket.contents.clear(); }
  addBook(title: string): void { this.basket.add(title); }
  bookQuantity(title: string): number { return this.basket.quantity(title); }
}`);
    const declaration = [{ kind: 'class', name: 'BasketDriver' }];
    this.settings = { adoptExisting: true, driver: { outputId: 'acceptance', format: 'typescript-symbol-1', value: { file: 'test/driver/basket.ts', declaration } } };
    const artifacts = this.current.baseline.elements.filter(item => ['setup', 'action', 'observation'].includes(item.address.kind)).map(item => ({
      specId: item.id, locator: { outputId: 'acceptance', format: 'typescript-symbol-1', value: { file: 'test/driver/basket.ts', declaration: [...declaration, { kind: 'method', name: item.address.name!, static: false }] } },
    }));
    this.current = this.identities.withArtifacts(this.current, artifacts).value!;
  }
  async run(): Promise<void> {
    if (!this.written.receipt || this.written.receipt.status === 'stopped') throw Error('Generation did not apply: ' + JSON.stringify(this.written.problems));
    await this.nativeDependencies();
    await this.file('vitest.config.ts', 'import { defineConfig } from "vitest/config"; export default defineConfig({ test: { include: ["test/acceptance/*.test.ts"], setupFiles: ' + JSON.stringify(this.observer ? ['./native-observer.ts'] : []) + ' } });');
    if (this.observer) await this.file('native-observer.ts', `import { afterAll } from 'vitest'; import { writeFileSync } from 'node:fs'; import * as application from './application.js';\nafterAll(() => { writeFileSync('observed.json', JSON.stringify(${this.observer})); });`);
    try {
      await promisify(execFile)(process.execPath, [join(this.root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.config.ts', '--reporter=json', '--outputFile=results.json'],
        { cwd: this.root, timeout: 20_000, maxBuffer: 1024 * 1024, windowsHide: true });
    } catch (error) { if ((error as { code?: number }).code !== 1) throw error; }
    this.nativeResult = JSON.parse(await this.text('results.json')) as typeof this.nativeResult;
  }
  async observedQuantity(value: number): Promise<void> {
    await this.file('test/driver/basket.ts', (await this.text('test/driver/basket.ts')).replace('return this.basket.quantity(title);', 'return ' + value + ';'));
  }
  async noAddition(): Promise<void> { await this.file('basket.ts', (await this.text('basket.ts')).replace('this.contents.set(title, (this.contents.get(title) ?? 0) + 1);', 'void title;')); }
  application(name: string, file: string, nativeName: string): void {
    const item = [...this.current.specification.inspection.query('function')].find(item => item.name === name)!;
    const associated = this.identities.withArtifacts(this.current, [...this.current.baseline.artifacts, {
      specId: this.current.id(item.id), locator: { outputId: 'typescript', format: 'typescript-symbol-1', value: { file, declaration: [{ kind: 'function', name: nativeName }] } },
    }]);
    if (!associated.value) throw Error(JSON.stringify(associated.problems)); this.current = associated.value;
  }
  identify(kinds: readonly string[], ids: readonly string[]): void {
    const records = this.current.baseline.elements.filter(item => kinds.includes(item.address.kind));
    if (records.length !== ids.length) throw Error('Identity arrangement must name exactly the selected subjects.');
    const replacement = new Map(records.map((record, index) => [record.id, ids[index]!]));
    const issued = this.current.baseline.elements.map(record => replacement.get(record.id) ?? record.id), next = new SpecificationIdentity(() => issued.shift()!).associate(this.current.specification);
    if (!next.value || records.some((record, index) => next.value!.id(this.current.node(record.id)) !== ids[index])) throw Error('Identity arrangement did not establish the requested subjects.');
    this.current = next.value;
  }
  async replaceStub(name: string, body: string): Promise<void> {
    const file = this.written.artifacts?.find(item => item.locator.format === 'typescript-symbol-1' && (item.locator.value as { file: string }).file.includes('/driver/')
      && (item.locator.value as { declaration: { name: string }[] }).declaration.at(-1)?.name === name)?.locator.value as { file: string } | undefined;
    if (!file) throw Error('No generated driver association for ' + name);
    const text = await this.text(file.file), source = ts.createSourceFile(file.file, text, ts.ScriptTarget.Latest, true);
    const method = source.statements.filter(ts.isClassDeclaration).flatMap(node => node.members).find(node => ts.isMethodDeclaration(node) && node.name.getText() === name);
    if (!method || !ts.isMethodDeclaration(method) || !method.body) throw Error('No generated native method body.');
    await this.file(file.file, text.slice(0, method.body.getStart()) + '{ ' + body + ' }' + text.slice(method.body.end));
  }
  async operations(text: string, types: readonly string[] = []): Promise<void> {
    await this.nativeDependencies(); await this.file('test/driver/manual.ts', text);
    const artifacts = this.current.baseline.elements.filter(item => {
      const node = this.current.specification.inspection.read(this.current.node(item.id));
      return ['setup', 'action', 'observation'].includes(node.kind) && 'body' in node && node.body.kind === 'absent';
    }).map(item => ({
      specId: item.id, locator: { outputId: 'acceptance', format: 'typescript-symbol-1', value: { file: 'test/driver/manual.ts', declaration: [
        { kind: 'class', name: 'ManualDriver' }, { kind: 'method', name: item.address.name!, static: false },
      ] } },
    }));
    for (const name of types) {
      const item = this.current.baseline.elements.find(item => item.address.name === name && item.address.kind === 'record-type-declaration')!;
      artifacts.push({ specId: item.id, locator: { outputId: 'typescript', format: 'typescript-symbol-1', value: {
        file: 'test/driver/manual.ts', declaration: [{ kind: 'interface', name, static: false }],
      } } });
    }
    const mapped = this.identities.withArtifacts(this.current, artifacts);
    if (!mapped.value) throw Error(JSON.stringify(mapped.problems)); this.current = mapped.value;
    this.settings = { adoptExisting: true, driver: { outputId: 'acceptance', format: 'typescript-symbol-1', value: { file: 'test/driver/manual.ts', declaration: [{ kind: 'class', name: 'ManualDriver' }] } } };
  }
  async eventValues(): Promise<unknown[]> { return (await this.text('events.jsonl')).trim().split('\n').map(line => JSON.parse(line)); }
  observe(expression: string): void { this.observer = expression; }
  async nativeApplication(name: string, body: string, declarations: string): Promise<void> {
    await this.nativeDependencies();
    await this.file('application.ts', declarations + '\nexport let observed: unknown;\nexport function ' + name + '() { return observed = (() => { ' + body + ' })(); }');
    this.application(name, 'application.ts', name);
    const artifacts = [...this.current.baseline.artifacts];
    for (const item of this.current.baseline.elements.filter(item => item.address.kind === 'record-type-declaration')) artifacts.push({
      specId: item.id, locator: { outputId: 'typescript', format: 'typescript-symbol-1', value: { file: 'application.ts', declaration: [{ kind: 'interface', name: item.address.name! }] } },
    });
    const mapped = this.identities.withArtifacts(this.current, artifacts);
    if (!mapped.value) throw Error(JSON.stringify(mapped.problems)); this.current = mapped.value;
  }
  async text(path: string): Promise<string> { return fs.readFile(this.path(path), 'utf8'); }
  async calls(path: string): Promise<string[]> {
    const source = ts.createSourceFile(path, await this.text(path), ts.ScriptTarget.Latest, true), result: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression) && ts.isPropertyAccessExpression(node.expression.expression)) {
        const call = node.expression;
        result.push('await ' + call.expression.getText(source) + '(' + call.arguments.map(value => ts.isStringLiteralLike(value) ? JSON.stringify(value.text) : value.getText(source)).join(', ') + ')');
      }
      node.forEachChild(visit);
    };
    visit(source); return result;
  }
}
