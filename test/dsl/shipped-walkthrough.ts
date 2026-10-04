import { expect, onTestFinished } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { ShippedWalkthroughDriver } from '../driver/shipped-walkthrough.js';

export class ShippedWalkthrough {
  private constructor(private readonly driver: ShippedWalkthroughDriver) {}
  static async install(walkthrough: 'shopping' | 'store-design' = 'shopping'): Promise<ShippedWalkthrough> {
    const driver = new ShippedWalkthroughDriver(); onTestFinished(() => driver.package.dispose());
    await driver.prepare(walkthrough); return new ShippedWalkthrough(driver);
  }
  expectDocumentedShoppingFiles(): void {
    expect([...this.driver.files.keys()], 'The installed README must contain the actual copyable shopping files.').toEqual([
      'main.expec', 'expec.json', 'game/tsconfig.json', 'game/src/basket.ts', 'game/test/driver/shopping.ts',
    ]);
  }
  copySpecification(): Promise<void> { return this.driver.copy(['main.expec', 'expec.json']); }
  expectDocumentedDesignFiles(): void { expect([...this.driver.files.keys()]).toEqual(['main.expec', 'expec.json']); }
  createDocumentProject(): Promise<void> { return this.driver.createConnectedDirectory(); }
  async expectDocumentedContract(owner: string, operation: string, input: string, result: string): Promise<void> {
    const markdown = await this.driver.text('game/docs/' + owner + '.md');
    expect(markdown).toContain(`capability ${operation}(snapshot: ${input}) returns ${result}`);
    expect(markdown).toContain('Statically checked specification. Runtime behavior is not verified by this document.');
    const diagram = await this.driver.nativeDesign(), consumer = diagram.shapes.find(shape => shape.label.endsWith('\n' + owner)),
      data = diagram.shapes.find(shape => shape.label.endsWith('\n' + input));
    expect(consumer).toBeDefined(); expect(data).toBeDefined();
    expect(consumer!.methods).toContainEqual(expect.objectContaining({ name: `${operation}(snapshot: ${input})`, return: result }));
    expect(diagram.connections).toContainEqual(expect.objectContaining({ src: data!.id, dst: consumer!.id,
      srcArrow: 'none', dstArrow: 'triangle', label: `${operation}.snapshot: ${input}` }));
    expect(diagram.connections).toHaveLength(1);
    expect(diagram.connections.every(edge => !edge.srcArrow.includes('diamond') && !edge.dstArrow.includes('diamond'))).toBe(true);
    expect(diagram.shapes.some(shape => shape.label.includes('Dependencies and fields do not imply ownership or runtime calls.'))).toBe(true);
    const svg = new DOMParser().parseFromString(await this.driver.text('game/design/structure.svg'), 'image/svg+xml');
    expect(svg.documentElement?.localName).toBe('svg');
    const labels = [...svg.getElementsByTagName('text')].map(element => element.textContent).join('\n');
    expect(labels).toContain(owner); expect(labels).toContain(input); expect(labels).toContain(operation);
    expect(this.driver.report.stages.some(stage => stage.name === 'execution')).toBe(false);
  }
  async command(args: string[]): Promise<void> { await this.driver.command(args); }
  expectSuccess(): void { expect(this.driver.result.code, JSON.stringify({ status: this.driver.report.status, problems: this.driver.report.problems }) + this.driver.result.stderr).toBe(0); }
  async configureDocumentedNativeProject(): Promise<void> { await this.driver.copy(['game/tsconfig.json']); }
  async expectReadableSteps(steps: string[]): Promise<void> {
    const source = await this.driver.text('game/test/acceptance/shopping.test.ts');
    for (const step of steps) expect(source).toContain(step);
    expect(await this.driver.text('game/test/driver/shopping.ts')).toContain('Not implemented');
  }
  async implementBasket(mode: 'missing-add' | 'working'): Promise<void> {
    await this.driver.copy(['game/src/basket.ts', 'game/test/driver/shopping.ts']);
    if (mode === 'missing-add') await this.driver.breakBasket();
  }
  expectQuantityFailure(title: string, expected: number, actual: number): void {
    expect(this.driver.result.code).toBe(1);
    const test = this.driver.report.stages.find(stage => stage.name === 'execution')?.tests?.find(test => test.title === title);
    expect(test?.state, this.driver.result.stdout + this.driver.result.stderr).toBe('failed');
    expect(test?.errors).toContainEqual(expect.objectContaining({ actual: String(actual), expected: String(expected) }));
  }
  expectPassed(title: string): void {
    this.expectSuccess(); expect(this.driver.report.status).toBe('tested');
    expect(this.driver.report.stages.find(stage => stage.name === 'execution')?.tests).toContainEqual(expect.objectContaining({ title, state: 'passed' }));
  }
  source(text: string): Promise<void> { return this.driver.file('main.expec', text); }
  useTypeScriptOutput(): Promise<void> { return this.driver.useTypeScriptOutput(); }
  implementSave(body: string): Promise<void> { return this.driver.implementSave(body); }
  identityDecision(name: string, previousLine: number): string {
    expect(this.driver.result.code).toBe(3); expect(this.driver.report.status).toBe('action-required');
    const problems = this.driver.report.problems.filter(problem => problem.code === 'identity-correspondence'
      && problem.message.startsWith('Explicit correspondence or retirement is required for ' + name + ' (id: '));
    expect(problems, 'The public diagnostic must identify the previous declaration without reading a private ledger.').toHaveLength(1);
    expect(problems[0]!.at?.range).toMatchObject({ sourceId: expect.stringContaining('main.expec'), start: { line: previousLine, column: 1 } });
    expect(problems[0]!.message).toContain('previous declaration');
    const id = /\(id: ("(?:\\.|[^"\\])*")\)/.exec(problems[0]!.message)?.[1];
    expect(id).toBeDefined(); return JSON.parse(id!);
  }
  writeCorrespondence(id: string, line: number, column: number): Promise<void> { return this.driver.decisionFile(id, line, column); }
  async expectSaveBody(name: string, body: string): Promise<void> { expect((await this.driver.method(name)).body.getText()).toBe('{ ' + body + ' }'); }
  expectUnchangedBuild(): void {
    this.expectSuccess(); expect(this.driver.report.status).toBe('built');
    const outputs = this.driver.report.stages.filter(stage => stage.name === 'contracts' || stage.name === 'tests').filter(stage => stage.status !== 'not-run');
    expect(outputs.length).toBeGreaterThan(0); expect(outputs.every(stage => stage.status === 'unchanged')).toBe(true);
  }
  async expectUnknownDeclaration(name:string,file:string): Promise<void> {
    this.expectProblem('unresolved-reference');
    const problem=this.driver.report.problems.find(problem=>problem.code==='unresolved-reference'),range=problem?.at?.range;
    expect(range?.sourceId).toContain(file);expect(range).toBeDefined();
    expect((await this.driver.text(file)).slice(range!.start.offset,range!.end.offset)).toBe(name);
    expect(this.driver.report.stages.some(stage=>stage.name==='execution')).toBe(false); expect(this.driver.report.status).not.toBe('tested');
  }
  async withoutPackageRequirements(): Promise<void> { await this.driver.removePackageRequirements(); }
  rememberWorkingFiles(): Promise<void> { return this.driver.remember(''); }
  declineInitialization(): Promise<void> { return this.driver.declineInitialization(); }
  async expectDeclinedWithoutChanges(): Promise<void> {
    expect(this.driver.answered).toBe(true); expect(this.driver.result.code).toBe(3); expect(this.driver.result.stderr).toContain('declined:');
    expect(await this.driver.unchanged('')).toBe(true);
  }
  rememberProjectFiles(): Promise<void> { return this.driver.remember(); }
  expectProblem(code: string): void { expect(this.driver.result.code).toBe(1); expect(this.driver.report.problems).toContainEqual(expect.objectContaining({ code })); }
  async expectProjectFilesUnchanged(): Promise<void> { expect(await this.driver.unchanged()).toBe(true); }
}
