import { expect } from 'vitest';
import {
  createSyntaxReader, DescriptionInspection, Resolver, ResolutionQueryError,
  type Inspection, type InspectionNode, type Resolution, type DependencySnapshot,
  type DependencyModule, type Declaration, type DeclarationKind, type DeclarationId,
  type ResolutionProblemCode, type DeferredReason, type SourceDescription,
} from '../../src/index.js';

type Point = { line: number; column: number };
type Target = { name: string; kind?: DeclarationKind; origin?: Partial<Declaration['origin']> };

export class DeclarationResolution {
  private readonly resolver = new Resolver();
  private inspection!: Inspection;
  private description!: SourceDescription;
  private beforeSource!: SourceDescription;
  private dependencies: DependencySnapshot = { modules: [], packages: [] };
  private beforeDependencies!: DependencySnapshot;
  private report: Resolution | undefined;

  sourceIs(text: string, sourceId = 'resolution.expec'): void {
    const read = createSyntaxReader().read({ sourceId, text });
    if (read.status !== 'accepted') throw new Error('Acceptance source must be grammatical: ' + JSON.stringify(read.diagnostics));
    this.description = read.description;
    this.beforeSource = structuredClone(read.description);
    this.inspection = new DescriptionInspection(read.description);
    this.report = undefined;
  }

  dependenciesAre(dependencies: DependencySnapshot): void { this.dependencies = dependencies; this.report = undefined; }

  moduleExportsRecord(locator: string, name: string): void {
    const module: DependencyModule = {
      locator,
      declarations: [{ id: name, name, kind: 'record-type', links: [] }],
      exports: [{ path: [name], declaration: name }],
    };
    this.dependencies = { ...this.dependencies, modules: [...this.dependencies.modules, module] };
    this.report = undefined;
  }

  resolveDeclarations(): void {
    this.beforeDependencies = structuredClone(this.dependencies);
    this.report = this.resolver.resolve(this.inspection, this.dependencies);
  }

  expectNoProblems(): void { expect(this.resolved().problems).toEqual([]); }
  expectProblemCodes(codes: ResolutionProblemCode[]): void {
    expect(this.resolved().problems.map(problem => problem.code).sort()).toEqual([...codes].sort());
  }
  expectProblem(code: ResolutionProblemCode, at?: Point, minimumRelated = 0): void {
    const found = this.resolved().problems.find(problem => problem.code === code
      && (!at || (problem.at.kind === 'source'
        && problem.at.range.start.line === at.line && problem.at.range.start.column === at.column)));
    expect(found, 'The authored problem must be reported at its actual use').toBeDefined();
    expect(found!.related.length).toBeGreaterThanOrEqual(minimumRelated);
  }
  expectCatalogProblemWithin(path: readonly (string | number)[]): void {
    const found = this.resolved().problems.find(problem => problem.code === 'invalid-dependency-catalog'
      && problem.at.kind === 'dependency'
      && path.every((part, index) => problem.at.kind === 'dependency' && problem.at.path[index] === part));
    expect(found, 'The malformed supplied metadata needs a located catalog problem').toBeDefined();
  }

  expectBound(segments: readonly string[], expected: Target, occurrence = 0): void {
    expect(this.target(segments, occurrence)).toMatchObject(expected);
  }
  expectBoundAt(segments: readonly string[], expected: Point, occurrence = 0): void {
    const target = this.target(segments, occurrence);
    expect(target.origin).toMatchObject({ kind: 'source', range: { start: expected } });
  }
  expectInvalid(segments: readonly string[], code: ResolutionProblemCode, occurrence = 0): void {
    const binding = this.resolved().binding(this.reference(segments, occurrence).id);
    expect(binding.status).toBe('invalid');
    if (binding.status !== 'invalid') throw new Error('Expected an invalid reference binding');
    expect(binding.problems.map(problem => problem.code)).toContain(code);
  }
  expectDeferred(segments: readonly string[], reason: DeferredReason, occurrence = 0): void {
    const reference = this.reference(segments, occurrence);
    const binding = this.resolved().binding(reference.id);
    expect(binding.status).toBe('deferred');
    if (binding.status !== 'deferred') throw new Error('Expected a deferred reference binding');
    expect(binding.requirement).toMatchObject({ occurrence: reference.id, range: reference.range, reason });
    expect(binding.requirement.requires.length).toBeGreaterThan(0);
    expect(this.resolved().deferred).toContainEqual(binding.requirement);
  }
  expectSameTargets(left: readonly string[], right: readonly string[], leftOccurrence = 0, rightOccurrence = 0): void {
    expect(this.target(left, leftOccurrence).id).toBe(this.target(right, rightOccurrence).id);
  }
  expectDifferentTargets(left: readonly string[], right: readonly string[], leftOccurrence = 0, rightOccurrence = 0): void {
    expect(this.target(left, leftOccurrence).id).not.toBe(this.target(right, rightOccurrence).id);
  }
  expectDeclaration(name: string, kind: DeclarationKind, owner?: string): void {
    const found = Array.from(this.resolved().declarations()).find(item => item.name === name && item.kind === kind);
    expect(found, 'The actual declaration must be discoverable').toBeDefined();
    expect(this.resolved().declaration(found!.id)).toEqual(found);
    if (owner !== undefined) {
      expect(found!.owner).toBeDefined();
      expect(this.resolved().declaration(found!.owner!).name).toBe(owner);
    }
  }
  expectBuiltinHasNoSource(name: string): void {
    const target = Array.from(this.resolved().declarations()).find(item => item.name === name && item.kind === 'builtin-type');
    expect(target?.origin).toEqual({ kind: 'builtin', name });
  }
  expectDeclarationNamesStartWith(names: string[]): void {
    expect(Array.from(this.resolved().declarations()).slice(0, names.length).map(item => item.name)).toEqual(names);
  }
  expectDeclarationsReplay(): void {
    const declarations = this.resolved().declarations();
    expect(Array.from(declarations)).toEqual(Array.from(declarations));
  }
  expectInputsUnchanged(): void {
    expect(this.description).toEqual(this.beforeSource);
    expect(this.dependencies).toEqual(this.beforeDependencies);
  }
  expectIndependentObservers(segments: readonly string[], expectedName: string): void {
    const names = Array.from(this.resolved().declarations()).map(item => item.name);
    const target = this.target(segments);
    expect(names).toContain(expectedName);
    expect(target.name).toBe(expectedName);
    expect(this.resolved().declaration(target.id).origin).toEqual(target.origin);
  }
  rememberFacts(): unknown {
    return {
      declarations: Array.from(this.resolved().declarations()).map(({ id: _id, owner: _owner, ...facts }) => facts),
      problems: this.resolved().problems,
      deferred: this.resolved().deferred,
    };
  }
  expectFactsEqual(facts: unknown): void { expect(this.rememberFacts()).toEqual(facts); }
  expectCheckedQueries(): void {
    const firstName = Array.from(this.inspection.nodes('name'))[0]!;
    expect(() => this.resolved().binding(firstName.id)).toThrowError(expect.objectContaining({ code: 'non-reference' }));
    expect(() => this.resolved().binding({ sourceId: 'another.expec', ordinal: 0 }))
      .toThrowError(expect.objectContaining({ code: 'foreign-source' }));
    expect(() => this.resolved().binding({ sourceId: this.description.sourceId, ordinal: 999999 }))
      .toThrowError(expect.objectContaining({ code: 'missing-node' }));
    expect(() => this.resolved().declaration({} as DeclarationId)).toThrowError(ResolutionQueryError);
    expect(() => this.resolved().declaration({} as DeclarationId))
      .toThrowError(expect.objectContaining({ code: 'unknown-declaration' }));
  }

  private resolved(): Resolution {
    if (!this.report) throw new Error('Resolve declarations before observing them');
    return this.report;
  }
  private reference(segments: readonly string[], occurrence: number): InspectionNode<'reference'> {
    const references = Array.from(this.inspection.nodes('reference')).filter(node => {
      const actual = this.inspection.reference(node.id);
      return actual.length === segments.length && actual.every((segment, index) => segment === segments[index]);
    });
    const reference = references[occurrence];
    if (!reference) throw new Error('The authored example has no reference occurrence: ' + JSON.stringify({ segments, occurrence }));
    return reference;
  }
  private target(segments: readonly string[], occurrence = 0): Declaration {
    const binding = this.resolved().binding(this.reference(segments, occurrence).id);
    expect(binding.status, 'The authored reference must identify a declaration').toBe('bound');
    if (binding.status !== 'bound') throw new Error('Expected a bound declaration');
    return this.resolved().declaration(binding.target);
  }
}


