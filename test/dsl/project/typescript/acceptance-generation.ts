import { afterEach, expect } from 'vitest';
import { AcceptanceGenerationDriver } from '../../../driver/project/typescript/acceptance-generation.js';

const projects: AcceptanceGenerationDriver[] = [];
const shoppingSource = `examples {
  setup bookIsAvailable(title: Text) returns Nothing
  setup startWithEmptyBasket() returns Nothing
  action addBook(title: Text) returns Nothing
  observation bookQuantity(title: Text) returns Number
  check expectBookQuantity(title: Text, expected: Number) {
    let actual = bookQuantity(title)
    assert actual == expected
  }
  scenario "a shopper can add an available book" {
    given bookIsAvailable("Dune")
    given startWithEmptyBasket()
    when addBook("Dune")
    then expectBookQuantity("Dune", 1)
  }
}`;
afterEach(async () => { for (const project of projects.splice(0)) await project.dispose(); });
export class AcceptanceGenerationExamples {
  constructor(readonly driver: AcceptanceGenerationDriver) {}
  insert(): Promise<void> { return this.driver.insert(); }
  mapDifferentDriverName(from: string, to: string): Promise<void> { return this.driver.mapDifferentDriverName(from, to); }
  renameCheck(from: string, to: string, comparison: string): void { this.driver.renameCheck(from, to, comparison); }
  connectNativeDriver(text: string, types: string[] = []): Promise<void> { return this.driver.operations(text, types); }
  readExamples(): Promise<void> { return this.driver.readGroup(); }
  async disableNativeChecking(): Promise<void> {
    const config = JSON.parse(await this.driver.text('tsconfig.json')); config.compilerOptions.noCheck = true;
    await this.driver.file('tsconfig.json', JSON.stringify(config));
  }
  async captureOldApplication(): Promise<void> {
    await this.driver.basket();
    await this.driver.file('test/driver/basket.ts', (await this.driver.text('test/driver/basket.ts')).replace('bookQuantity(title: string): number', 'bookQuantity(title: string): string').replace('return this.basket.quantity(title);', 'return "old result";'));
    this.driver.snapshot = await this.driver.context.readSnapshot();
    expect(new TextDecoder().decode(this.driver.snapshot.files.find(file => file.path === 'test/driver/basket.ts')!.bytes)).toContain('return "old result"');
  }
  async expectOneDriverMethod(name: string): Promise<void> {
    const node = await this.driver.driverMethod(name);
    expect(node.parent.getChildren().flatMap(child => child.getChildren()).filter(child => 'name' in child && (child.name as { getText(): string }).getText() === name)).toHaveLength(1);
  }
  expectApplicationAssociation(name: string, outputId: string): void {
    expect(this.driver.current.baseline.artifacts.filter(item => item.specId === this.driver.subject(name)).map(item => item.locator.outputId)).toEqual([outputId]);
  }
  static async fromSource(text: string): Promise<AcceptanceGenerationExamples> {
    const driver = new AcceptanceGenerationDriver(); projects.push(driver);
    await driver.connect(); driver.source(text); return new AcceptanceGenerationExamples(driver);
  }
  static shoppingContract(): Promise<AcceptanceGenerationExamples> {
    return this.fromSource(`examples {
  setup bookIsAvailable(title: Text) returns Nothing
  setup startWithEmptyBasket() returns Nothing
  action addBook(title: Text) returns Nothing
  observation bookQuantity(title: Text) returns Number
  check expectBookQuantity(title: Text, expected: Number) {
    let actual = bookQuantity(title)
    assert actual == expected
  }
  scenario "a shopper can add an available book" {
    given bookIsAvailable("Dune")
    given startWithEmptyBasket()
    when addBook("Dune")
    then expectBookQuantity("Dune", 1)
  }
}`);
  }
  generate(options: Record<string, unknown>): Promise<void> { return this.driver.generate(options); }
  reopen(options: Record<string, unknown>): void { this.driver.reopen(options); }
  revise(text: string): void { this.driver.revise(text); }
  rememberFiles(): Promise<void> { return this.driver.remember(); }
  async expectAllBytesUnchanged(): Promise<void> { expect(await this.driver.unchanged()).toBe(true); }
  rememberScenarioIdentity(title: string): void { this.driver.rememberedIdentity = this.driver.subject(title); }
  renameScenario(from: string, to: string): void { this.driver.rename(from, to); }
  expectScenarioIdentityUnchanged(title: string): void { expect(this.driver.subject(title)).toBe(this.driver.rememberedIdentity); }
  establishScenarioIdentity(id: string): void { this.driver.identify(['scenario', 'example'], [id]); }
  expectDefinitionFiles(paths: string[]): void { expect([...new Set(this.driver.searched.definitions.map(item => (item.value as { file: string }).file))].sort()).toEqual([...paths].sort()); }
  expectScenarioDefinition(title: string, file: string): void {
    expect(this.driver.searched.definitions).toEqual([{ outputId: 'acceptance', format: 'vitest-test-1', value: { file, id: this.driver.subject(title) } }]);
  }
  async expectActualUse(file: string, token: string, direction: 'incoming' | 'outgoing', target?: 'project'): Promise<void> {
    const text = await this.driver.text(file), uses = this.driver.searched[direction].uses;
    expect(uses.some(use => { const at = use.at.value as { file: string; start: number; end: number; role: string };
      return at.file === file && text.slice(at.start, at.end) === token && at.role === 'call' && (!target || use.target.kind === target); })).toBe(true);
  }
  changeActualScenarioCall(title: string, from: string, to: string): Promise<void> { return this.driver.changeCallback(title, from, to); }
  copyActualScenarioWithMarker(title: string): Promise<void> { return this.driver.duplicateCallback(title); }
  removeActualVitestDeclaration(): Promise<void> { return this.driver.removeNativeVitestDeclaration(); }
  expectIncompleteNativeSearch(): void { expect(this.driver.searched.problems.length).toBeGreaterThan(0); expect(this.driver.searched.incoming.coverage.complete).toBe(false); }
  prepareUpdate(): Promise<void> { return this.driver.prepareUpdate(); }
  applyPreparedUpdate(): Promise<void> { return this.driver.applyPrepared(); }
  expectStaleWriteStopped(): void { expect(this.driver.written.receipt?.status).toBe('stopped'); expect(this.driver.written.problems.map(item => item.code)).toContain('stale-project'); }
  emptyGeneratedCheck(name: string): Promise<void> { return this.driver.emptyCheck(name); }
  establishHandwrittenFixtureProject(): Promise<void> { return this.driver.existingFixture(); }
  rememberFile(path: string): Promise<void> { return this.driver.rememberFile(path); }
  async expectRememberedFileUnchanged(): Promise<void> { expect(await this.driver.sameFile()).toBe(true); }
  expectNoAcceptanceOwnershipOf(path: string): void { expect(this.driver.written.artifacts!.some(item => (item.locator.value as { file: string }).file === path)).toBe(false); }
  expectWriteStatus(status: string): void { expect(this.driver.written.problems, JSON.stringify(this.driver.written.problems)).toEqual([]); expect(this.driver.written.receipt?.status).toBe(status); }
  reviseToShoppingContract(): void { this.driver.revise(shoppingSource); }
  update(): Promise<void> { return this.driver.update(); }
  deleteScenario(title: string): Promise<void> { return this.driver.deleteSubject(title); }
  deleteOnlyExamplesGroup(): Promise<void> { return this.driver.deleteGroup(); }
  expectNoConfirmedScenarioAssociation(title: string): void { expect(this.driver.written.artifacts!.some(item => item.specId === this.driver.subject(title))).toBe(false); }
  addScenarioComment(title: string, comment: string): Promise<void> { return this.driver.scenarioComment(title, comment); }
  async expectFileAbsent(path: string): Promise<void> { await expect(this.driver.text(path)).rejects.toMatchObject({ code: 'ENOENT' }); }
  mapDriverClass(file: string, name: string): void { this.driver.settings.driver = { outputId: 'acceptance', format: 'typescript-symbol-1', value: { file, declaration: [{ kind: 'class', name }] } }; }
  mapDriverMethods(names: string[]): void { this.driver.mapDriverMethods(names); }
  implementDriverBody(name: string, body: string): Promise<void> { return this.driver.replaceStub(name, body); }
  replaceFixtureInitializer(name: string, text: string): Promise<void> { return this.driver.replaceFixtureInitializer(name, text); }
  addFixtureComment(name: string, comment: string): Promise<void> { return this.driver.fixtureComment(name, comment); }
  async expectFixtureValue(name: string, value: unknown): Promise<void> { expect(await this.driver.fixtureValue(name)).toEqual(value); }
  async expectFixtureComment(name: string, comment: string): Promise<void> { expect(await this.driver.fixtureCommentText(name)).toContain(comment); }
  async expectProblemAtFixtureInitializer(name: string): Promise<void> { expect(await this.driver.conflictAtFixtureInitializer(name)).toBe(true); }
  rememberDriverBody(name: string): Promise<void> { return this.driver.rememberBody(name); }
  async expectDriverBodyUnchanged(name: string): Promise<void> { expect(await this.driver.sameBody(name)).toBe(true); }
  async expectDriverSignature(name: string, parameters: string[], result: string): Promise<void> {
    const method = await this.driver.driverMethod(name); expect(method.parameters.map(parameter => parameter.getText())).toEqual(parameters); expect(method.type?.getText()).toBe(result);
  }
  capturePinnedNativeDeclarations(): Promise<void> { return this.driver.nativeDependencies(); }
  static async generatedShoppingWithRealDriver(): Promise<AcceptanceGenerationExamples> {
    const project = await this.shoppingContract(); await project.connectRealBasketDriver(); await project.generate({ domain: 'shopping' }); project.expectWriteStatus('applied'); return project;
  }
  renameOperation(from: string, to: string): void { this.driver.rename(from, to); }
  retireScenario(title: string): void { this.driver.retireScenario(title); }
  addHandwrittenCheckLogic(name: string, text: string): Promise<void> { return this.driver.editCheck(name, text); }
  changeExpectedCheckOperator(_name: string, operator: string): void { this.driver.revise(this.driver.sourceText.replace('actual == expected', 'actual ' + operator + ' expected')); }
  async expectAcceptanceCall(text: string): Promise<void> { expect((await this.driver.calls('test/acceptance/shopping.test.ts')).join('\n')).toContain(text); }
  async expectNoGeneratedScenario(title: string): Promise<void> { expect(await this.driver.text('test/acceptance/shopping.test.ts')).not.toContain(title); }
  readScenario(title: string): Promise<void> { return this.driver.readSubject(title); }
  searchScenario(title: string): Promise<void> { return this.driver.searchSubject(title); }
  searchOperation(name: string): Promise<void> { return this.driver.searchSubject(name); }
  expectReadComplete(): void { expect(this.driver.read.problems).toEqual([]); expect(this.driver.read.coverage.complete).toBe(true); }
  expectReadFiles(paths: string[]): void { expect([...new Set(this.driver.read.artifacts.map(item => item.file.path))].sort()).toEqual([...paths].sort()); }
  expectCompleteSearch(): void { expect(this.driver.searched.problems).toEqual([]); expect(this.driver.searched.incoming.coverage.complete).toBe(true); expect(this.driver.searched.outgoing.coverage.complete).toBe(true); }
  expectOutgoingOperation(name: string): void { expect(this.driver.searched.outgoing.uses).toEqual(expect.arrayContaining([expect.objectContaining({ target: { kind: 'specified', id: this.driver.subject(name) } })])); }
  expectNoOutgoingOperation(name: string): void { expect(this.driver.searched.outgoing.uses.some(use => use.target.kind === 'specified' && use.target.id === this.driver.subject(name))).toBe(false); }
  expectIncomingScenario(title: string): void { expect(this.driver.searched.incoming.uses).toEqual(expect.arrayContaining([expect.objectContaining({ target: { kind: 'specified', id: this.driver.subject(title) } })])); }
  expectReadProblem(code: string): void { expect(this.driver.read.problems.map(item => item.code)).toContain(code); expect(this.driver.read.coverage.complete).toBe(false); }
  async expectReadProblemAt(code: string, file: string, text: string): Promise<void> {
    this.expectReadProblem(code); const bytes = await this.driver.text(file);
    expect(this.driver.read.problems.some(problem => problem.code === code && problem.at.kind === 'dependency'
      && problem.at.path[1] === file && typeof problem.at.path[2] === 'number' && typeof problem.at.path[3] === 'number'
      && bytes.slice(problem.at.path[2], problem.at.path[2] + problem.at.path[3]) === text)).toBe(true);
  }
  expectSearchProblem(code: string): void { expect(this.driver.searched.problems.map(item => item.code)).toContain(code); expect(this.driver.searched.outgoing.coverage.complete).toBe(false); }
  editScenarioExpectedQuantity(value: number): Promise<void> { return this.driver.changeExpected(value); }
  emptyScenarioCallback(): Promise<void> { return this.driver.emptyCallback(); }
  aliasAndFormatScenario(): Promise<void> { return this.driver.aliasFixture(); }
  redirectScenarioFixture(): Promise<void> { return this.driver.redirectFixture(); }
  failRealWriteTo(path: string): void { this.driver.denyWrite(path); }
  async expectStoppedWithPartialFiles(): Promise<void> {
    expect(this.driver.written.receipt?.status).toBe('stopped'); expect(this.driver.written.problems.length).toBeGreaterThan(0);
    expect(this.driver.written.artifacts).toBeUndefined(); expect(await this.driver.partialFilesAgree()).toBe(true);
  }
  implementActualBasketRuntimeExcept(name: string): Promise<void> { return this.driver.implementBasketExcept(name); }
  expectNoImplementationObligation(name: string): void { expect(this.driver.written.problems, JSON.stringify(this.driver.written.problems)).toEqual([]); expect(this.driver.written.obligations?.filter(item => item.code === 'implementation-required' && item.message.includes(name))).toEqual([]); }
  expectThrownMessage(message: string): void { expect(this.driver.nativeResult?.success).toBe(false); expect(this.driver.nativeResult!.testResults.flatMap(file => file.assertionResults).flatMap(test => test.failureMessages).join('\n')).toContain(message); }
  denyProcessNetworkAndRuntimeCalls(): void { this.driver.denyReads('runtime'); }
  expectNoForbiddenEffects(): void { expect(this.driver.forbidden).toEqual([]); }
  static async importedOperationContract(): Promise<AcceptanceGenerationExamples> {
    const project = await this.fromSource('examples {}'); project.driver.provider(); return project;
  }
  expectNoVendoredProviderDeclarations(): void {
    expect(this.driver.written.problems).toEqual([]);
    const ids = new Set(this.driver.current.baseline.elements.filter(item => item.address.module === 'library').map(item => item.id));
    expect(this.driver.written.artifacts!.filter(item => ids.has(item.specId))).toEqual([]);
  }
  connectRealBasketDriver(): Promise<void> { return this.driver.basket(); }
  runGeneratedVitest(): Promise<void> { return this.driver.run(); }
  changeBasketObservationTo(value: number): Promise<void> { return this.driver.observedQuantity(value); }
  disableApplicationAddBook(): Promise<void> { return this.driver.noAddition(); }
  async mapApplicationFunction(name: string, file: string, nativeName: string): Promise<void> {
    await this.driver.nativeDependencies(); this.driver.application(name, file, nativeName);
  }
  file(path: string, text: string): Promise<void> { return this.driver.file(path, text); }
  async expectVisibleExampleValues(arguments_: number[], expected: number): Promise<void> {
    const text = await this.driver.text('test/acceptance/arithmetic.test.ts');
    expect(text).toContain('multiply(' + arguments_.join(', ') + ')');
    expect(text).toContain('expectData(await multiply(' + arguments_.join(', ') + '), ' + expected + ')');
  }
  expectObligation(code: string, text: string): void {
    expect(this.driver.written.obligations).toEqual(expect.arrayContaining([expect.objectContaining({ code, message: expect.stringContaining(text) })]));
  }
  expectVerificationFailure(text: string): void {
    expect(this.driver.nativeResult?.success).toBe(false);
    expect(this.driver.nativeResult!.testResults.flatMap(file => file.assertionResults).flatMap(test => test.failureMessages).join('\n')).toContain(text);
  }
  expectNoSkippedOrTodoTests(): void {
    expect(this.driver.nativeResult!.testResults.flatMap(file => file.assertionResults).map(test => test.status)).toEqual(['failed']);
  }
  async connectBasketIdentityDriver(): Promise<void> {
    await this.driver.operations(`import { appendFileSync } from 'node:fs';
export interface Basket { id: string }
export class ManualDriver {
  private remembered?: Basket;
  private count = 0;
  open(): Basket { return this.remembered = { id: 'basket-one' }; }
  add(basket: Basket, title: string): void { if (basket !== this.remembered) throw Error('Wrong actual basket'); this.count++; }
  quantity(basket: Basket): number { appendFileSync('events.jsonl', JSON.stringify({ same: basket === this.remembered }) + '\\n'); return this.count; }
}`, ['Basket']);
  }
  async expectActualDriverUsedSameBasket(): Promise<void> { expect(await this.driver.eventValues()).toEqual([{ same: true }]); }
  async connectAsynchronousBasketDriver(): Promise<void> {
    await this.driver.basket();
    const text = await this.driver.text('test/driver/basket.ts');
    await this.driver.file('test/driver/basket.ts', `import { appendFileSync } from 'node:fs';\n` + text
      .replace('bookIsAvailable(title: string): void {', 'async bookIsAvailable(title: string): Promise<void> { await new Promise(resolve => setTimeout(resolve, 5)); appendFileSync("events.jsonl", JSON.stringify("available") + "\\n");')
      .replace('startWithEmptyBasket(): void {', 'async startWithEmptyBasket(): Promise<void> { await Promise.resolve(); appendFileSync("events.jsonl", JSON.stringify("empty") + "\\n");')
      .replace('addBook(title: string): void {', 'async addBook(title: string): Promise<void> { await Promise.resolve(); appendFileSync("events.jsonl", JSON.stringify("add") + "\\n");')
      .replace('bookQuantity(title: string): number {', 'bookQuantity(title: string): number { appendFileSync("events.jsonl", JSON.stringify("quantity") + "\\n");'));
  }
  async expectActualApplicationOrder(values: unknown[]): Promise<void> { expect(await this.driver.eventValues()).toEqual(values); }
  static nestedBasketContract(book: { title: string; quantity: number }): Promise<AcceptanceGenerationExamples> {
    return this.fromSource(`type Book { title: Text\nquantity: Number }\nexamples { action start() returns Nothing {}\nobservation contents() returns List<Book>\nscenario "basket contents" { when start()\nthen contents() == [Book { title: ${JSON.stringify(book.title)}, quantity: ${book.quantity} }] } }`);
  }
  connectNestedBasketDriver(book: { title: string; quantity: number }): Promise<void> {
    return this.driver.operations(`export interface Book { title: string; quantity: number }\nexport class ManualDriver { contents(): Book[] { return [${JSON.stringify(book)}]; } }`, ['Book']);
  }
  static structuralBooleanContract(): Promise<AcceptanceGenerationExamples> {
    return this.fromSource('type Book { title: Text }\nexamples { action start() returns Nothing {}\nobservation left() returns Book\nobservation right() returns Book\nobservation flag() returns Boolean\nscenario "equivalent records and flag" { when start()\nthen (left() == right()) and flag() } }');
  }
  connectEquivalentIndependentRecords(): Promise<void> {
    return this.driver.operations('export interface Book { title: string }\nexport class ManualDriver { left(): Book { return { title: "Dune" }; } right(): Book { return { title: "Dune" }; } flag(): boolean { return true; } }', ['Book']);
  }
  async changeObservedFlag(value: boolean): Promise<void> { await this.driver.file('test/driver/manual.ts', (await this.driver.text('test/driver/manual.ts')).replace('return true;', 'return ' + value + ';')); }
  expectTestsFailed(titles: string[]): void {
    expect(this.driver.nativeResult?.success).toBe(false);
    expect(this.driver.nativeResult!.testResults.flatMap(file => file.assertionResults).filter(test => test.status === 'failed').map(test => test.title)).toEqual(titles);
  }
  static shortCircuitContract(expression: string): Promise<AcceptanceGenerationExamples> { return this.fromSource('examples { action start() returns Nothing {}\nobservation dangerous() returns Boolean\nscenario "short circuit" { when start()\nthen ' + expression + ' } }'); }
  connectDangerousObservationThatThrows(): Promise<void> { return this.driver.operations('export class ManualDriver { dangerous(): boolean { throw Error("Dangerous observation ran"); } }'); }
  expectDangerousObservationNotInvoked(): void { this.expectTestsPassed(['short circuit']); }
  async connectTitleApplication(): Promise<void> {
    await this.mapApplicationFunction('normalize', 'titles.ts', 'normalize');
    await this.mapApplicationFunction('persist', 'titles.ts', 'persist');
    await this.file('titles.ts', `import { appendFileSync } from 'node:fs';\nexport function normalize(title: string): string { return title.toUpperCase(); }\nexport function persist(title: string): void { appendFileSync('events.jsonl', JSON.stringify(title) + '\\n'); }`);
  }
  async expectActuallyPersisted(title: string): Promise<void> { expect(await this.driver.eventValues()).toEqual([title]); }
  static sharedDataFixtureContract(): Promise<AcceptanceGenerationExamples> {
    return this.fromSource(`examples { fixture titles: List<Text> = []
action add(titles: List<Text>, title: Text) returns Nothing
observation count(titles: List<Text>) returns Number
scenario "first starts empty" { when add(titles, "Dune")
then count(titles) == 1 }
scenario "second starts empty" { when add(titles, "Foundation")
then count(titles) == 1 }
}`);
  }
  connectDriverThatMutatesItsInput(): Promise<void> {
    return this.driver.operations(`import { randomUUID } from 'node:crypto'; import { appendFileSync } from 'node:fs';
export class ManualDriver {
  readonly instance = randomUUID();
  add(titles: string[], title: string): void { appendFileSync('events.jsonl', JSON.stringify({ instance: this.instance, before: titles.length }) + '\\n'); titles.push(title); }
  count(titles: string[]): number { return titles.length; }
}`);
  }
  async runGeneratedVitestConcurrently(): Promise<void> {
    expect(this.driver.written.problems).toEqual([]);
    await this.driver.file('test/acceptance/books.test.ts', (await this.driver.text('test/acceptance/books.test.ts')).replace(/^test\(/gm, 'test.concurrent('));
    await this.driver.run();
  }
  async expectIndependentDriverInstances(): Promise<void> {
    const events = await this.driver.eventValues() as { instance: string; before: number }[];
    expect(events.map(item => item.before)).toEqual([0, 0]); expect(new Set(events.map(item => item.instance)).size).toBe(2);
  }
  static explicitOptionalDataContract(): Promise<AcceptanceGenerationExamples> {
    return this.fromSource(`type Book { title: Text\nnote: Text? }
examples { fixture book: Book = { title: "Dune" }
action inspect(book: Book, tag: Text) returns Nothing
observation keys(book: Book) returns List<Text>
scenario "optional remains absent" { when inspect(book, "catalog")
then keys(book) == ["title"] } }`);
  }
  connectDriverObservingActualOwnKeys(): Promise<void> {
    return this.driver.operations(`import { appendFileSync } from 'node:fs'; export interface Book { title: string; note?: string }
export class ManualDriver {
  inspect(book: Book, tag: string): void { if (tag !== 'catalog') throw Error('Wrong actual argument'); appendFileSync('events.jsonl', JSON.stringify(Object.keys(book)) + '\\n'); }
  keys(book: Book): string[] { return Object.keys(book); }
}`, ['Book']);
  }
  async expectActualInputKeys(keys: string[]): Promise<void> { expect(await this.driver.eventValues()).toEqual([keys]); }
  async mapApplicationReturning(name: string, body: string, declarations = ''): Promise<void> {
    await this.driver.nativeApplication(name, body, declarations);
    if (name === 'count') this.driver.observe('Object.is((application.observed as { value: number }).value, -0)');
  }
  async replaceApplicationBody(name: string, body: string): Promise<void> {
    const text = await this.driver.text('application.ts'), start = text.indexOf('export function ' + name + '(');
    if (start < 0) throw Error('Application function was not arranged.');
    await this.driver.file('application.ts', text.slice(0, start) + 'export function ' + name + '() { return observed = (() => { ' + body + ' })(); }');
  }
  async expectApplicationRetainedNegativeZero(): Promise<void> { expect(JSON.parse(await this.driver.text('observed.json'))).toBe(true); }
  expectComparisonDataFailure(title: string, path: string, reason: string): void {
    const test = this.driver.nativeResult!.testResults.flatMap(file => file.assertionResults).find(test => test.title === title);
    expect(test?.status).toBe('failed'); const messages = test!.failureMessages.join('\n');
    expect(messages).toContain('Unsupported comparison data'); expect(messages).toContain('at ' + path + ': ' + reason);
  }
  expectComparisonDataFailures(titles: string[], path: string, reason: string): void { for (const title of titles) this.expectComparisonDataFailure(title, path, reason); }
  expectNoRuntimeFailureMessage(text: string): void { expect(this.driver.nativeResult!.testResults.flatMap(file => file.assertionResults).flatMap(test => test.failureMessages).join('\n')).not.toContain(text); }
  expectRecordDifference(title: string, key: string, value: string | number): void {
    this.expectTestsFailed([title]); const message = this.driver.nativeResult!.testResults.flatMap(file => file.assertionResults).flatMap(test => test.failureMessages).join('\n');
    expect(message).toContain('AssertionError'); expect(message).toContain(key); expect(message).toContain(String(value));
  }
  async mapApplicationFunctions(file: string, names: string[]): Promise<void> { await this.driver.nativeDependencies(); for (const name of names) this.driver.application(name, file, name); }
  observeApplicationEvents(): void { this.driver.observe('application.events'); }
  async expectActualApplicationEvents(events: string[]): Promise<void> { expect(JSON.parse(await this.driver.text('observed.json'))).toEqual(events); }
  establishGroupIdentities(ids: string[]): void { this.driver.identify(['examples'], ids); }
  establishOperationIdentities(ids: string[]): void { this.driver.identify(['setup', 'action', 'observation', 'check'], ids); }
  expectMappingProblem(code: string): void { expect(this.driver.written.problems.map(problem => problem.code)).toContain(code); expect(this.driver.written.receipt).toBeUndefined(); }
  expectAcceptanceFiles(paths: string[]): void {
    expect(this.driver.written.problems).toEqual([]);
    expect(this.driver.written.receipt?.outcomes.filter(item => item.change.kind === 'write' && item.change.path.includes('/acceptance/')).map(item => item.change.kind === 'write' ? item.change.path : '')).toEqual(paths);
  }
  replaceDriverStub(name: string, body: string): Promise<void> { return this.driver.replaceStub(name, body); }
  expectDistinctOperationTargets(first: string, second: string): void {
    const selectors = (id: string) => this.driver.written.artifacts!.filter(item => item.specId === id).map(item => item.locator.value);
    expect(selectors(first)).toHaveLength(2); expect(selectors(second)).toHaveLength(2);
    expect(selectors(first)).not.toEqual(selectors(second));
  }
  expectTestsPassed(titles: string[]): void {
    expect(this.driver.nativeResult?.success).toBe(true);
    expect(this.driver.nativeResult?.testResults.flatMap(file => file.assertionResults).map(test => ({ title: test.title, status: test.status })))
      .toEqual(titles.map(title => ({ title, status: 'passed' })));
  }
  expectAssertionFailure(values: { expected: number; actual: number }): void {
    expect(this.driver.nativeResult?.success).toBe(false);
    const tests = this.driver.nativeResult!.testResults.flatMap(file => file.assertionResults);
    expect(tests.filter(test => test.status === 'failed')).toHaveLength(1);
    const actual = values.actual === 0 ? '+0' : String(values.actual);
    expect(tests.flatMap(test => test.failureMessages).join('\n')).toContain('expected ' + actual + ' to strictly equal ' + values.expected);
  }
  async expectAcceptanceSteps(expected: string[]): Promise<void> {
    expect(this.driver.written.problems).toEqual([]);
    expect(this.driver.written.receipt?.status).toBe('applied');
    expect(await this.driver.calls('test/acceptance/shopping.test.ts')).toEqual(expected);
  }
  async expectNoAcceptanceMechanics(values: string[]): Promise<void> {
    const text = await this.driver.text('test/acceptance/shopping.test.ts');
    for (const value of values) expect(text).not.toContain(value);
  }
  async expectGeneratedCheck(name: string, meaning: { observes: string; expectedParameter: string }): Promise<void> {
    const text = await this.driver.text('test/dsl/shopping.ts');
    expect(text).toContain(name);
    expect(text).toContain('this.driver.' + meaning.observes + '(title)');
    expect(text).toContain(meaning.expectedParameter);
    expect(text).toContain('expectData(actual, ' + meaning.expectedParameter + ')');
    expect(await this.driver.text('test/dsl/comparison.ts')).toContain('toStrictEqual');
  }
}
