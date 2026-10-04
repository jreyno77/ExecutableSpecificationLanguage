import { expect, onTestFinished } from 'vitest';
import { JavaAcceptanceDriver } from '../driver/java-acceptance.js';

export class JavaAcceptance {
  private remembered: {path:string;bytes:Uint8Array}[]=[];
  private constructor(private readonly driver: JavaAcceptanceDriver) { onTestFinished(() => driver.dispose()); }
  static async connect(): Promise<JavaAcceptance> { const driver = new JavaAcceptanceDriver(); const example = new JavaAcceptance(driver); await driver.prepare(); return example; }
  file(path: string, text: string): Promise<void> { return this.driver.file(path,text); }
  update(source: string): Promise<void> { return this.driver.update(source); }
  replaceText(path: string,before: string,after: string): Promise<void> { return this.driver.replaceText(path,before,after); }
  async rememberFiles(): Promise<void> { await this.driver.capture(); this.remembered=this.driver.snapshot.files.map(file=>({path:file.path,bytes:Uint8Array.from(file.bytes)})); }
  async expectFilesUnchanged(): Promise<void> { await this.driver.capture(); expect(this.driver.snapshot.files.map(file=>({path:file.path,bytes:Uint8Array.from(file.bytes)}))).toEqual(this.remembered); }
  expectApplied(): void { expect(this.driver.written.problems,JSON.stringify(this.driver.written.problems)).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied'); }
  readScenario(title: string): Promise<void> { return this.driver.readScenario(title); }
  searchOperation(name: string): Promise<void> { return this.driver.searchOperation(name); }
  corruptState(): Promise<void> { return this.driver.corruptState(); }
  expectScenarioFile(path: string,title: string): void {
    expect(this.driver.readResult.problems,JSON.stringify(this.driver.readResult.problems)).toEqual([]); expect(this.driver.readResult.coverage.complete).toBe(true);
    const actual=this.driver.readResult.artifacts; expect(actual).toHaveLength(1); expect(actual[0]!.file).toEqual(this.driver.snapshot.files.find(file=>file.path===path));
    expect(Buffer.from(actual[0]!.file.bytes).toString('utf8')).toContain('@org.junit.jupiter.api.DisplayName('+JSON.stringify(title)+')');
    expect(actual[0]!.at.format).toBe('java-symbol-1'); expect((actual[0]!.at.value as {member:{kind:string;parameters:unknown[]}}).member).toMatchObject({kind:'method',parameters:[]});
  }
  expectNativeOperationUse(path: string,call: string,token: string): void {
    const result=this.driver.searchResult; expect(result.problems,JSON.stringify(result.problems)).toEqual([]); expect(result.incoming.coverage.complete).toBe(true);
    const source=Buffer.from(this.driver.snapshot.files.find(file=>file.path===path)!.bytes).toString('utf8'),start=source.indexOf(call)+call.indexOf(token);
    expect(result.definitions).toHaveLength(2);
    expect(result.incoming.uses.some(use=>{const at=use.at.value as {file:string;start:number;length:number};return at.file===path&&at.start===start&&at.length===token.length;}),JSON.stringify(result)).toBe(true);
  }
  expectInvalidState(): void { expect(this.driver.readResult.problems.map(problem=>problem.code)).toContain('invalid-output-state'); expect(this.driver.readResult.coverage.complete).toBe(false); }
  removeFile(path: string): Promise<void> { return this.driver.removeFile(path); }
  selectDriver(path: string,type: string): void { this.driver.selectDriver(path,type); }
  mapOperation(name: string,path: string,type: string,method: string,parameters: string[]): void { this.driver.mapOperation(name,path,type,method,parameters); }
  partialBasket(): Promise<void> { return this.driver.partialBasket(); }
  implementQuantity(): Promise<void> { return this.driver.implementQuantity(); }
  expectSourceContains(path: string,text: string): void { expect(Buffer.from(this.driver.snapshot.files.find(file=>file.path===path)!.bytes).toString('utf8')).toContain(text); }
  selectFixture(path: string, type: string): void { this.driver.selectFixture(path,type); }
  resourceFixture(setupFails: boolean): Promise<void> { return this.driver.resourceFixture(setupFails); }
  expectRefused(code: string): void { expect(this.driver.written.problems.map(problem=>problem.code),JSON.stringify(this.driver.written.problems)).toContain(code); expect(this.driver.written.receipt).toBeUndefined(); expect(this.driver.written.artifacts).toBeUndefined(); }
  expectNoGeneratedFiles(): void { expect(this.driver.snapshot.files.filter(file=>file.path.includes('/acceptance/') || file.path.startsWith('.expec/outputs/'))).toEqual([]); }
  expectBodyDidNotRun(): void { expect(this.driver.native.stdout).not.toContain('TEST-BODY-RAN'); }
  source(source: string): void { this.driver.source(source); }
  generateContracts(): Promise<void> { return this.driver.contracts(); }
  generate(): Promise<void> { return this.driver.generate(); }
  driverMethods(source: string): Promise<void> { return this.driver.methods(source); }
  installBasket(copiesPerAdd = 1): Promise<void> { return this.driver.basket(copiesPerAdd); }
  runTests(): Promise<void> { return this.driver.run(); }
  expectGeneratedSteps(steps: string[]): void {
    expect(this.driver.written.problems, JSON.stringify(this.driver.written.problems)).toEqual([]);
    expect(this.driver.written.receipt?.status).toBe('applied');
    const tests = this.driver.snapshot.files.filter(file => file.path.includes('/acceptance/')).map(file => Buffer.from(file.bytes).toString('utf8')).join('\n');
    for (const step of steps) expect(tests).toContain(step);
    for (const layer of ['acceptance','dsl','driver']) expect(new Set(this.driver.snapshot.files.filter(file => file.path.includes('/' + layer + '/')).map(file => file.path.slice(0,file.path.indexOf('/' + layer + '/') + layer.length + 1))).size).toBe(1);
  }
  expectTests(passed: number, failed: number): void {
    expect(this.driver.outcomes.filter(result => result.status === 'passed').length, JSON.stringify(this.driver.native)).toBe(passed);
    expect(this.driver.outcomes.filter(result => result.status === 'failed').length).toBe(failed);
    expect(this.driver.outcomes.filter(result => result.status === 'skipped')).toEqual([]);
    expect(this.driver.native.code).toBe(failed ? 1 : 0);
  }
  expectQuantity(title: string, quantity: number): void { expect(this.driver.native.stdout).toContain('BASKET:' + title + ':' + quantity.toFixed(1)); }
  expectAssertion(expected: number, actual: number): void {
    expect(this.driver.outcomes.map(result => result.failure).join('\n')).toContain('expected: <' + expected.toFixed(1) + '> but was: <' + actual.toFixed(1) + '>');
  }
  expectNoFailure(text: string): void { expect(this.driver.outcomes.map(result=>result.failure).join('\n')).not.toContain(text); }
  expectFailure(text: string): void { expect(this.driver.outcomes.map(result => result.failure).join('\n')).toContain(text); }
  expectNativeOutput(text: string): void { expect(this.driver.native.stdout).toContain(text); }
  expectUnfinished(operation: string): void { expect(this.driver.outcomes.map(result => result.failure).join('\n')).toContain('Not implemented: ' + operation); }
}
