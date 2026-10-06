import { promises as fs } from 'node:fs';
import { expect } from 'vitest';
import { PythonNativeLifetimeDriver } from '../../../driver/project/python/python-native-lifetime.js';

export class PythonNativeLifetime {
  private static readonly examples: PythonNativeLifetime[] = [];
  private constructor(private readonly driver: PythonNativeLifetimeDriver) {}
  static async connect(): Promise<PythonNativeLifetime> {
    const example = new PythonNativeLifetime(new PythonNativeLifetimeDriver()); this.examples.push(example);
    await example.driver.initialize(); await example.driver.installFixture(); return example;
  }
  static async dispose(): Promise<void> { for (const p of this.examples.splice(0)) await p.driver.dispose(); }
  installCatalog(): Promise<void> { return this.driver.installCatalog(); }
  replaceCatalog(): Promise<void> { return this.driver.changeCatalog(); }
  capture(): Promise<void> { return this.driver.capture(); }
  searchCaptured(id: string): Promise<void> { return this.driver.searchCapture(id); }
  planRename(): Promise<void> { return this.driver.planStoreRename(); }
  applyPlan(): Promise<void> { return this.driver.applyPlan(); }
  generatedStore(): Promise<void> { return this.driver.generatedStore(); }
  searchGeneratedSave(): Promise<void> { return this.driver.searchCapture(this.driver.id('save')); }
  supplySameCapture(text: string): void { this.driver.replaceCapturedCaller(text); }
  searchWhileCatalogChanges(): Promise<void> { return this.driver.observeQuery('StoreGame', true); }
  installExecutionCanaries(): Promise<void> { return this.driver.executionCanaries(); }
  inspectWithProcessObservation(): Promise<void> { return this.driver.observeQuery('StoreGame.save', false, true); }
  expectCoverageComplete(): void { expect(this.driver.searchResult.problems, JSON.stringify(this.driver.searchResult)).toEqual([]); expect(this.driver.searchResult.incoming.coverage.complete).toBe(true); }
  expectNoIncomingCaller(): void { expect(this.driver.searchResult.incoming.uses.filter(use => (use.at.value as { file: string }).file === 'src/caller.py')).toEqual([]); }
  expectChangedCatalogRefused(): void {
    const result = this.driver.searchResult;
    expect(result.incoming.coverage.complete, JSON.stringify(result)).toBe(false);
    expect(result.outgoing.coverage.complete).toBe(false); expect(result.definitions).toEqual([]);
    expect(result.incoming.uses).toEqual([]); expect(result.outgoing.uses).toEqual([]);
    expect(result.problems.some(problem => problem.code === 'native-input-changed' && JSON.stringify(problem.at).includes('catalog')), JSON.stringify(result.problems)).toBe(true);
  }
  async expectActualQueryFinished(): Promise<void> {
    const trace = this.driver.process;
    expect(trace).toMatchObject({ started: true, answered: true, closed: true, changed: true, mutationError: '' });
    const facts = JSON.parse(trace.output) as { declarations: { name?: string; declaration: { name: string }[] }[] };
    expect(facts.declarations.some(item => item.declaration.some(part => part.name === 'StoreGame'))).toBe(true);
    await expect(fs.stat(trace.scratch)).rejects.toMatchObject({ code: 'ENOENT' });
  }
  async expectStoppedWithoutEffects(): Promise<void> {
    expect(this.driver.receipt.status, JSON.stringify(this.driver.receipt)).toBe('stopped');
    expect(this.driver.receipt.problems.map(problem => problem.code)).toContain('stale-project');
    expect(this.driver.receipt.outcomes.filter(outcome => outcome.state === 'applied')).toEqual([]);
    const current = await this.driver.context.readSnapshot();
    expect(current.files).toEqual(this.driver.before.files);
  }
  expectCurrentCaller(token: string): void {
    this.expectCoverageComplete(); const file = this.driver.snapshot.files.find(file => file.path === 'src/caller.py')!;
    expect(this.driver.snapshot).toBe(this.driver.capturedIdentity); expect(file.version).toBe(this.driver.capturedVersion);
    const text = Buffer.from(file.bytes).toString('utf8'), start = text.indexOf('game.' + token) + 'game.'.length;
    expect(this.driver.searchResult.incoming.uses.some(use => { const at = use.at.value as { file: string; start: number; end: number };
      return use.target.kind === 'project' && at.file === 'src/caller.py' && at.start === start && text.slice(at.start, at.end) === token;
    }), JSON.stringify(this.driver.searchResult)).toBe(true);
    expect(this.driver.previousSearch.incoming.uses.filter(use => (use.at.value as { file: string }).file === 'src/caller.py')).toEqual([]);
  }
  async expectNoExecution(): Promise<void> {
    this.expectCoverageComplete(); expect(this.driver.queryAudit).toBe(true); expect(this.driver.process).toMatchObject({ started: true, answered: true, closed: true });
    expect(this.driver.searchResult.definitions.map(item => item.value)).toContainEqual({ file: 'src/store/contracts.py', declaration: [{ kind: 'class', name: 'StoreGame' }, { kind: 'method', name: 'save' }] });
    for (const path of [...this.driver.canaries, this.driver.nestedMarker]) await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  }
}
