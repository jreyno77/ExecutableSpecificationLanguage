import { expect } from 'vitest';
import { PythonProjectDriver } from '../driver/python-project.js';

export class PythonInspection {
  private static readonly examples: PythonInspection[] = [];
  private constructor(readonly driver: PythonProjectDriver) {}
  static async connect(): Promise<PythonInspection> { const p = new PythonInspection(new PythonProjectDriver()); this.examples.push(p); await p.driver.initialize(); await p.driver.installFixture(); return p; }
  static async dispose(): Promise<void> { for (const p of this.examples.splice(0)) await p.driver.dispose(); }
  file(path: string, text: string): Promise<void> { return this.driver.file(path, text); }
  mapMethod(id: string, file: string, owner: string, method: string): void { this.driver.map(id, file, [{ kind: 'class', name: owner }, { kind: 'method', name: method }]); }
  read(id: string): Promise<void> { return this.driver.read(id); }
  search(id: string): Promise<void> { return this.driver.search(id); }
  expectWholeFile(path: string, text: string): void {
    expect(this.driver.readResult.artifacts.map(item => ({ path: item.file.path, text: Buffer.from(item.file.bytes).toString('utf8') })), JSON.stringify(this.driver.readResult)).toContainEqual({ path, text });
    expect(this.driver.readResult.coverage.complete, JSON.stringify(this.driver.readResult)).toBe(true);
  }
  expectIncomingUse(path: string, token: string): void {
    const files = this.driver.snapshot.files, uses = this.driver.searchResult.incoming.uses;
    expect(uses.some(use => { const at = use.at.value as { file: string; start: number; end: number }; return at.file === path
      && Buffer.from(files.find(file => file.path === path)!.bytes).toString('utf8').slice(at.start, at.end) === token; }), JSON.stringify(this.driver.searchResult)).toBe(true);
    expect(this.driver.searchResult.incoming.coverage.complete, JSON.stringify(this.driver.searchResult)).toBe(true);
  }
  expectNoIncomingUseFrom(path: string): void { expect(this.driver.searchResult.incoming.uses.some(use => (use.at.value as { file: string }).file === path)).toBe(false); }
  expectUnmodeledCaller(path: string, name: string): void {
    const caller = this.driver.searchResult.incoming.uses.find(use => (use.at.value as { file: string }).file === path)?.target;
    expect(caller?.kind).toBe('project'); expect(caller?.id).toContain(name);
  }
  expectInspectedFiles(paths: string[]): void {
    const scope = this.driver.searchResult.incoming.coverage.scope.flatMap(at => (at.value as { files: string[] }).files);
    expect([...scope].sort()).toEqual([...paths].sort());
  }
}
