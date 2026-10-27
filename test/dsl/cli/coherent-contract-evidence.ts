import { expect } from 'vitest';
import ts from 'typescript';
import type { Diagnostic } from '../../../src/compiler/checking.js';
import { CoherentContractEvidenceDriver } from '../../driver/cli/coherent-contract-evidence.js';

export class CoherentContractEvidence {
  private constructor(private readonly driver: CoherentContractEvidenceDriver) {}
  static async create(): Promise<CoherentContractEvidence> { return new CoherentContractEvidence(await CoherentContractEvidenceDriver.create()); }
  projectWithContractsAndExample(source: string): Promise<void> { return this.driver.setup(source); }
  build(): Promise<void> { return this.driver.generate(); }
  appendAfterFirstContractQuery(path: string, text: string): void { this.driver.appendAfterFirst(path, text); }
  refuseAfterFirstContractQuery(problem: Diagnostic): void { this.driver.refuseAfterFirst(problem); }
  cancelAfterFirstContractQuery(): void { this.driver.cancelAfterFirst(); }
  expectBuilt(): void {
    expect(this.driver.result.exitCode, JSON.stringify({ problems: this.driver.result.problems, stages: this.driver.result.stages.map(({ name, status }) => ({ name, status })) })).toBe(0); expect(this.driver.result.status).toBe('built');
    expect(this.driver.result.problems).toEqual([]);
  }
  expectStage(name: string, status: string): void {
    expect(this.driver.result.stages).toContainEqual(expect.objectContaining({ name, status }));
  }
  expectInspectedSubjects(expected: string[]): void {
    expect(this.driver.subjects().sort()).toEqual([...expected].sort());
    expect(new Set(this.driver.adapterQueries.map(query => query.id)).size).toBe(expected.length);
    expect(this.driver.adapterQueries).toHaveLength(expected.length);
  }
  expectCompleteContractCoverage(): void {
    expect(this.driver.adapterQueries.length).toBeGreaterThan(0);
    for (const query of this.driver.adapterQueries) {
      expect(query.result.problems).toEqual([]);
      expect(query.result.coverage.complete).toBe(true);
      expect(query.result.coverage.limitations).toEqual([]);
      expect(query.result.artifacts.length).toBeGreaterThan(0);
    }
  }
  expectLiveAcquisitionsInsideContractQueries(expected: number): void { expect(this.driver.liveCapturesInQueries).toBe(expected); }
  expectFirstContractQueryCompleted(): void { expect(this.driver.hookCompleted).toBe(true); }
  expectInspectedQueryCount(expected: number): void { expect(this.driver.adapterQueries).toHaveLength(expected); }
  expectProblem(code: string): void {
    expect(this.driver.result.exitCode).toBe(1);
    expect(this.driver.result.problems, JSON.stringify(this.driver.result.problems)).toContainEqual(expect.objectContaining({ code }));
  }
  expectProblemAt(code: string, path: readonly (string | number)[]): void {
    this.expectProblem(code);
    expect(this.driver.result.problems).toContainEqual(expect.objectContaining({ code, at: { kind: 'dependency', path } }));
  }
  expectAppliedContractReceipt(path: string): void {
    const outcomes = this.driver.result.stages.filter(stage => stage.name === 'contracts').flatMap(stage => {
      const receipt = stage.receipt as { outcomes?: unknown[] } | undefined; return receipt?.outcomes ?? [];
    });
    expect(outcomes).toContainEqual(expect.objectContaining({ change: expect.objectContaining({ path }), state: 'applied' }));
  }
  async expectFileEndsWith(path: string, suffix: string): Promise<void> { expect((await this.driver.text(path)).endsWith(suffix)).toBe(true); }
  async expectTypeField(owner: string, name: string, type: string): Promise<void> {
    const source = await this.driver.source('src/' + owner + '.ts'), declarations = source.statements.filter(ts.isTypeAliasDeclaration).filter(node => node.name.text === owner);
    expect(declarations).toHaveLength(1);
    const typeNode = declarations[0]!.type; expect(ts.isTypeLiteralNode(typeNode)).toBe(true);
    const fields = ts.isTypeLiteralNode(typeNode) ? typeNode.members.filter(ts.isPropertySignature).filter(node => node.name.getText(source) === name) : [];
    expect(fields).toHaveLength(1); expect(fields[0]!.type?.getText(source)).toBe(type);
  }
  async expectNativeMethod(owner: string, name: string, type: string): Promise<void> {
    const source = await this.driver.source('src/' + owner + '.ts'), declarations = source.statements.filter(ts.isClassDeclaration).filter(node => node.name?.text === owner);
    expect(declarations).toHaveLength(1);
    const methods = declarations[0]!.members.filter(ts.isMethodDeclaration).filter(node => node.name.getText(source) === name);
    expect(methods).toHaveLength(1); expect(methods[0]!.type?.getText(source)).toBe(type);
  }
  async expectGeneratedCall(name: string, args: number[], expected: number): Promise<void> {
    const calls: { expression: string; args: string[] }[] = [], comparedCalls: ({ name: string; args: string[] } | undefined)[] = [];
    for (const path of await this.driver.filesUnder('test/acceptance')) {
      const source = await this.driver.source(path), visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          calls.push({ expression: node.expression.getText(source), args: node.arguments.map(arg => arg.getText(source)) });
          if (node.expression.getText(source) === 'expectData') {
            let compared = node.arguments[0];
            while (compared && (ts.isAwaitExpression(compared) || ts.isParenthesizedExpression(compared))) compared = compared.expression;
            comparedCalls.push(compared && ts.isCallExpression(compared)
              ? { name: compared.expression.getText(source), args: compared.arguments.map(arg => arg.getText(source)) } : undefined);
          }
        }
        node.forEachChild(visit);
      }; visit(source);
    }
    expect(calls.filter(call => call.expression === name).map(call => call.args)).toEqual([args.map(String)]);
    expect(calls.filter(call => call.expression === 'expectData').map(call => call.args[1])).toEqual([String(expected)]);
    expect(comparedCalls).toEqual([{ name, args: args.map(String) }]);
  }
  async expectAcceptanceLayers(): Promise<void> {
    for (const path of ['test/acceptance', 'test/dsl', 'test/driver']) expect((await this.driver.filesUnder(path)).length).toBeGreaterThan(0);
    const state = JSON.parse(await this.driver.text('.expec/outputs/616363657074616e6365.json')) as { files: unknown[] };
    expect(state.files.length).toBeGreaterThan(0);
  }
  async expectNoTestStageEffects(): Promise<void> {
    expect(await this.driver.absent('test')).toBe(true);
    expect(await this.driver.absent('.expec/outputs/616363657074616e6365.json')).toBe(true);
    const identity = JSON.parse(await this.driver.text('.expec/identity.json')) as { baseline: { artifacts: { locator: { outputId: string } }[] } };
    expect(identity.baseline.artifacts.filter(item => item.locator.outputId === 'acceptance')).toEqual([]);
    this.expectStage('tests', 'stopped');
  }
}
