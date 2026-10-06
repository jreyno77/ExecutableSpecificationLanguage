import { expect } from 'vitest';
import type { Diagnostic, ExternalDefinition, PackagePhase, SyntaxDiagnostic } from '../../../src/index.js';
import { CompilationDriver, type LocationSelection, type SourceOptions } from '../../driver/compiler/compiler-composition.js';

export class CompilationExamples {
  private readonly driver = new CompilationDriver();
  private problem!: Diagnostic;
  source(text: string, options?: SourceOptions): void { this.driver.source(text, options); }
  module(locator: string, text: string, options?: SourceOptions): void { this.driver.module(locator, text, options); }
  externalModule(locator: string, definitions: readonly ExternalDefinition[]): void { this.driver.externalModule(locator, definitions); }
  removeModule(locator: string): void { this.driver.removeModule(locator); }
  package(alias: string, phases: readonly PackagePhase[]): void { this.driver.package(alias, phases); }
  compile(): void { this.driver.compile(); }
  expectChecked(): void {
    const result = this.driver.findings();
    expect(result.syntax).toEqual([]);
    expect(result.problems).toEqual([]);
    expect(result.deferred).toEqual([]);
    expect(result.value).toBeDefined();
  }
  expectNoSpecification(): void { expect(this.driver.findings().value).toBeUndefined(); }
  expectNoSemanticFindings(): void {
    expect(this.driver.findings().problems).toEqual([]);
    expect(this.driver.findings().deferred).toEqual([]);
  }
  expectProblem(code: string, text: string, selection?: LocationSelection): void {
    const span = this.driver.expectedSpan(text, selection);
    const problem = this.driver.findings().problems.find(problem => problem.code === code
      && JSON.stringify(this.driver.span(problem.at)) === JSON.stringify(span));
    expect(problem, `Expected ${code} at ${text}`).toBeDefined();
    this.problem = problem!;
  }
  expectRelatedDependency(path: readonly (string | number)[]): void {
    expect(this.problem.related).toContainEqual({ kind: 'dependency', path });
  }
  expectDeferred(reason: string, text: string, selection?: LocationSelection): void {
    expect(this.driver.findings().deferred.filter(requirement => requirement.reason === reason)
      .map(requirement => this.driver.span(requirement.origin))).toContainEqual(this.driver.expectedSpan(text, selection));
  }
  expectSyntaxProblem(category: SyntaxDiagnostic['category'], text: string): void {
    expect(this.driver.findings().syntax.filter(problem => problem.category === category)
      .map(problem => this.driver.span(problem.primaryRange))).toContainEqual(this.driver.expectedSpan(text));
  }
  expectPublicCapabilities(owner: string, names: readonly string[]): void {
    const ids = this.driver.publicCapabilities(owner);
    expect(ids.map(id => this.driver.specification().inspection.read(id, 'capability').name)).toEqual(names);
    names.forEach((name, index) => expect(ids[index]).toBe(this.driver.named(`${owner}.${name}`).id));
  }
  expectSignature(name: string, parameters: readonly string[], result: string): void {
    expect(this.driver.signature(name)).toEqual({ parameters, result });
  }
  expectSameType(first: string, second: string): void { expect(this.driver.slotType(first)).toBe(this.driver.slotType(second)); }
  expectRelationship(owner: string, target: string, role: string, selection: LocationSelection & { typePath?: readonly number[] }): void {
    const candidates = this.driver.relationships().filter(relationship => relationship.owner === owner && relationship.role === role
      && JSON.stringify(this.driver.span(relationship.origin)) === JSON.stringify(this.driver.expectedSpan(target, selection))
      && JSON.stringify(relationship.typePath) === JSON.stringify(selection.typePath ?? []));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.target).toBe(this.driver.named(target).id);
  }
  expectPromise(name: string, expected: string): void {
    expect(this.driver.contract(name).filter(clause => clause.kind === 'promises').map(clause => clause.text)).toContain(expected);
  }
  expectNoCommunications(): void {
    expect(this.driver.query('interaction')).toEqual([]);
    expect(this.driver.query('message')).toEqual([]);
  }
  expectConsumersAgreeInEitherOrder(): void {
    expect(this.driver.consumerObservations(true)).toEqual(this.driver.consumerObservations());
    const specification = this.driver.specification();
    for (const capability of specification.inspection.query('capability')) {
      expect(specification.types.inspection.read(capability.id)).toEqual(capability);
      expect(specification.types.inspection.read(capability.id).id).toBe(capability.id);
    }
  }
  expectOwnedTypes(names: readonly string[]): void { expect(this.driver.owned('types')).toEqual(names); }
  expectOwnedFunctions(names: readonly string[]): void { expect(this.driver.owned('functions')).toEqual(names); }
  expectResult(name: string, expected: string): void {
    const result = this.driver.callable(name).result;
    expect(result.status).toBe('known');
    if (result.status !== 'known') throw new Error('Expected a known result description');
    expect(result.value.kind === 'value' ? this.driver.typeName(result.value.type) : result.value.kind).toBe(expected);
  }
  expectAuthoredBody(name: string, kind: string): void { expect(this.driver.body(name).kind).toBe(kind); }
  expectContractCondition(name: string, kind: 'requires' | 'ensures', expected: string): void {
    expect(this.driver.contract(name).flatMap(clause => clause.kind === kind && 'content' in clause
      ? [this.driver.textAt(clause.content.origin)] : [])).toContain(expected);
  }
  expectSteps(title: string, steps: readonly string[]): void {
    expect(this.driver.titled('scenario', title).steps.map(step => this.driver.textAt(step.origin))).toEqual(steps);
  }
  expectExample(title: string, expected: { actual: string; expected: string }): void {
    const example = this.driver.titled('example', title);
    expect({ actual: this.driver.textAt(example.actual.origin), expected: this.driver.textAt(example.expected.origin) }).toEqual(expected);
  }
  expectProseExpectation(title: string, expected: string): void {
    const content = this.driver.titled('example', title).expected;
    expect(content.kind).toBe('prose-expectation');
    if (content.kind !== 'prose-expectation') throw new Error('Expected authored prose');
    expect(content.text.value).toBe(expected);
  }
  expectCommunication(title: string, number: number, expected: { sender: string; receiver: string; operation: string; reply?: string }): void {
    const report = this.driver.message(title, number);
    expect(report.problems).toEqual([]);
    expect(report.deferred).toEqual([]);
    expect(report.value).toBeDefined();
    expect(report.value!.sender).toBe(this.driver.participant(title, expected.sender));
    expect(report.value!.receiver).toBe(this.driver.participant(title, expected.receiver));
    expect(report.value!.operation).toBe(this.driver.named(expected.operation).id);
    if (expected.reply) expect(report.value!.reply).toBe(this.driver.namedType(expected.reply));
    else expect(report.value!.reply).toBeUndefined();
  }
  expectReplyUsesCatalogIdentity(title: string, number: number, type: string): void {
    expect(this.driver.message(title, number).value?.reply).toBe(this.driver.namedType(type));
  }
  expectResultOrigin(name: string, expected: { module: string; sourceId: string; line: number }): void {
    expect(this.driver.resultOrigin(name)).toMatchObject({ kind: 'source', module: expected.module,
      range: { sourceId: expected.sourceId, start: { line: expected.line } } });
  }
  expectField(owner: string, name: string, type: string): void {
    const field = this.driver.field(owner, name);
    expect(field.name).toBe(type);
    expect(field.type).toBe(this.driver.namedType(type));
  }
  expectNoDeclaration(name: string): void {
    const specification = this.driver.specification();
    const declarations = [...specification.types.typeDeclarations(), ...specification.types.callableDeclarations()];
    expect(declarations.map(id => this.driver.name(specification.inspection.read(id)))).not.toContain(name);
  }
  expectExternalOperation(name: string, module: string): void { expect(this.driver.named(name).origin).toMatchObject({ kind: 'external', module }); }
  rememberResult(label: string): void { this.driver.rememberResult(label); }
  expectRememberedResultUnchanged(label: string): void {
    const remembered = this.driver.rememberedResult(label);
    expect(this.driver.snapshot(remembered.result)).toBe(remembered.snapshot);
  }
  expectRememberedField(label: string, owner: string, name: string, type: string): void {
    const specification = this.driver.specification(this.driver.rememberedResult(label).result);
    const field = this.driver.field(owner, name, specification);
    expect(field.name).toBe(type);
    expect(field.type).toBe(this.driver.namedType(type, specification));
  }
}
