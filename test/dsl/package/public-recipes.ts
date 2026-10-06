import { afterEach, expect } from 'vitest';
import { PublicRecipesDriver } from '../../driver/package/public-recipes.js';
const active: PublicRecipes[] = [];
afterEach(async () => { for (const author of active.splice(0)) await author.driver.package.dispose(); });

export class PublicRecipes {
  readonly driver = new PublicRecipesDriver();
  static async installPackedProduct(): Promise<PublicRecipes> {
    const author = new PublicRecipes(); active.push(author); await author.driver.install(); return author;
  }
  async sources(files: Record<string, string>): Promise<void> { for (const [name, text] of Object.entries(files)) await this.driver.file(name, text); }
  source(text: string): Promise<void> { return this.driver.file('main.expec', text); }
  nativeFile(path: string, text: string): Promise<void> { return this.driver.file('project/' + path, text); }
  async runWorkspaceRecipe(entries: string[]): Promise<void> {
    await this.driver.manifest(entries); await this.driver.consumer('workspace'); this.expectConfirmed();
  }
  private expectConfirmed(): void {
    const written = this.driver.report.written;
    expect(written.problems, JSON.stringify({ ...written, receipt: written.receipt && {
      status: written.receipt.status, problems: written.receipt.problems,
      outcomes: written.receipt.outcomes.map(outcome => ({ kind: outcome.change.kind, state: outcome.state, ...outcome.change.kind === 'move'
        ? { from: outcome.change.from, to: outcome.change.to } : { path: outcome.change.path } })),
    } })).toEqual([]);
    expect(['applied', 'unchanged']).toContain(this.driver.report.written.receipt?.status);
    expect(this.driver.report.written.artifacts?.length).toBeGreaterThan(0);
  }
  expectFunctions(names: string[]): void { expect(this.driver.report.functions.sort()).toEqual([...names].sort()); }
  expectOneSharedTypeIdentity(name: string): void {
    expect(name).toBe('Book'); expect(this.driver.report.books).toHaveLength(1);
    expect(this.driver.report.allParametersUseBook).toBe(true); expect(this.driver.report.bookRecords).toBe(1);
  }
  async expectOneGeneratedDeclaration(name: string): Promise<void> {
    await this.driver.consumer('native'); expect(this.driver.report.declarations.filter(declaration => declaration.name === name)).toHaveLength(1);
  }
  async checkNativeConsumer(text: string): Promise<void> {
    await this.driver.file('project/consumer.ts', text); await this.driver.run(['node_modules/typescript/bin/tsc', '--project', 'project/tsconfig.json']);
  }
  expectNativeTypecheckPassed(): void { expect(this.driver.result.code, this.driver.result.stdout + this.driver.result.stderr).toBe(0); }
  async rememberNativeFiles(): Promise<void> { this.driver.remembered = await this.driver.nativeFiles(); }
  async runAdoptionRecipe(): Promise<void> { await this.driver.consumer('adopt'); this.expectConfirmed(); }
  async expectAdoptionLeftNativeFilesUnchanged(): Promise<void> { expect(await this.driver.nativeFiles()).toEqual(this.driver.remembered); }
  readAndSearchStoreGame(): Promise<void> { return this.driver.consumer('read'); }
  async expectWholeCurrentFileContains(text: string): Promise<void> {
    const report = this.driver.report.read; expect(report.problems).toEqual([]); expect(report.coverage.complete).toBe(true);
    const file = report.artifacts.find(artifact => artifact.file.path === 'src/game.ts');
    expect(file?.text).toBe(await this.driver.text('project/src/game.ts')); expect(file?.text).toContain(text);
  }
  async expectUnspecifiedCallerAt(file: string, token: string): Promise<void> {
    const search = this.driver.report.search; expect(search.problems).toEqual([]); expect(search.incoming.coverage.complete).toBe(true);
    const uses = search.incoming.uses.filter(use => (use.at.value as { file?: string }).file === file);
    expect(uses).toHaveLength(1);
    const use = uses[0]!; expect(use.target.kind).toBe('project'); expect(use.at.format).toBe('typescript-site-1');
    const at = use.at.value as { start: number; end: number; role: string };
    expect(at.role).toBe('call'); expect((await this.driver.text('project/' + file)).slice(at.start, at.end)).toBe(token);
  }
  async expectOnlyHostOwnedPublicBaseline(): Promise<void> {
    await this.driver.consumer('baseline'); expect(this.driver.report.valid).toBe(true);
    expect(this.driver.report.artifacts.some(artifact => artifact.locator.format === 'typescript-symbol-1')).toBe(true);
    expect(await this.driver.baselineAbsent('project/.expec/identity.json')).toBe(true);
  }
}
