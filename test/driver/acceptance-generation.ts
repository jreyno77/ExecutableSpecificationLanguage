import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import ts from 'typescript';
import { NativeContextDriver } from './typescript-context.js';
import { Compiler, Outputs, SpecificationIdentity, FileProjectWriter, TypeScriptContext, acceptanceOutput,
  type IdentifiedSpecification, type Output, type OutputWrite, type SpecDiff, type ProjectRead, type ProjectSearch } from '../../src/index.js';

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
  settings: Record<string, unknown> = {};
  nativeResult: { success: boolean; testResults: { assertionResults: { title: string; status: string; failureMessages: string[] }[] }[] } | undefined;
  private installed = false;
  private observer: string | undefined;
  constructor() { super(); this.outputs.register(acceptanceOutput); }
  source(text: string): void {
    this.sourceText = text;
    const compilation = new Compiler().compile({ source: { sourceId: 'shopping.expec', text }, locator: 'shopping', dependencies: { modules: [], packages: [] } });
    if (!compilation.value) throw Error(JSON.stringify(compilation));
    const identified = this.identities.associate(compilation.value);
    if (!identified.value) throw Error(JSON.stringify(identified)); this.current = identified.value;
  }
  async generate(options: Record<string, unknown>): Promise<void> {
    const opened = this.outputs.open('acceptance', { ...this.installed ? { configFile: 'tsconfig.json' } : {}, ...this.settings, ...options }, this.context, new FileProjectWriter(this.context), { workspaceModules: ['shopping'] });
    if (!opened.value) { this.written = { problems: opened.problems }; return; }
    this.output = opened.value; this.written = await this.output.create(this.current);
    this.confirm();
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
      const target = decision.to && [...compilation.value!.inspection.query('action'), ...compilation.value!.inspection.query('scenario')].find(item => ('name' in item ? item.name : item.title.value) === decision.to);
      return target ? { id, to: target.id } : { retire: id };
    });
    const identified = this.identities.associate(compilation.value, before.baseline, correspondence);
    if (!identified.value) throw Error(JSON.stringify(identified.problems));
    const compared = this.identities.compare(before.baseline, identified.value);
    if (!compared.value) throw Error(JSON.stringify(compared.problems));
    this.sourceText = text; this.current = identified.value; this.diff = compared.value;
  }
  async update(): Promise<void> { this.written = await this.output.update(this.diff, this.current); this.confirm(); }
  subject(name: string): string { const record = this.current.baseline.elements.find(item => item.address.name === name); if (!record) throw Error('Unknown fixture subject: ' + name); return record.id; }
  async readSubject(name: string): Promise<void> { this.read = await this.output.read(this.subject(name)); }
  async searchSubject(name: string): Promise<void> { this.searched = await this.output.search(this.subject(name)); }
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
  async remember(): Promise<void> { this.rememberedFiles = (await this.context.readSnapshot()).files.map(({ path, version }) => ({ path, version })); }
  async unchanged(): Promise<boolean> { return JSON.stringify((await this.context.readSnapshot()).files.map(({ path, version }) => ({ path, version }))) === JSON.stringify(this.rememberedFiles); }
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
    const artifacts = this.current.baseline.elements.filter(item => ['setup', 'action', 'observation'].includes(item.address.kind)).map(item => ({
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
