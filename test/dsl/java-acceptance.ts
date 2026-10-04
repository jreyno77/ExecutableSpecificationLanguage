import { expect, onTestFinished } from 'vitest';
import { JavaAcceptanceDriver } from '../driver/java-acceptance.js';

export class JavaAcceptance {
  private remembered: {path:string;bytes:Uint8Array}[]=[];
  private constructor(private readonly driver: JavaAcceptanceDriver) { onTestFinished(() => driver.dispose()); }
  static async connect(): Promise<JavaAcceptance> { const driver = new JavaAcceptanceDriver(); const example = new JavaAcceptance(driver); await driver.prepare(); return example; }
  nameGroup(index:number|string,name:string,scenarioName?:string):void { this.driver.nameGroup(index,name,scenarioName); }
  nameScenario(title:string,name:string):void { this.driver.nameScenario(title,name); }
  deleteScenario(title:string):Promise<void> { return this.driver.deleteScenario(title); }
  deleteGroup(index:number):Promise<void> { return this.driver.deleteGroup(index); }
  expectScenarioNames(titles:string[]):void { expect(this.driver.scenarioSelectors().map(item=>item.title)).toEqual(titles); }
  expectFileAbsent(path:string):void { expect(this.driver.snapshot.files.some(file=>file.path===path)).toBe(false); }
  expectSourceAbsent(path:string,text:string):void { expect(Buffer.from(this.driver.snapshot.files.find(file=>file.path===path)!.bytes).toString('utf8')).not.toContain(text); }
  expectRememberedFilesExcept(paths:string[]):void {
    expect(this.driver.snapshot.files.filter(file=>!paths.includes(file.path)).map(file=>({path:file.path,bytes:Uint8Array.from(file.bytes)})))
      .toEqual(this.remembered.filter(file=>!paths.includes(file.path)));
  }
  expectRefusedAt(code:string,path:string,token:string):void {
    this.expectRefused(code); const text=Buffer.from(this.driver.snapshot.files.find(file=>file.path===path)!.bytes).toString('utf8');
    expect(this.driver.written.problems.some(problem=>problem.code===code&&problem.at.kind==='dependency'&&problem.at.path[1]===path
      &&typeof problem.at.path[2]==='number'&&typeof problem.at.path[3]==='number'&&text.slice(problem.at.path[2],problem.at.path[2]+problem.at.path[3])===token)).toBe(true);
  }
  expectSelectors(expected:{file:string;type:string;method:string;title:string}[]):void {
    expect(this.driver.scenarioSelectors()).toEqual(expected);
    for(const selector of expected) {
      const source=Buffer.from(this.driver.snapshot.files.find(file=>file.path===selector.file)!.bytes).toString('utf8');
      expect(source).toContain('@org.junit.jupiter.api.DisplayName('+JSON.stringify(selector.title)+')');
      expect(source).toContain('public void '+selector.method+'()');
    }
  }
  file(path: string, text: string): Promise<void> { return this.driver.file(path,text); }
  update(source: string): Promise<void> { return this.driver.update(source); }
  retireScenario(title:string,source:string):Promise<void> { return this.driver.update(source,[title]); }
  replaceText(path: string,before: string,after: string): Promise<void> { return this.driver.replaceText(path,before,after); }
  async rememberFiles(): Promise<void> { await this.driver.capture(); this.remembered=this.driver.snapshot.files.map(file=>({path:file.path,bytes:Uint8Array.from(file.bytes)})); }
  async expectFilesUnchanged(): Promise<void> { await this.driver.capture(); expect(this.driver.snapshot.files.map(file=>({path:file.path,bytes:Uint8Array.from(file.bytes)}))).toEqual(this.remembered); }
  expectObligation(code:string,message:string):void {
    expect(this.driver.written.obligations?.some(item=>item.code===code&&item.message.includes(message)&&item.at.kind==='source'),JSON.stringify(this.driver.written.obligations)).toBe(true);
  }
  expectUnchanged(): void { expect(this.driver.written.problems).toEqual([]); expect(this.driver.written.receipt?.status).toBe('unchanged'); expect(this.driver.written.artifacts?.length).toBeGreaterThan(0); }
  expectApplied(): void { expect(this.driver.written.problems,JSON.stringify(this.driver.written.problems)).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied'); }
  readScenario(title: string): Promise<void> { return this.driver.readScenario(title); }
  searchScenario(title:string):Promise<void> { return this.driver.searchScenario(title); }
  expectIncompleteRead(code:string,path:string):void {
    const result=this.driver.readResult; expect(result.problems.map(item=>item.code)).toContain(code); expect(result.coverage.complete).toBe(false);
    expect(result.artifacts[0]!.file).toEqual(this.driver.snapshot.files.find(file=>file.path===path));
  }
  expectIncompleteSearch(code:string):void {
    const result=this.driver.searchResult; expect(result.problems.map(item=>item.code)).toContain(code);
    expect(result.incoming.coverage.complete).toBe(false); expect(result.outgoing.coverage.complete).toBe(false);
  }
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
  library(module:string,source:string):void { this.driver.library(module,source); }
  workspaceModules(modules:string[]):void { this.driver.workspaceModules=modules; }
  source(source: string): void { this.driver.source(source); }
  generateContracts(): Promise<void> { return this.driver.contracts(); }
  generate(options: Record<string, unknown> = {}): Promise<void> { return this.driver.generate(options); }
  planGeneration(options: Record<string, unknown>): Promise<void> { return this.driver.planGeneration(options); }
  expectNoPlanAt(code: string, option: string): void {
    expect(this.driver.planned.value).toBeUndefined();
    expect(this.driver.planned.problems.some(item => item.code === code && item.at.kind === 'dependency'
      && item.at.path.join('/') === 'java/<options>/' + option), JSON.stringify(this.driver.planned.problems)).toBe(true);
  }
  expectRefusedOption(code: string, option: string): void {
    this.expectRefused(code);
    expect(this.driver.written.problems.some(item => item.code === code && item.at.kind === 'dependency'
      && item.at.path.join('/') === 'java/<options>/' + option), JSON.stringify(this.driver.written.problems)).toBe(true);
  }
  driverMethods(source: string): Promise<void> { return this.driver.methods(source); }
  installBasket(copiesPerAdd = 1): Promise<void> { return this.driver.basket(copiesPerAdd); }
  installBarrierBasket(): Promise<void> { return this.driver.barrierBasket(); }
  runTests(options: {parallel?:boolean;classes?:string[]}={}): Promise<void> { return this.driver.run(options.parallel,options.classes); }
  expectIndependentBaskets(): void {
    const initial=this.driver.native.stdout.split(/\r?\n/).filter(line=>/^DRIVER:\d+:INITIAL:Dune:/.test(line));
    expect(initial).toHaveLength(2); expect(initial.map(line=>line.split(':')[1]).sort()).toEqual(['1','2']);
    expect(initial.every(line=>line.endsWith(':INITIAL:Dune:0.0'))).toBe(true);
    const lines=this.driver.native.stdout.split(/\r?\n/).filter(line=>/^DRIVER:\d+:BASKET:Dune:/.test(line));
    expect(lines).toHaveLength(2); expect(lines.map(line=>line.split(':')[1]).sort()).toEqual(['1','2']);
    expect(lines.every(line=>line.endsWith(':BASKET:Dune:1.0'))).toBe(true);
  }
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
