import { expect, onTestFinished } from 'vitest';
import { KotlinImportsDriver } from '../driver/kotlin-native-imports.js';

export class KotlinImports {
  private constructor(private readonly driver: KotlinImportsDriver) { onTestFinished(() => driver.dispose()); }
  static async connect(): Promise<KotlinImports> { const driver = new KotlinImportsDriver(); await driver.prepare(); return new KotlinImports(driver); }
  source(text: string): void { this.driver.source(text); }
  map(name: string, native: string, as?: string): void {
    this.driver.options = { imports: [{ declaration: [name], name: native, ...as ? { as } : {} }] };
  }
  async expectMappingRefused(line: number, column: number): Promise<void> {
    await this.driver.inspectPlan();
    expect(this.driver.planned.value).toBeUndefined();
    expect(this.driver.planned.problems).toContainEqual(expect.objectContaining({ code: 'incompatible-native-import',
      at: expect.objectContaining({ kind: 'source', range: expect.objectContaining({ sourceId: 'main.expec',
        start: expect.objectContaining({ line, column }) }) }) }));
    expect(this.driver.after).toEqual(this.driver.before);
  }
  async buildContracts(): Promise<void> { await this.driver.build(); expect(this.driver.written.problems).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied'); }
  async compileConsumer(text: string): Promise<void> { await this.driver.compile(text); expect(this.driver.compiled.code, this.driver.compiled.stderr).toBe(0); }
  expectNoReplacement(name: string): void { expect(this.driver.files.has('src/main/kotlin/store/' + name + '.kt')).toBe(false); }
  nativeFile(path: string, text: string): Promise<void> { return this.driver.file(path, text); }
  async expectMappingAccepted(): Promise<void> { await this.driver.inspectPlan(); expect(this.driver.planned.problems).toEqual([]); expect(this.driver.planned.value).toBeDefined(); expect(this.driver.after).toEqual(this.driver.before); }
}
