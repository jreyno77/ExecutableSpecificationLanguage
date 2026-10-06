import { expect } from 'vitest';
import { PythonContractChangesDriver } from '../../../driver/project/python/python-contract-changes.js';

export class PythonContractChanges {
  private static readonly examples: PythonContractChanges[] = [];
  private constructor(private readonly driver: PythonContractChangesDriver) {}
  static async fromSource(source: string): Promise<PythonContractChanges> {
    const p = new PythonContractChanges(new PythonContractChangesDriver()); this.examples.push(p);
    await p.driver.initialize(); await p.driver.installFixture(); p.driver.source(source); return p;
  }
  static async dispose(): Promise<void> { for (const p of this.examples.splice(0)) await p.driver.dispose(); }
  async generate(): Promise<void> { await this.driver.generate(); this.expectApplied(); }
  requestCreation(): Promise<void> { return this.driver.generate(); }
  skipOutput(): void { this.driver.skipOutput(); }
  implementSave(body: string): Promise<void> { return this.driver.implementSave(body); }
  revise(source: string): void { this.driver.change(source); }
  renameClass(from: string, to: string, source: string): void { this.driver.renameClass(from, to, source); }
  insert(): Promise<void> { return this.driver.insert(); }
  update(): Promise<void> { return this.driver.update(); }
  deleteClass(name: string): Promise<void> { return this.driver.remove(this.driver.classes.get(name)!); }
  deleteIdentifier(id: string): Promise<void> { return this.driver.remove(id); }
  addAliasedCaller(name: string, alias: string): Promise<void> { return this.driver.addAliasedCaller(name, alias); }
  addMemberCaller(name: string, member: string): Promise<void> { return this.driver.addMemberCaller(name, member); }
  addNeighbor(note: string): Promise<void> { return this.driver.addNeighbor(note); }
  rememberFiles(): Promise<void> { return this.driver.rememberFiles(); }
  async expectFilesUnchanged(): Promise<void> { expect((await this.driver.context.readSnapshot()).files).toEqual(this.driver.files); }
  async expectSaveBody(body: string): Promise<void> { expect(await this.driver.text('src/store/contracts.py')).toContain('        ' + body + '\n'); }
  async expectAliasedCaller(name: string, alias: string): Promise<void> {
    expect(await this.driver.text('src/launcher.py')).toBe(this.driver.caller.replace(/from store\.contracts import \w+ as \w+/, 'from store.contracts import ' + name + ' as ' + alias));
  }
  async expectClassAbsent(name: string): Promise<void> { expect(await this.driver.text('src/store/contracts.py')).not.toContain('class ' + name + ':'); }
  async expectClassPresent(name: string): Promise<void> { expect(await this.driver.text('src/store/contracts.py')).toContain('class ' + name + ':'); }
  async expectNeighbor(note: string): Promise<void> { expect(await this.driver.text('src/store/contracts.py')).toContain('\ndef neighbor():\n    # ' + note + '\n    return "human code"\n'); }
  expectSameClassIdentity(name: string): void {
    const item = [...this.driver.current.specification.inspection.query('class')].find(item => item.name === name)!;
    expect(this.driver.current.id(item.id)).toBe(this.driver.classes.get(name)); this.expectOriginalClassIdentity(name);
  }
  expectOriginalClassIdentity(name: string): void {
    expect(this.driver.written.artifacts?.filter(item => item.specId === this.driver.classes.get(name))).toEqual([
      { specId: this.driver.classes.get(name), locator: { outputId: 'python', format: 'python-symbol-1', value: {
        file: 'src/store/contracts.py', declaration: [{ kind: 'class', name }] } } }]);
  }
  expectNoAssociation(name: string): void { expect(this.driver.written.artifacts?.some(item => item.specId === this.driver.classes.get(name))).toBe(false); }
  expectApplied(): void { expect(this.driver.written.problems).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied'); }
  expectUnchanged(): void { expect(this.driver.written.problems).toEqual([]); expect(this.driver.written.receipt?.status).toBe('unchanged'); }
  expectProblem(code: string): void {
    expect(this.driver.written.problems.map(item => item.code)).toContain(code); expect(this.driver.written.receipt).toBeUndefined();
    expect(this.driver.written.artifacts).toBeUndefined();
  }
  async expectProblemAt(code: string, file: string, token: string): Promise<void> {
    const start = (await this.driver.text(file)).lastIndexOf(token); expect(start).toBeGreaterThanOrEqual(0);
    expect(this.driver.written.problems.some(item => item.code === code && item.at.kind === 'dependency'
      && item.at.path.includes(file) && item.at.path.includes(start)), JSON.stringify(this.driver.written.problems)).toBe(true);
  }
  run(source: string): Promise<void> { return this.driver.run(source); }
  runAliasedCaller(title: string): Promise<void> { return this.run('from launcher import launch\nlaunch(' + JSON.stringify(title) + ')\n'); }
  expectOutput(text: string): void { expect(this.driver.runtime.code, this.driver.runtime.text).toBe(0); expect(this.driver.runtime.text.trim().split(/\r?\n/)).toEqual(text.split('\n')); }
}
