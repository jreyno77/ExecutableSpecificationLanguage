import { expect } from 'vitest';
import { PythonTestChangesDriver } from '../driver/python-test-changes.js';

export class PythonTestChanges {
  private static readonly examples: PythonTestChanges[] = [];
  private constructor(private readonly driver: PythonTestChangesDriver) {}
  static async fromSource(source: string): Promise<PythonTestChanges> {
    const value = new PythonTestChanges(new PythonTestChangesDriver()); this.examples.push(value);
    await value.driver.initializeAcceptance(); value.driver.source(source); return value;
  }
  static async shopping(title: string, quantity: number): Promise<PythonTestChanges> {
    const value = await this.fromSource('examples {}'); value.driver.authorShopping(title, quantity); return value;
  }
  static async dispose(): Promise<void> { for (const value of this.examples.splice(0)) await value.driver.dispose(); }
  async generateTests(): Promise<void> { await this.driver.generate(); this.expectApplied(); }
  implementBasket(copies: number): Promise<void> { return this.driver.implementBasket(copies); }
  rememberSharedLayers(): Promise<void> { return this.driver.rememberFiles(true); }
  rememberAllFiles(): Promise<void> { return this.driver.rememberFiles(false); }
  async expectSharedLayersUnchanged(): Promise<void> { expect(await this.driver.actualFiles()).toEqual(this.driver.files); }
  expectAllFilesUnchanged(): Promise<void> { return this.expectSharedLayersUnchanged(); }
  addExample(title: string, expression: string): void { this.driver.add('example ' + JSON.stringify(title) + ': ' + expression); }
  addOperation(source: string): void { this.driver.add(source); }
  reviseSource(source: string): void { this.driver.reviseSource(source); }
  addNativeNeighbor(note: string): Promise<void> { return this.driver.addNativeNeighbor(note); }
  async expectNativeNeighborRetained(note: string): Promise<void> {
    expect(await this.driver.scenarioText()).toContain('def neighbor():\n    # ' + note + '\n    return "human code"\n');
  }
  renameScenario(from: string, to: string): void { this.driver.rename(from, to); }
  insertTests(): Promise<void> { return this.driver.revise('insert'); }
  updateTests(): Promise<void> { return this.driver.revise('update'); }
  deleteScenario(title: string): Promise<void> { return this.driver.remove(this.driver.identities.get(title)!); }
  deleteIdentifier(id: string): Promise<void> { return this.driver.remove(id); }
  requestCreation(): Promise<void> { return this.driver.generate(); }
  removeAcceptanceFile(): Promise<void> { return this.driver.removeAcceptanceFile(); }
  deleteOnlyExamplesGroup(): Promise<void> { return this.driver.remove(this.driver.group); }
  addScenarioComment(title: string, text: string): Promise<void> { return this.driver.addComment(title, text); }
  addNativeCallerOfExample(title: string): Promise<void> { return this.driver.addCaller(title); }
  addUnresolvedCallerOfExample(title: string): Promise<void> { return this.driver.addUnresolvedCaller(title); }
  async expectScenarioComment(text: string): Promise<void> { expect(await this.driver.scenarioText()).toContain('# ' + text); }
  async rememberDriverBody(name: string): Promise<void> { this.driver.body = await this.driver.driverBody(name); }
  async expectDriverBodyUnchanged(name: string): Promise<void> { this.expectApplied(); expect(await this.driver.driverBody(name)).toBe(this.driver.body); }
  expectApplied(): void {
    expect(this.driver.written.problems, JSON.stringify(this.driver.written.problems)).toEqual([]);
    expect(this.driver.written.receipt?.status).toBe('applied');
  }
  expectUnchanged(): void { expect(this.driver.written.problems).toEqual([]); expect(this.driver.written.receipt?.status).toBe('unchanged'); }
  expectProblem(code: string): void { expect(this.driver.written.problems.map(problem => problem.code), JSON.stringify(this.driver.written.problems)).toContain(code); expect(!!this.driver.written.receipt).toBe(false); }
  expectSameScenarioIdentity(title: string): void {
    this.expectApplied(); const scenario = [...this.driver.current.specification.inspection.query('scenario')].find(item => item.title.value === title)!;
    expect(this.driver.current.id(scenario.id)).toBe(this.driver.identities.get('a shopper can add an available book'));
  }
  expectNoScenarioAssociation(title: string): void { expect(this.driver.written.artifacts).toBeDefined(); expect(this.driver.written.artifacts!.some(item => item.specId === this.driver.identities.get(title))).toBe(false); }
  expectScenarioAssociated(title: string): void { expect(this.driver.written.artifacts?.some(item => item.specId === this.driver.identities.get(title))).toBe(true); }
  async expectAcceptanceFileAbsent(): Promise<void> { expect((await this.driver.context.readSnapshot()).files.some(file => file.path === 'test/acceptance/test_shopping.py')).toBe(false); }
  runTests(): Promise<void> { return this.driver.runObservedTests(); }
  expectPassed(titles: string[]): void {
    const expected = titles.map(title => 'test_' + title.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, ''));
    expect(this.driver.runtime.code, this.driver.runtime.text).toBe(0);
    expect([...this.driver.collected].sort()).toEqual(expected.sort());
    expect(this.driver.outcomes).toHaveLength(expected.length * 3);
    for (const name of expected) expect(this.driver.outcomes.filter(item => item.name === name).map(item => [item.phase, item.outcome]))
      .toEqual([['setup', 'passed'], ['call', 'passed'], ['teardown', 'passed']]);
  }
  expectUnimplemented(name: string): void {
    expect(this.driver.runtime.code, this.driver.runtime.text).toBe(1); expect(this.driver.runtime.text).toContain('Not implemented: shopping.' + name);
    expect(this.driver.outcomes.filter(item => item.phase === 'call' && item.outcome === 'failed')).toHaveLength(1);
  }
}
