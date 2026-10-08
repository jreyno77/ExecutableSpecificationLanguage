import { createHash } from 'node:crypto';
import { expect, onTestFinished } from 'vitest';
import type { ProjectRead, ProjectSearch } from '../../../../src/index.js';
import { PythonInspectionUnitDriver } from '../../../driver/project/python/python-inspection-unit.js';

export class PythonInspectionUnit {
  private constructor(readonly driver: PythonInspectionUnitDriver) {}
  static async connect(): Promise<PythonInspectionUnit> {
    const driver = new PythonInspectionUnitDriver(); onTestFinished(() => driver.dispose(), 30_000);
    await driver.initialize(); return new PythonInspectionUnit(driver);
  }
  read() { return this.driver.read(); }
  search() { return this.driver.search(); }
  expectRead(result: ProjectRead, text = 'class StoreGame:\n    pass\n') {
    expect(result.problems).toEqual([]); expect(result.coverage.complete).toBe(true);
    expect(result.artifacts.map(item => Buffer.from(item.file.bytes).toString())).toEqual([text]);
  }
  expectSearch(result: ProjectSearch) {
    expect(result.problems).toEqual([]); expect(result.incoming.coverage.complete).toBe(true);
    expect(result.definitions.map(at => at.value)).toEqual([{ file: 'src/store.py', declaration: [{ kind: 'class', name: 'StoreGame' }] }]);
  }
  expectAttempts(count: number) { expect(this.driver.attempts).toBe(count); }
  rememberNativeReads() { return this.driver.catalogHashes.length; }
  expectNativeBytesReadAfter(count: number) {
    const reads = this.driver.catalogHashes.slice(count); expect(reads.length).toBeGreaterThan(0);
    expect(reads.every(hash => hash === createHash('sha256').update('class Book: ...\n').digest('hex'))).toBe(true);
  }
  expectRefused(result: ProjectRead | ProjectSearch, code: string) {
    expect(result.problems.map(problem => problem.code), JSON.stringify(result)).toContain(code);
    if ('artifacts' in result) { expect(result.coverage.complete).toBe(false); expect(result.artifacts).toEqual([]); }
    else { expect(result.incoming.coverage.complete).toBe(false); expect(result.definitions).toEqual([]); expect(result.incoming.uses).toEqual([]); }
  }
  expectCleanupMutation() { expect(this.driver.cleanupChanged).toBe(true); expect(this.driver.scratchDisposed).toBe(true); }
  expectInspection(result: { value?: { declarations: readonly { target: { name: string } }[] }; problems: readonly unknown[] }) {
    expect(result.problems).toEqual([]); expect(result.value?.declarations.map(item => item.target.name)).toEqual(['StoreGame']);
  }
}
