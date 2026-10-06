import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { expect } from 'vitest';
import { PythonCaptureBoundariesDriver } from '../../../driver/project/python/python-capture-boundaries.js';

export class PythonCaptureBoundaries {
  private static readonly cases: PythonCaptureBoundaries[] = [];
  private constructor(private readonly driver: PythonCaptureBoundariesDriver) {}
  static async connect(): Promise<PythonCaptureBoundaries> {
    const value = new PythonCaptureBoundaries(new PythonCaptureBoundariesDriver()); this.cases.push(value);
    await value.driver.initialize(); await value.driver.installFixture(); return value;
  }
  static async dispose(): Promise<void> { for (const value of this.cases.splice(0)) await value.driver.dispose(); }
  installCatalog(): Promise<void> { return this.driver.installCatalog(); }
  file(path: string, text: string): Promise<void> { return this.driver.file(path, text); }
  planRenameToShop(): Promise<void> { return this.driver.planClassRename(); }
  applyPlan(): Promise<void> { return this.driver.applyPlan(); }
  buildContracts(): Promise<void> { return this.driver.buildWithExcludedSource(); }
  async expectRenamedWithLibraryCaptured(): Promise<void> {
    const d = this.driver;
    expect(d.before.complete, JSON.stringify(d.before.problems)).toBe(true);
    expect(d.before.nativeInputs).toContainEqual({ uri: pathToFileURL(d.catalog).href,
      version: createHash('sha256').update(await fs.readFile(d.catalog)).digest('hex') });
    expect(d.before.files.some(file => file.path.startsWith('.venv/'))).toBe(false);
    expect(d.receipt.status, JSON.stringify(d.receipt)).toBe('applied');
    expect(d.receipt.problems).toEqual([]);
    const text = await d.text('src/store/contracts.py');
    expect(text).toContain('class Shop:'); expect(text).not.toContain('class StoreGame:');
    expect(text).toContain('from catalog import Book');
    expect(await d.text('.pytest_cache/noise')).toBe('new');
    expect((await d.context.readSnapshot()).complete).toBe(true);
  }
  async expectExcludedSourceRefused(path: string, original: string): Promise<void> {
    const d = this.driver;
    expect(d.refusedPlan.value).toBeUndefined();
    expect(d.written.receipt).toBeUndefined(); expect(d.written.artifacts).toBeUndefined();
    for (const result of [d.refusedPlan, d.written]) expect(result.problems).toContainEqual(expect.objectContaining({
      code: 'excluded-python-input', at: { kind: 'dependency', path: ['project', path] },
    }));
    const current = await d.context.readSnapshot();
    const bytes = (snapshot: typeof current) => snapshot.files.map(file => [file.path, file.version, Buffer.from(file.bytes).toString('hex')]);
    expect(bytes(current)).toEqual(bytes(d.before));
    expect(await d.text(path + '/hidden.py')).toBe(original);
  }
}
