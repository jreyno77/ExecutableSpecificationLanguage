import { expect, onTestFinished } from 'vitest';
import { PythonInspectionSessionDriver } from '../../../driver/project/python/python-inspection-session.js';

export class PythonSessions {
  private constructor(private readonly driver: PythonInspectionSessionDriver) {}
  static async connect(): Promise<PythonSessions> {
    const driver = new PythonInspectionSessionDriver(); onTestFinished(() => driver.dispose(), 30_000);
    await driver.initializeAcceptance(); return new PythonSessions(driver);
  }
  file(path: string, text: string) { return this.driver.file(path, text); }
  mapMethod(id: string, path: string, owner: string, name: string) { this.driver.map(id, path, [{ kind: 'class', name: owner }, { kind: 'method', name }]); }
  openQuery() { return this.driver.openQuery(); }
  read(id: string) { return this.driver.read(id); }
  search(id: string) { return this.driver.search(id); }
  expectWholeFile(path: string, text: string) {
    expect(this.driver.readResult.problems).toEqual([]); expect(this.driver.readResult.coverage.complete).toBe(true);
    expect(this.driver.readResult.artifacts.map(item => ({ path: item.file.path, text: Buffer.from(item.file.bytes).toString() }))).toEqual([{ path, text }]);
  }
  expectDefinition(path: string, owner: string, name: string) {
    expect(this.driver.searchResult.definitions.map(at => at.value)).toEqual([{ file: path, declaration: [{ kind: 'class', name: owner }, { kind: 'method', name }] }]);
  }
  expectOnlyIncomingStatement(statement: string) {
    const uses = this.driver.searchResult.incoming.uses;
    expect(uses).toHaveLength(1);
    const at = uses[0]!.at.value as { file: string; start: number; end: number };
    const source = Buffer.from(this.driver.snapshot.files.find(file => file.path === at.file)!.bytes).toString();
    expect(source.split('\n').find(line => line.includes(source.slice(at.start, at.end)))?.trim()).toBe(statement);
    this.expectCompleteObservations();
  }
  expectCompleteObservations() {
    const result = this.driver.searchResult; expect(result.problems).toEqual([]);
    for (const direction of [result.incoming, result.outgoing]) { expect(direction.coverage.complete).toBe(true); expect(direction.unresolved).toEqual([]); }
  }
  expectActualInspections(expected: { base: number; integrity?: number }) {
    expect(this.driver.calls.every(call => call.closed && call.code === 0)).toBe(true);
    expect(this.driver.calls.filter(call => call.kind === 'base')).toHaveLength(expected.base);
    expect(this.driver.calls.filter(call => call.kind === 'integrity')).toHaveLength(expected.integrity ?? 0);
  }
  async expectKnownFilesUnchanged() { expect(await this.driver.knownHashes()).toEqual(this.driver.rememberedHashes); }
  rememberSearch() { this.driver.previousSearch = this.driver.searchResult; }
  expectNoIncomingUseFrom(path: string, remembered = false) {
    const result = remembered ? this.driver.previousSearch! : this.driver.searchResult;
    expect(result.incoming.uses.some(use => (use.at.value as { file: string }).file === path)).toBe(false);
  }
  replaceSuppliedBytesKeepingCaptureAndVersion(path: string, text: string) { this.driver.replaceSupplied(path, text); }
  expectSameCaptureAndVersion() {
    expect(this.driver.snapshot).toBe(this.driver.originalCapture);
    expect(this.driver.snapshot.files.find(file => file.path === 'src/caller.py')!.version).toBe(this.driver.originalVersion);
  }
  installCatalog(text: string) { return this.driver.installCatalog(text); }
  replaceCatalog(text: string) { return this.driver.replaceCatalog(text); }
  expectNativeChangeRefusedAt(path: string) {
    const result = this.driver.searchResult;
    expect(result.problems.some(problem => problem.code === 'native-input-changed' && JSON.stringify(problem.at).replaceAll('\\\\', '/').includes(path))).toBe(true);
    expect(result.incoming.coverage.complete).toBe(false); expect(result.outgoing.coverage.complete).toBe(false);
    expect(result.definitions).toEqual([]); expect(result.incoming.uses).toEqual([]); expect(result.outgoing.uses).toEqual([]);
  }
  aShopperCanAddAnAvailableBook(title: string, quantity: number) { this.driver.authorShopping(title, quantity); }
  async generateTests() {
    await this.driver.generate(); expect(this.driver.written.problems).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied');
  }
  openScenarioOutput() { return this.driver.openScenario(); }
  readScenario() { return this.driver.readScenario(); }
  searchScenario() { return this.driver.searchScenario(); }
  expectCompleteScenarioRead(path: string) {
    expect(this.driver.scenarioRead.problems).toEqual([]); expect(this.driver.scenarioRead.coverage.complete).toBe(true);
    expect(this.driver.scenarioRead.artifacts.map(item => item.file.path)).toContain(path);
  }
  expectCompleteScenarioSearch() { this.expectCompleteObservations(); expect(this.driver.searchResult.definitions.length).toBeGreaterThan(0); }
  changeGeneratedQuantity(quantity: number) { return this.driver.changeGeneratedQuantity(quantity); }
  expectScenarioProblem(code: string, path: string) {
    const result = this.driver.scenarioRead;
    expect(result.problems.some(problem => problem.code === code && problem.at.kind === 'dependency' && problem.at.path.includes(path)), JSON.stringify(result)).toBe(true);
    expect(result.coverage.complete).toBe(false);
  }
  async expectOnlyScenarioChanged() {
    const retain = (file: { path: string }) => file.path !== 'test/acceptance/test_shopping.py';
    expect((await this.driver.knownHashes()).filter(retain)).toEqual(this.driver.rememberedHashes.filter(retain));
  }
}