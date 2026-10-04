import { expect, onTestFinished } from 'vitest';
import { KotlinInputsDriver } from '../driver/kotlin-inputs.js';

export class KotlinInputs {
  private constructor(private readonly driver: KotlinInputsDriver) { onTestFinished(() => driver.dispose()); }
  static async connect(): Promise<KotlinInputs> { const driver = new KotlinInputsDriver(), project = new KotlinInputs(driver); await driver.prepare(); return project; }
  capture(): Promise<void> { return this.driver.capture(); }
  replaceLibrary(): Promise<void> { return this.driver.replaceLibrary(); }
  async expectCapturedQueryRefused(): Promise<void> {
    await this.driver.searchCaptured();
    expect(this.driver.searchResult.problems.map(item => item.code)).toContain('native-input-changed');
    expect(this.driver.searchResult.definitions).toEqual([]);
    expect(this.driver.searchResult.incoming.uses).toEqual([]);
    expect(this.driver.searchResult.outgoing.uses).toEqual([]);
    expect(this.driver.searchResult.incoming.coverage.complete).toBe(false);
  }
  planTwoContracts(): Promise<void> { return this.driver.planTwoContracts(); }
  apply(): Promise<void> { return this.driver.apply(); }
  replaceLibraryAfterFirstWrite(): Promise<void> { return this.driver.apply(true); }
  expectStoppedWithPrefix(paths: string[]): void {
    expect(this.driver.receipt.status).toBe('stopped');
    expect(this.driver.receipt.problems.map(item => item.code)).toContain('stale-project');
    expect(this.driver.receipt.outcomes.filter(item => item.state === 'applied').map(item => item.change.kind === 'move' ? item.change.to : item.change.path)).toEqual(paths);
    for (const path of ['src/main/kotlin/store/First.kt', 'src/main/kotlin/store/Second.kt']) expect(this.driver.files.has(path)).toBe(paths.includes(path));
    expect([...this.driver.files.keys()].filter(path => path.startsWith('.expec/outputs/'))).toEqual([]);
  }
  changeUnrelatedCache(): Promise<void> { return this.driver.changeCache(); }
  async expectPlanApplied(): Promise<void> {
    await this.driver.apply(); expect(this.driver.receipt.problems).toEqual([]); expect(this.driver.receipt.status).toBe('applied');
    expect(this.driver.files.has('src/main/kotlin/store/First.kt')).toBe(true); expect(this.driver.files.has('src/main/kotlin/store/Second.kt')).toBe(true);
  }
  async expectCorruptSourceReturnedUnchanged(): Promise<void> {
    const expected = await this.driver.corruptSource(); await this.driver.capture(); await this.driver.readCaptured();
    expect(this.driver.readResult.coverage.complete).toBe(false);
    expect(this.driver.readResult.problems.map(item => item.code)).toContain('invalid-project-encoding');
    expect(this.driver.readResult.artifacts.map(item => item.file.bytes)).toEqual([expected]);
  }
}
