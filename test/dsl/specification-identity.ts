import { expect } from 'vitest';
import { QueryError, type ArtifactLocator, type ExternalDefinition, type Item, type SpecDiff } from '../../src/index.js';
import { IdentityDriver, type SuppliedUses } from '../driver/specification-identity.js';

export class IdentityExamples {
  private readonly driver: IdentityDriver;
  constructor(options?: { ids: readonly string[] }) { this.driver = new IdentityDriver(options?.ids); }
  source(module: string, text: string): void { this.driver.source(module, text, true); }
  module(module: string, text: string): void { this.driver.source(module, text); }
  externalModule(module: string, definitions: readonly ExternalDefinition[]): void { this.driver.external.set(module, definitions); }
  replaceEntry(module: string, text: string): void { this.driver.sources.delete(this.driver.entry); this.source(module, text); }
  replaceText(before: string, after: string): void {
    const d = this.driver; d.source(d.entry, d.sources.get(d.entry)!.replace(before, after));
  }
  identify(): void { this.driver.identify(); }
  remember(): void { this.driver.remember(); }
  restartFromSavedBaseline(): void { this.driver.restart(); }
  compare(): void { this.driver.compare(); }
  keep(old: string, current: string): void { this.driver.decisions.push({ old, current }); }
  retire(old: string): void { this.driver.decisions.push({ old }); }
  expectAccepted(): void { expect(this.driver.result).toMatchObject({ problems: [], deferred: [], value: expect.any(Object) }); }
  expectNoIdentifiedSpecification(): void { expect(this.driver.result.value).toBeUndefined(); }
  expectIdentities(identities: Record<string, string>): void {
    for (const [name, id] of Object.entries(identities)) expect(this.driver.id(name)).toBe(id);
  }
  expectOnlyEligibleElements(count: number): void { expect(this.driver.current().baseline.elements).toHaveLength(count); }
  expectNoIdentityForBuiltin(name: string): void {
    const d = this.driver, builtin = [...d.current().specification.inspection.query('builtin-type')].find(node => node.name === name)!;
    expect(() => d.current().id(builtin.id)).toThrow(QueryError);
    expect(d.current().baseline.elements.map(record => record.address.kind)).not.toContain('builtin-type');
  }
  expectSameIdentity(old: string, current = old): void { expect(this.driver.id(current)).toBe(this.driver.id(old, true)); }
  expectDifferentIdentity(old: string, current: string): void { expect(this.driver.id(current)).not.toBe(this.driver.id(old, true)); }
  expectDistinctIdentities(first: string, second: string): void { expect(this.driver.id(first)).not.toBe(this.driver.id(second)); }
  expectFreshNodeHandle(subject: string): void { expect(this.driver.select(subject).id).not.toBe(this.driver.select(subject, true).id); }
  expectNoNewIdsRequested(): void { expect(this.driver.requested).toBe(this.driver.counted); }
  expectNoIdsRequested(): void { expect(this.driver.requested).toBe(0); }
  expectNoChanges(): void { expect(this.changes()).toEqual([]); expect(this.driver.diff.value!.contextChanged).toBe(false); }
  expectContextChanged(): void { expect(this.driver.diff.value!.contextChanged).toBe(true); }
  private changes(): SpecDiff['changes'] { expect(this.driver.diff.value).toBeDefined(); return this.driver.diff.value!.changes; }
  expectChanges(expected: Record<string, readonly string[]>): void {
    const d = this.driver, id = (name: string): string => {
      try { return d.id(name); } catch { return d.id(name, true); }
    };
    expect(this.changes().map(change => ({ id: change.id, kinds: change.kinds })).sort(byId))
      .toEqual(Object.entries(expected).map(([name, kinds]) => ({ id: id(name), kinds })).sort(byId));
  }
  expectReplacement(subject: string, kinds: { old: readonly string[]; current: readonly string[] }): void {
    expect(this.changes().map(change => ({ id: change.id, kinds: change.kinds })).sort(byId)).toEqual([
      { id: this.driver.id(subject, true), kinds: kinds.old }, { id: this.driver.id(subject), kinds: kinds.current },
    ].sort(byId));
  }
  expectRetired(subject: string): void { expect(this.driver.current().baseline.retired).toContain(this.driver.id(subject, true)); }
  expectRetiredIdCannotBeReused(): void {
    const d = this.driver, retired = d.current().baseline.retired[0]!, probe = new IdentityDriver([retired]);
    d.sources.forEach((text, module) => probe.source(module, text, module === d.entry));
    d.external.forEach((definitions, module) => probe.external.set(module, definitions));
    probe.source(d.entry, d.sources.get(d.entry)! + '\nopaque type Additional');
    probe.baseline = d.current().baseline;
    expect(() => probe.identify()).toThrow(TypeError);
  }
  expectProblem(code: string, details: { mentions: string[] }): void {
    const d = this.driver, problems = [d.result, d.readResult, d.artifactResult].flatMap(check => check.problems).filter(problem => problem.code === code);
    expect(problems.length).toBeGreaterThan(0);
    for (const value of details.mentions) expect(problems.map(problem => problem.message).join('\n')).toContain(value);
    expect(problems.every(problem => !!problem.at)).toBe(true);
  }
  expectRememberedBaselineUnchanged(): void { expect(JSON.stringify(this.driver.prior().identified.baseline)).toBe(this.driver.rememberedBytes); }
  expectSourceAndBaselineInputsUnchanged(): void { expect(this.driver.modelState()).toBe(this.driver.inputState); }
  expectCurrentOrigin(subject: string, expected: { module: string; line: number }): void { this.origin(subject, expected, false); }
  expectRememberedOrigin(subject: string, expected: { module: string; line: number }): void { this.origin(subject, expected, true); }
  private origin(subject: string, expected: { module: string; line: number }, previous: boolean): void {
    expect(this.driver.record(subject, previous).origin).toMatchObject({ kind: 'source', module: expected.module, range: { start: { line: expected.line } } });
  }
  expectCurrentKind(subject: string, kind: string): void { expect(this.driver.select(subject).kind).toBe(kind); }
  expectCurrentPromise(subject: string, text: string): void {
    const callable = this.driver.select(subject);
    if (!('body' in callable) || callable.body.kind !== 'available') throw new Error('Expected a contract body');
    const body = callable.body.content;
    expect('members' in body ? body.members.filter(node => node.kind === 'promises').map(node => node.text) : []).toEqual([text]);
  }
  expectOldFingerprintAvailable(subject: string): void { expect(this.driver.record(subject, true).structure).toMatch(/^sha256:[a-f0-9]{64}$/); }
  expectSameStructure(subject: string): void { expect(this.driver.record(subject).structure).toBe(this.driver.record(subject, true).structure); }
  expectCurrentNumberToken(subject: string, token: string): void {
    const node = this.driver.select(subject);
    expect('defaultValue' in node ? node.defaultValue : undefined).toMatchObject({ kind: 'number-literal', token });
  }
  expectBoundReference(subject: string, target: string): void { expect(this.driver.record(subject).references).toContain(this.driver.id(target)); }
  expectAffected(subjects: string[]): void { expect([...this.driver.diff.value!.affected].sort()).toEqual(subjects.map(name => this.driver.id(name)).sort()); }
  expectNoRepeatedAffectedIds(): void { const ids = this.driver.diff.value!.affected; expect(new Set(ids).size).toBe(ids.length); }
  expectCurrentFieldType(subject: string, type: string): void {
    const d = this.driver, field = d.select(subject), types = d.current().specification.types;
    if (field.kind !== 'field') throw new Error('Expected a field');
    const fact = types.typeOf(field.declaredType.id);
    expect(fact.status).toBe('known');
    const builtin = [...types.inspection.query('builtin-type')].find(node => node.name === type)!;
    if (fact.status === 'known') expect(fact.value).toBe(types.declaredType(builtin.id));
  }
  expectContextuallyCheckedReference(member: string): void {
    const d = this.driver;
    expect(d.compilation.value).toBeDefined();
    expect([...d.current().specification.inspection.query('reference')].some(reference =>
      reference.segments.join('.') === member.split('.').at(-1) && reference.resolution.status === 'deferred')).toBe(true);
  }
  expectCurrentScenarioStep(title: string, text: string): void {
    const d = this.driver, scenario = [...d.current().specification.inspection.query('scenario')].find(node => node.title.value === title)!;
    expect(scenario.steps.some(step => step.origin.kind === 'source' &&
      d.sources.get(step.origin.module)!.slice(step.origin.range.start.offset, step.origin.range.end.offset) === text)).toBe(true);
  }
  associateArtifacts(subject: string, locators: readonly ArtifactLocator[]): void {
    this.driver.associations(locators.map(locator => ({ subject, locator })));
    expect(this.driver.artifactResult.value).toBeDefined();
  }
  proposeArtifactAssociations(items: readonly { subject: string; locator: ArtifactLocator }[]): void { this.driver.associations(items); }
  expectArtifactFiles(subject: string, files: string[]): void { expect(this.files(subject)).toEqual(files); }
  expectRememberedArtifactFiles(subject: string, files: string[]): void { expect(this.files(subject, true)).toEqual(files); }
  expectRetiredArtifactFiles(subject: string, files: string[]): void { expect(this.files(subject, false, true)).toEqual(files); }
  private files(subject: string, previous = false, retired = false): unknown[] {
    return this.driver.artifacts(subject, previous, retired).map(link => (link.locator.value as { file: string }).file);
  }
  expectNoArtifacts(subject: string): void { expect(this.driver.artifacts(subject)).toEqual([]); }
  expectNoRecordedArtifactProposal(): void { expect(this.driver.artifactResult.value).toBeUndefined(); }
  expectCurrentAssociations(associations: unknown[]): void { expect(this.driver.current().baseline.artifacts).toEqual(associations); }
  observeRelationships(subject: string, observation: SuppliedUses): void { this.driver.observe(subject, observation); }
  reconcileExpected(expected: string[]): void { this.driver.reconcile(expected); expect(this.driver.reconciliation.value).toBeDefined(); }
  expectMatches(names: string[]): void { expect(this.driver.reconciliation.value!.matched.map(match => match.id)).toEqual(names.map(name => this.driver.id(name))); }
  expectUnobserved(names: string[]): void { expect(this.driver.reconciliation.value!.unobserved).toEqual(names.map(name => this.driver.id(name))); }
  expectObservedOnly(expected: { project: string; at: string }[]): void {
    expect(this.driver.reconciliation.value!.observedOnly.map(use => ({ project: use.target.id, at: use.at.value }))).toEqual(expected);
  }
  expectCoverage(expected: { complete: boolean; scope: string[]; limitations?: string[] }): void {
    const coverage = this.driver.reconciliation.value!.observation.coverage;
    expect({ complete: coverage.complete, scope: coverage.scope.map(item => item.value), limitations: coverage.limitations })
      .toEqual({ ...expected, limitations: expected.limitations ?? [] });
  }
  expectUnresolvedUse(at: string, reason: string): void {
    expect(this.driver.reconciliation.value!.observation.unresolved).toContainEqual(expect.objectContaining({ at: expect.objectContaining({ value: at }), reason }));
  }
  expectDirection(direction: string): void { expect(this.driver.reconciliation.value!.observation.direction).toBe(direction); }
  expectNoSpecificationDeclaration(name: string): void { expect(this.driver.current().baseline.elements.some(record => record.address.name === name)).toBe(false); }
  expectNoNewIdsRequestedSinceObservation(): void { expect(this.driver.requested).toBe(this.driver.observedCount); }
  saveBaseline(): void { this.driver.save(); }
  changeSavedJson(change: Record<string, unknown>): void { this.driver.saved = JSON.stringify({ ...JSON.parse(this.driver.saved), ...change }); }
  insertRepeatedSavedProperty(key: string, value: unknown): void { this.driver.saved = this.driver.saved.replace('{', '{' + JSON.stringify(key) + ':' + JSON.stringify(value) + ','); }
  readSavedBaseline(): void { this.driver.read(); }
  expectNoReadBaseline(): void { expect(this.driver.readResult.value).toBeUndefined(); }
  expectCompilationProblem(code: string, name: string): void {
    expect(this.driver.compilation.problems).toEqual(expect.arrayContaining([expect.objectContaining({ code, message: expect.stringContaining(name) })]));
  }
  expectInspectionRoot(subject: string): void {
    const d = this.driver;
    expect([...d.compilation.value!.inspection.roots()].map(node => node.id)).toContain(d.select(subject).id);
  }
  expectInspectionChild(owner: string, name: string, shape: { kind: string }): void {
    const d = this.driver;
    expect([...d.compilation.value!.inspection.children(d.select(owner).id)]).toContainEqual(expect.objectContaining({ name, ...shape }));
  }
  expectTraversalPreservesQueryIdentitiesAndParents(): void {
    const inspection = this.driver.current().specification.inspection;
    const visit = (node: Item): void => {
      expect(inspection.read(node.id)).toBe(node);
      expect([...inspection.query(node.kind)].some(found => found.id === node.id)).toBe(true);
      for (const child of inspection.children(node.id)) { expect(inspection.parent(child.id)?.id).toBe(node.id); visit(child); }
    };
    for (const root of inspection.roots()) visit(root);
  }
  expectEffectiveOwner(subject: string, owner: string): void {
    const d = this.driver;
    expect(d.current().specification.inspection.parent(d.select(subject).id)?.id).toBe(d.select(owner).id);
  }
  expectCurrentFieldNames(subject: string, names: string[]): void {
    const record = this.driver.select(subject);
    if (record.kind !== 'record-type-declaration') throw new Error('Expected a record');
    expect(record.fields.map(field => ({ kind: field.kind, name: 'name' in field ? field.name : undefined })))
      .toEqual(names.map(name => ({ kind: 'field', name })));
  }
  expectCurrentParameterNames(subject: string, names: string[]): void {
    const callable = this.driver.select(subject);
    if (!('parameters' in callable)) throw new Error('Expected a callable');
    expect(callable.parameters.map(parameter => ({ kind: parameter.kind, name: parameter.name })))
      .toEqual(names.map(name => ({ kind: 'parameter', name })));
  }
  expectCurrentBody(subject: string, kind: string): void {
    const callable = this.driver.select(subject);
    expect('body' in callable ? callable.body.kind : undefined).toBe(kind);
  }
  expectNoAuthoredSubject(subject: string): void {
    const block = this.driver.select(subject);
    if (block.kind !== 'examples') throw new Error('Expected an examples block');
    expect(block.subject).toBeUndefined();
  }
  expectEffectiveBuiltinOwner(subject: string, name: string): void {
    const d = this.driver;
    expect(d.current().specification.inspection.parent(d.select(subject).id)).toMatchObject({ kind: 'builtin-type', name });
  }
}
function byId(a: { id: string }, b: { id: string }): number { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
