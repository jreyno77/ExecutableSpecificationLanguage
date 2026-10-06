import { afterEach, expect } from 'vitest';
import { promises as fs, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OutputsDriver } from '../../../driver/project/output/outputs.js';
import type { ArtifactLocator, Diagnostic } from '../../../../src/index.js';

const examples: OutputsExample[] = [];
afterEach(async () => { await Promise.all(examples.splice(0).map(example => example.dispose())); });
const pathOf = (at: ArtifactLocator): string => typeof at.value === 'string' ? at.value : (at.value as { path: string }).path;
const location = (problem: Diagnostic): string => problem.at.kind === 'dependency' ? problem.at.path.join('/') : '';
export class OutputsExample extends OutputsDriver {
  static async connect(name?: string): Promise<OutputsExample> { const example = new OutputsExample(); examples.push(example); await example.initialize(name); return example; }
  static async withContracts(text: string): Promise<OutputsExample> { const project = await this.connect(); await project.specify(text); await project.createWith('contract-list', { directory: 'docs/contracts' }); return project; }
  static async withStructure(text: string): Promise<OutputsExample> { const project = await this.connect(); await project.specify(text); await project.createWith('structure-list', { directory: 'design/structure' }); return project; }
  async expectFile(path: string): Promise<void> { expect((await this.context.readSnapshot()).files.map(file => file.path)).toContain(path); }
  async expectNoFile(path: string): Promise<void> { expect((await this.context.readSnapshot()).files.map(file => file.path)).not.toContain(path); }
  async expectFileContains(path: string, text: string): Promise<void> { expect(await this.content(path)).toContain(text); }
  async expectContract(path: string, value: { name: string; dependencies: string[]; capabilities: string[]; promises: string[] }): Promise<void> {
    const actual = await this.content(path);
    expect(actual).toContain('Contract summary');
    for (const text of [value.name, ...value.dependencies, ...value.capabilities, ...value.promises]) expect(actual).toContain(text);
  }
  async expectPromiseUnverified(text: string): Promise<void> {
    const actual = await this.content('docs/contracts/StoreGame.md'); expect(actual).toContain(text); expect(actual).toMatch(/unverified/i);
  }
  async expectOtherProjectUnchanged(name: string): Promise<void> { expect(await fs.readdir(join(this.directory, name))).toEqual([]); }
  expectSameSpecificationObjectUsedByBothOutputs(): void { expect(this.captures).toHaveLength(2); expect(this.captures[0]).toBe(this.captures[1]); }
  expectSpecificationUnchanged(): void { expect(this.modelState()).toBe(this.modelBefore); }
  async expectStructuralDependency(name: string, target: string): Promise<void> {
    const value = JSON.parse(await this.content(`design/structure/${name}.structure.json`));
    expect(value.declaration.references).toContainEqual({ role: 'dependency', specId: this.identifier(target) });
  }
  async expectNoDeclaredMessage(name: string, _target: string): Promise<void> { expect(await this.content(`design/structure/${name}.structure.json`)).not.toMatch(/"(?:message|sender|receiver)"/); }
  expectReceipt(status: string): void { expect(this.written.receipt?.status, JSON.stringify(this.written.problems)).toBe(status); }
  expectProblem(code: string): void { expect(this.written.problems.map(problem => problem.code)).toContain(code); }
  expectUnsupported(code: string): void { this.expectProblem(code); }
  expectOpenProblem(code: string): void { expect(this.opened.value).toBeUndefined(); expect(this.opened.problems.map(problem => problem.code)).toContain(code); }
  expectConflictAt(path: string): void { expect(this.written.receipt).toBeUndefined(); expect(this.written.problems.some(problem => location(problem).includes(path))).toBe(true); }
  async expectFilesUnchanged(): Promise<void> { expect((await this.files()).map(({ metadata: _metadata, ...file }) => file)).toEqual(this.remembered.map(({ metadata: _metadata, ...file }) => file)); }
  async expectFilesAndMetadataUnchanged(): Promise<void> { expect(await this.files()).toEqual(this.remembered); }
  async expectRememberedFileAndMetadataUnchanged(): Promise<void> { expect((await this.files()).find(file => file.path === this.oneFile.path)).toEqual(this.oneFile); }
  async expectNoGeneratedArtifacts(): Promise<void> { expect((await this.context.readSnapshot()).files).toEqual([]); }
  async expectGeneratedDocuments(paths: string[]): Promise<void> { expect((await this.context.readSnapshot()).files.filter(file => !file.path.startsWith('.expec/')).map(file => file.path).sort()).toEqual([...paths].sort()); }
  expectReadContains(text: string): void { expect(this.readResult.artifacts.map(artifact => Buffer.from(artifact.file.bytes).toString()).join('\n')).toContain(text); }
  expectReadIncludesWholeFile(path: string): void {
    const found = this.readResult.artifacts.find(artifact => artifact.file.path === path); expect(found).toBeDefined();
    expect(Buffer.from(found!.file.bytes).toString()).toBe(readFileSync(this.path(path), 'utf8'));
  }
  expectReadFiles(paths: string[]): void { expect([...new Set(this.readResult.artifacts.map(artifact => artifact.file.path))].sort()).toEqual([...paths].sort()); }
  expectAmbiguousDefinition(): void { expect(this.readResult.problems.map(problem => problem.code)).toContain('ambiguous-definition'); }
  expectReadNotFound(): void { expect(this.readResult.artifacts).toEqual([]); expect(this.readResult.problems.map(problem => problem.code)).toContain('output-not-found'); }
  expectReadWithoutProblems(): void { expect(this.readResult.problems).toEqual([]); }
  expectDefinition(path: string): void { expect(this.searchResult.definitions.map(pathOf)).toContain(path); }
  expectProjectConsumer(path: string): void { expect(this.searchResult.incoming.uses.some(use => use.target.kind === 'project' && pathOf(use.at) === path)).toBe(true); }
  expectNoProjectConsumer(path: string): void { expect(this.searchResult.incoming.uses.some(use => pathOf(use.at) === path)).toBe(false); }
  expectCoverageLimitedTo(text: string): void { expect(JSON.stringify(this.searchResult.incoming.coverage.scope)).toContain(text); }
  expectCompleteWithinScope(text: string): void { this.expectCoverageLimitedTo(text); expect(this.searchResult.incoming.coverage.complete).toBe(true); expect(this.searchResult.outgoing.coverage.complete).toBe(true); }
  expectUnresolvedLink(text: string): void { expect(JSON.stringify(this.searchResult.outgoing.unresolved)).toContain(text); }
  expectIncompleteOutgoingCoverage(): void { expect(this.searchResult.outgoing.coverage.complete).toBe(false); }
  expectNoProjectOutgoing(): void { expect(this.searchResult.outgoing.uses.filter(use => use.target.kind === 'project')).toEqual([]); }
  expectNoObservedIncomingUses(): void { expect(this.searchResult.incoming.uses).toEqual([]); }
  expectIncompleteIncomingCoverageAt(path: string): void { expect(this.searchResult.incoming.coverage.complete).toBe(false); expect(JSON.stringify(this.searchResult)).toContain(path); }
  expectSpecifiedOutgoing(names: string[]): void { expect([...new Set(this.searchResult.outgoing.uses.flatMap(use => use.target.kind === 'specified' ? [use.target.id] : []))].sort()).toEqual(names.map(name => this.identifier(name)).sort()); }
  expectNoSpecifiedOutgoing(name: string): void { expect(this.searchResult.outgoing.uses.some(use => use.target.kind === 'specified' && use.target.id === this.identifier(name))).toBe(false); }
  expectComparison(expected: { matched: string[]; unobserved: string[]; projectOnly: string[] }): void {
    expect(this.compared.value, JSON.stringify(this.compared)).toBeDefined();
    const value = this.compared.value!;
    expect(value.matched.map(item => item.id)).toEqual(expected.matched.map(name => this.identifier(name)));
    expect(value.unobserved).toEqual(expected.unobserved.map(name => this.identifier(name)));
    expect(value.observedOnly.flatMap(item => item.target.kind === 'project' ? [item.target.id] : [])).toEqual(expected.projectOnly);
  }
  expectPlannedFile(path: string): void { expect(this.planResult.value?.changes.some(change => change.kind === 'write' && change.path === path), JSON.stringify(this.planResult)).toBe(true); }
  expectStoppedFor(code: string): void { this.expectReceipt('stopped'); this.expectProblem(code); }
  expectNoConfirmedAssociationProposal(): void { expect(this.written.artifacts).toBeUndefined(); }
  expectConfirmedAssociation(name: string, path: string): void { expect(this.written.artifacts?.some(link => link.specId === this.identifier(name) && pathOf(link.locator) === path)).toBe(true); }
  expectNoConfirmedAssociation(name: string): void { expect(this.written.artifacts?.some(link => link.specId === this.identifier(name))).toBe(false); }
  expectSameIdentifier(name: string): void { expect(this.identifier(name)).toBe(this.savedIdentifier); }
  expectHostDiffHasNoSourceChanges(): void { expect(this.diff.changes).toEqual([]); }
  expectDisjointFileChangesIncludingState(): void {
    const paths = this.plans.flatMap(plan => plan.changes.flatMap(change => change.kind === 'move' ? [change.from, change.to] : [change.path]));
    expect(new Set(paths).size).toBe(paths.length); expect(paths.filter(path => path.startsWith('.expec/outputs/'))).toHaveLength(2);
  }
  expectIntersectingPath(path: string): void { expect(this.plans.filter(plan => plan.changes.some(change => 'path' in change && change.path === path))).toHaveLength(2); }
  expectAssociationNamespaces(ids: string[]): void { expect([...new Set(this.current.baseline.artifacts.map(link => link.locator.outputId))].sort()).toEqual([...ids].sort()); }
  async expectGlobalIdentityFileUnchangedByOutputs(): Promise<void> { expect(await this.content('.expec/identity.json')).toBe(this.globalBefore); }
  async expectCapability(owner: string, text: string): Promise<void> { expect(await this.content(`${this.selected.options.directory}/${owner}.md`)).toContain(text); }
  async expectNoCapability(owner: string, name: string): Promise<void> { expect(await this.content(`${this.selected.options.directory}/${owner}.md`)).not.toContain(name + '('); }
  expectAppliedArtifactAndUnappliedState(): void {
    const outcomes = this.written.receipt!.outcomes;
    expect(outcomes.some(outcome => outcome.change.kind === 'write' && outcome.change.path.endsWith('StoreGame.md') && outcome.state === 'applied')).toBe(true);
    expect(outcomes.some(outcome => outcome.change.kind === 'write' && outcome.change.path === this.statePath() && outcome.state === 'not-applied')).toBe(true);
  }
  expectPreviousArtifactBytesAvailable(): void { expect(this.written.receipt!.outcomes.flatMap(outcome => outcome.before).some(file => file.state === 'file' && Buffer.from(file.bytes).toString().includes("Save the player's snapshot"))).toBe(true); }
  expectContractError(constructor: typeof TypeError): void { expect(this.error).toBeInstanceOf(constructor); }
  expectWriterWasNotInvoked(): void { expect(this.writerCalls).toBe(0); }
  async expectStructuredDeclaration(path: string, expected: { name: string; kind: string; dependencies?: string[]; capabilities?: string[] }): Promise<void> {
    const actual = JSON.parse(await this.content(path)); expect(actual.format).toBe('expec-structure-1'); expect(actual.outputId).toBe('structure-list');
    expect(actual.declaration).toMatchObject({ name: expected.name, kind: expected.kind });
    if (expected.dependencies) expect(actual.declaration.references.filter((item: { role: string }) => item.role === 'dependency').map((item: { specId: string }) => item.specId)).toEqual(expected.dependencies.map(name => this.identifier(name)));
    if (expected.capabilities) expect(actual.declaration.members.filter((item: { kind: string }) => item.kind === 'capability').map((item: { signature: string }) => item.signature)).toEqual(expected.capabilities);
  }
  async expectStructuredCapability(owner: string, signature: string): Promise<void> { const actual = JSON.parse(await this.content(`${this.selected.options.directory}/${owner}.structure.json`)); expect(actual.declaration.members.map((item: { signature?: string }) => item.signature)).toContain(signature); }
  async expectNoStructuredCapability(owner: string, name: string): Promise<void> { const actual = JSON.parse(await this.content(`${this.selected.options.directory}/${owner}.structure.json`)); expect(actual.declaration.members.map((item: { name: string }) => item.name)).not.toContain(name); }
  async expectStructuredError(name: string, fields: string[]): Promise<void> {
    const actual = JSON.parse(await this.content(`${this.selected.options.directory}/${name}.structure.json`)).declaration;
    expect(actual).toMatchObject({ kind: 'record-type', error: true, name });
    expect(actual.members.map((field: { signature: string }) => field.signature)).toEqual(fields);
  }
  async expectStructuredCallable(name: string, expected: { signature: string; result: string; failures: string[] }): Promise<void> {
    const actual = JSON.parse(await this.content(`${this.selected.options.directory}/${name}.structure.json`)).declaration;
    expect(actual.signature).toBe(expected.signature);
    expect(actual.references.filter((reference: { role: string }) => reference.role === 'output')).toEqual([{ role: 'output', specId: this.identifier(expected.result) }]);
    expect(actual.references.filter((reference: { role: string }) => reference.role === 'failure')).toEqual(expected.failures.map(name => ({ role: 'failure', specId: this.identifier(name) })));
  }
}
