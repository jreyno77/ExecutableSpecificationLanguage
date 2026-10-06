import { afterEach, expect } from 'vitest';
import { ExporterDriver } from '../../driver/package/exporter-author.js';
const active: ExporterAuthor[] = [];
afterEach(async () => { for (const item of active.splice(0)) await item.driver.package.dispose(); });

export class ExporterAuthor {
  readonly driver = new ExporterDriver();
  private identity = '';
  private note = '';
  static async installPackedProduct(): Promise<ExporterAuthor> {
    const author = new ExporterAuthor(); active.push(author); await author.driver.install(); return author;
  }
  static async generatedSignatures(options: { host?: 'cli' | 'library' } = {}): Promise<ExporterAuthor> {
    const author = await this.installPackedProduct();
    await author.writeIndependentSignaturesOutput(); await author.compilePublicTypes();
    await author.source('function save(snapshot: Text) returns Nothing');
    if (options.host === 'library') await author.driver.consumer('create');
    else { await author.runCustomLauncher({ contracts: ['signatures'], destination: 'contracts.ndjson' }); author.expectBuildSucceeded(); }
    await author.expectSignatureRecord('contracts.ndjson', 'save(snapshot: Text) returns Nothing');
    return author;
  }
  writeIndependentSignaturesOutput(): Promise<void> { return this.driver.copySample(); }
  async compilePublicTypes(): Promise<void> { await this.driver.compile(); expect(this.driver.result.code, this.driver.result.stdout + this.driver.result.stderr).toBe(0); }
  source(text: string): Promise<void> { return this.driver.file('main.expec', text); }
  async runCustomLauncher(profile: { contracts: string[]; destination: string }): Promise<void> {
    expect(profile).toEqual({ contracts: ['signatures'], destination: 'contracts.ndjson' });
    await this.driver.consumer('cli', this.driver.decisions ? 'decisions.json' : undefined);
  }
  async expectSignatureRecord(file: string, text: string): Promise<void> {
    expect(await this.driver.records(file), JSON.stringify(this.driver.report)).toContainEqual({ kind: 'signature', id: expect.any(String), text });
  }
  async expectNoCompilerChangesOrPrivateImports(): Promise<void> {
    const source = await this.driver.text('signatures-output.ts');
    expect(source).toContain("from 'executable-specification-language'");
    expect(source).not.toMatch(/from ['"][^'"]*(?:src\/|dist\/)/);
    await this.driver.consumer('imports');
    expect(this.driver.report.privateDenied).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
    expect(new URL(this.driver.report.entry).pathname).toContain('/node_modules/executable-specification-language/dist/');
    expect(await this.driver.text('node_modules/executable-specification-language/dist/compiler/compiler.js')).toBe(this.driver.compilerBytes);
  }
  async rememberProjectFiles(): Promise<void> { this.driver.remembered = await this.driver.projectFiles(); }
  async expectProjectFilesUnchanged(): Promise<void> { expect(await this.driver.projectFiles()).toEqual(this.driver.remembered); }
  async appendAuthoredNote(name: string, text: string): Promise<void> {
    this.note = JSON.stringify({ kind: 'note', id: await this.driver.id(name), text }) + '\n';
    await this.driver.file('project/contracts.ndjson', await this.driver.text('project/contracts.ndjson') + this.note);
  }
  async addFormatLink(file: string, name: string): Promise<void> { await this.writeCapturedFile(file, JSON.stringify({ kind: 'use', id: await this.driver.id(name) }) + '\n'); }
  writeCapturedFile(file: string, text: string): Promise<void> { return this.driver.file('project/' + file, text); }
  async readAndSearch(name: string): Promise<void> { await this.driver.consumer('query', await this.driver.id(name)); }
  search(name: string): Promise<void> { return this.readAndSearch(name); }
  async expectCurrentReadContains(text: string): Promise<void> {
    const read = this.driver.report.read;
    expect(read.coverage.complete).toBe(true); expect(read.problems).toEqual([]);
    const actual = read.artifacts.find(row => row.file.path === 'contracts.ndjson');
    expect(actual?.text).toBe(await this.driver.text('project/contracts.ndjson')); expect(actual?.text).toContain(text);
  }
  async expectActualFormatReference(file: string, name: string): Promise<void> {
    const id = await this.driver.id(name), text = await this.driver.text('project/' + file);
    const use = this.driver.report.search.incoming.uses.find(row => row.at.value.file === file);
    expect(use).toBeDefined(); if (!use) throw Error('The format use was not found.'); expect(use.target).toEqual({ kind: 'project', id: file });
    const at = use.at.value; expect(text.slice(at.start, at.end)).toBe(JSON.stringify({ kind: 'use', id }));
  }
  expectCoverageLimitedToDocumentedFormat(): void {
    const coverage = this.driver.report.search.incoming.coverage;
    expect(coverage.complete).toBe(true);
    expect(coverage.scope.every((at: { format: string; value: { format: string } }) => at.format === 'signatures-format-1' && at.value.format === 'ndjson')).toBe(true);
    expect(coverage.scope.length).toBeGreaterThan(0);
  }
  async rememberSignatureIdentity(name: string): Promise<void> { this.identity = await this.driver.id(name); }
  async renameFunction(before: string, after: string): Promise<void> {
    const id = await this.driver.id(before); await this.source('function ' + after + '(snapshot: Text) returns Nothing');
    await this.driver.file('decisions.json', JSON.stringify({ format: 1, matches: [{ id, to: { source: 'main.expec', line: 1, column: 1 } }], retire: [] }));
    this.driver.decisions = true;
  }
  expectBuildSucceeded(): void { expect(this.driver.result.code, JSON.stringify(this.driver.report)).toBe(0); expect(this.driver.report.status).toBe('built'); }
  async expectSameSignatureIdentity(name: string): Promise<void> { expect(await this.driver.id(name)).toBe(this.identity); }
  async expectExactRetainedNote(text: string): Promise<void> {
    expect(this.note).toContain(text); expect(await this.driver.text('project/contracts.ndjson')).toContain(this.note);
  }
  expectIncompleteCoverageAt(file: string, line: number): void {
    const search = this.driver.report.search;
    expect(search.incoming.coverage.complete).toBe(false);
    expect(search.problems.some((problem: { at: { path?: unknown[] } }) => problem.at.path?.includes(file) && problem.at.path.includes(line))).toBe(true);
  }
  async copySignatureDefinition(name: string, file: string): Promise<void> {
    const row = (await this.driver.records()).find(row => row.id === this.identity || row.text?.startsWith(name + '('));
    expect(row).toBeDefined(); await this.writeCapturedFile(file, JSON.stringify(row) + '\n');
  }
  expectCompetingDefinitions(files: string[]): void { expect(this.driver.report.search.definitions.map((at: { value: { file: string } }) => at.value.file).sort()).toEqual([...files].sort()); }
  async registerDuplicateOutput(id: string): Promise<void> { expect(id).toBe('signatures'); await this.driver.consumer('duplicate'); }
  expectDuplicateRegistrationRejected(): void { expect(this.driver.report.message).toContain('unique nonblank output ID'); }
  async addCheckedInteraction(): Promise<void> {
    await this.source('function save(snapshot: Text) returns Nothing\nconcept Screen {}\nconcept Storage { public save\ncapability save(snapshot: Text) returns Nothing }\ninteraction "save request"() { participant screen: Screen\nparticipant storage: Storage\nmessage screen -> storage.save("Dune") }');
  }
  async expectUnsupportedInteraction(): Promise<void> {
    expect(this.driver.result.code).toBe(1);
    expect(this.driver.report.syntax).toEqual([]); expect(this.driver.report.deferred).toEqual([]);
    expect(this.driver.report.problems).toHaveLength(1);
    const diagnostic = this.driver.report.problems[0]!;
    expect(diagnostic.code).toBe('unsupported-signatures'); expect(diagnostic.at.kind).toBe('source');
    const source = await this.driver.text('main.expec'), range = diagnostic.at.range!;
    expect(range.sourceId).toContain('main.expec');
    expect(source.slice(range.start.offset, range.end.offset)).toContain('interaction "save request"');
  }
  async prepareRenamePlan(before: string, after: string): Promise<void> {
    const id = await this.driver.id(before); await this.renameFunction(before, after);
    await this.driver.consumer('plan', id); expect(this.driver.report.changes).toBe(1);
  }
  async applyPreparedPlan(): Promise<void> { await this.driver.consumer('apply'); }
  expectStoppedStaleWrite(): void {
    expect(this.driver.report.status).toBe('stopped');
    expect(this.driver.report.problems.some((problem: { code: string }) => problem.code === 'stale-project')).toBe(true);
  }
}
