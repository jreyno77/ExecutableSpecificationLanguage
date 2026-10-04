import { readFile, stat, unlink } from 'node:fs/promises';
import { expect } from 'vitest';
import { PythonCliDriver } from '../driver/python-cli.js';

const active: PythonCliDriver[] = [];
export class PythonDelivery {
  private lock?: Buffer;
  private environment?: Buffer;
  private generated?: Buffer;
  private constructor(private readonly driver: PythonCliDriver) {}
  static prepare = PythonCliDriver.prepare;
  static async emptyDestination(): Promise<PythonDelivery> {
    const driver = new PythonCliDriver(); active.push(driver); await driver.initialize(false);
    await driver.write('spec/main.expec', 'concept StoreGame {}'); return new PythonDelivery(driver);
  }
  static async initialized(): Promise<PythonDelivery> {
    const project = await this.emptyDestination(); await project.driver.arrangeStarter(); return project;
  }
  static async dispose(): Promise<void> { for (const driver of active.splice(0)) await driver.dispose(); }
  file(path: string, text: string): Promise<void> { return this.driver.write('project/' + path, text); }
  readonlySource(text: string): Promise<void> { return this.driver.readonlySource(text); }
  removeDistributionInventory(name: string): Promise<void> { return this.driver.removeDistributionInventory(name); }
  async expectPhaseProblemAt(code: string, file: string, token: string): Promise<void> {
    this.expectProblem(code);
    const problem = this.driver.report.problems.find((problem: { code: string; at?: { path?: unknown[] } }) => problem.code === code && problem.at?.path?.includes(file));
    expect(problem, this.driver.result.stdout).toBeDefined();
    const start = problem.at.path.at(-1);
    expect(typeof start).toBe('number');
    expect((await readFile(this.driver.path('project/' + file), 'utf8')).slice(start, start + token.length)).toBe(token);
  }
  source(text: string): Promise<void> { return this.driver.write('spec/main.expec', text); }
  async useShoppingOutput(): Promise<void> { await this.output('python-acceptance', { domain: 'shopping' }); }
  implementBasket(copies: number): Promise<void> { return this.driver.implementBasket(copies); }
  captureNativeProject(): Promise<void> { return this.driver.captureNativeProject(); }
  expectNativeCaptureComplete(): void {
    expect(this.driver.nativeSnapshot?.complete, JSON.stringify(this.driver.nativeSnapshot?.problems)).toBe(true);
    expect(this.driver.nativeSnapshot?.nativeInputs?.length).toBeGreaterThan(0);
  }
  expectBuildUnchanged(): void {
    expect(this.driver.result.code, this.driver.result.stdout + this.driver.result.stderr).toBe(0);
    expect(this.driver.report.status).toBe('built');
    expect(this.driver.report.stages.map((stage: { name: string; status: string }) => [stage.name, stage.status]))
      .toEqual([['contracts', 'unchanged'], ['tests', 'unchanged']]);
  }
  cacheCurrentApplication(): Promise<void> { return this.driver.cacheCurrentBasket(); }
  keepOldBytecodeWhileBasketNowAdds(copies: number): Promise<void> { return this.driver.staleBasketBytecode(copies); }
  expectOrdinaryCachedQuantity(value: number): void { expect(this.driver.cachedQuantity).toBe(value); }
  saveQuantityTo(path: string): Promise<void> { return this.driver.basketWritesData(path); }
  changeOwnApplicationSourceAfterAddingBook(): Promise<void> { return this.driver.basketChangesSource(); }
  forgetScenarioAssociation(title: string): Promise<void> { return this.driver.forgetScenarioAssociation(title); }
  async expectRuntimeData(path: string, value: unknown): Promise<void> {
    expect(JSON.parse(await readFile(this.driver.path('project/' + path), 'utf8'))).toEqual(value);
  }
  expectNativeScenarioPassedButCommandFailed(): void {
    expect(this.driver.result.code, this.driver.result.stdout).toBe(1);
    const execution = this.driver.report.stages.find((stage: { name: string }) => stage.name === 'execution');
    expect(execution, this.driver.result.stdout).toMatchObject({ native: { exitCode: 0 }, tests: [expect.objectContaining({ state: 'passed' })] });
  }
  async expectApplicationSourceChanged(): Promise<void> { expect((await readFile(this.driver.path('project/src/basket.py'), 'utf8')).replaceAll('\r\n', '\n').endsWith('\n# Changed during the test\n')).toBe(true); }
  async removeGeneratedScenarioFile(): Promise<void> {
    const identity = this.driver.path('project/.expec/identity.json'), before = await readFile(identity);
    await unlink(this.driver.path('project/test/acceptance/test_shopping.py'));
    expect(await readFile(identity)).toEqual(before);
  }
  expectUnavailableScenario(): void {
    expect(this.driver.result.code, this.driver.result.stdout + this.driver.result.stderr).toBe(1);
    expect(this.driver.report.problems.length).toBeGreaterThan(0); this.expectNoNativeExecution();
  }
  expectNoNativeExecution(): void { expect(this.driver.report.stages).toEqual([]); }
  preventNativeCollection(): Promise<void> {
    return this.file('conftest.py', 'def pytest_collection_modifyitems(items):\n    items.clear()\n');
  }
  expectNoCaseWasExecuted(): void {
    expect(this.driver.result.code, this.driver.result.stdout).toBe(1);
    expect(this.driver.report.stages).toHaveLength(1);
    expect(this.driver.report.stages[0]).toMatchObject({ name: 'execution', status: 'failed', collected: [],
      tests: [expect.objectContaining({ state: 'incomplete', phases: [] })] });
    expect(this.driver.report.stages[0].native.exitCode).not.toBe(0);
  }
  async rootFixtureChangesItself(): Promise<void> {
    await this.file('conftest.py', `from pathlib import Path
from typing import Iterator
import pytest

@pytest.fixture(autouse=True)
def root_resource() -> Iterator[None]:
    yield
    source = Path(__file__)
    source.write_text(source.read_text(encoding="utf-8") + "\\n# Changed root fixture\\n", encoding="utf-8")
`);
  }
  async expectRootFixtureChanged(): Promise<void> { expect((await readFile(this.driver.path('project/conftest.py'), 'utf8')).replaceAll('\r\n', '\n').endsWith('\n# Changed root fixture\n'), this.driver.result.stdout + this.driver.result.stderr).toBe(true); }

  async unrelatedFailingTest(): Promise<void> {
    await this.driver.write('project/test/unrelated/test_unrelated.py', 'from pathlib import Path\n\ndef test_unrelated() -> None:\n    Path("unrelated-ran").write_text("ran")\n    assert False, "The unrelated test ran"\n');
  }
  expectInstalled(): void {
    expect(this.driver.result.code, this.driver.result.stdout + this.driver.result.stderr).toBe(0);
    expect(this.driver.report.status).toBe('installed');
  }
  expectBuilt(): void {
    expect(this.driver.result.code, this.driver.result.stdout + this.driver.result.stderr).toBe(0);
    expect(this.driver.report.status).toBe('built');
    expect(this.driver.report.stages.map((stage: { name: string; status: string }) => [stage.name, stage.status]))
      .toEqual([['contracts', 'applied'], ['tests', 'applied']]);
  }
  async rememberGeneratedTest(): Promise<void> { this.generated = await readFile(this.driver.path('project/test/acceptance/test_shopping.py')); }
  async expectGeneratedTestUnchanged(): Promise<void> { expect(await readFile(this.driver.path('project/test/acceptance/test_shopping.py'))).toEqual(this.generated); }
  async expectOnlyScenarioPassed(title: string): Promise<void> {
    expect(this.driver.result.code, this.driver.result.stdout + this.driver.result.stderr).toBe(0);
    expect(this.driver.report.status).toBe('tested');
    expect(this.driver.report.stages).toHaveLength(1);
    const execution = this.driver.report.stages[0];
    expect(execution.name).toBe('execution'); expect(execution.status).toBe('passed');
    expect(execution.tests).toHaveLength(1);
    expect(execution.tests[0]).toMatchObject({ title, state: 'passed', errors: [] });
    expect(execution.collected).toHaveLength(1); expect(execution.errors).toEqual([]);
    expect(execution.native.exitCode).toBe(0);
    await expect(stat(this.driver.path('project/unrelated-ran'))).rejects.toMatchObject({ code: 'ENOENT' });
  }
  expectWrongQuantity(expected: number, actual: number): void {
    expect(this.driver.result.code, this.driver.result.stdout + this.driver.result.stderr).toBe(1);
    expect(this.driver.report.status).toBe('failed');
    const execution = this.driver.report.stages.find((stage: { name: string }) => stage.name === 'execution');
    expect(execution, this.driver.result.stdout).toBeDefined(); expect(execution.tests).toHaveLength(1);
    expect(execution.tests[0]).toMatchObject({ state: 'failed' });
    expect(JSON.stringify(execution.tests[0].errors)).toContain('Expected ' + expected);
    expect(JSON.stringify(execution.tests[0].errors)).toContain('actual ' + actual);
    expect(execution.native.exitCode).not.toBe(0);
  }
  init(): Promise<void> { return this.driver.initializeThroughCli(); }
  install(): Promise<void> { return this.driver.run(['install', '--config', 'spec/expec.json', '--json'], '', undefined, 180_000); }
  installOffline(): Promise<void> { return this.driver.run(['install', '--offline', '--config', 'spec/expec.json', '--json'], '', undefined, 180_000); }
  check(): Promise<void> { return this.driver.run(['check', '--config', 'spec/expec.json', '--json'], '', undefined, 180_000); }
  build(): Promise<void> { return this.driver.run(['build', '--config', 'spec/expec.json', '--json'], '', undefined, 600_000); }
  test(): Promise<void> { return this.driver.run(['test', '--config', 'spec/expec.json', '--json'], '', undefined, 240_000); }
  expectChecked(): void {
    expect(this.driver.result.code, this.driver.result.stdout + this.driver.result.stderr).toBe(0);
    expect(this.driver.report).toMatchObject({ status: 'checked', problems: [], syntax: [], deferred: [], stages: [] });
  }
  async rememberInstalledEnvironment(): Promise<void> {
    await this.rememberLock(); this.environment = await readFile(this.driver.path('project/.expec/python/environment.json'));
  }
  async expectInstallRequiredWithoutEffects(): Promise<void> {
    this.expectProblem('python-install-required'); expect(this.driver.report.stages).toEqual([]);
    expect(await readFile(this.driver.path('project/uv.lock'))).toEqual(this.lock);
    expect(await readFile(this.driver.path('project/.expec/python/environment.json'))).toEqual(this.environment);
  }
  nativeRequirement(requirement: string): Promise<void> { return this.driver.nativeRequirement(requirement); }
  async removePackageRequirements(): Promise<void> { this.driver.manifest.packages = []; await this.driver.saveManifest(); }
  output(id: string, options: Record<string, unknown>): Promise<void> { return this.driver.output(id, options); }
  async outputs(outputs: { id: string; options: Record<string, unknown> }[]): Promise<void> { this.driver.manifest.outputs = outputs; await this.driver.saveManifest(); }
  requirePackage(alias: string, name: string, version: string, phase: string): Promise<void> { return this.driver.require(alias, name, version, phase); }
  async rememberNativeAndProjectFiles(): Promise<void> { this.driver.before = await this.driver.captureNativeFiles(); }
  async expectNativeAndProjectFilesUnchanged(): Promise<void> { expect(await this.driver.captureNativeFiles()).toEqual(this.driver.before); }
  expectProblem(code: string): void { expect(this.driver.result.code).toBe(1); expect(this.driver.report.problems).toContainEqual(expect.objectContaining({ code })); }
  expectRequestedSelectedInstalled(name: string, requested: string, selected: string, installed: string): void {
    expect(this.driver.result.code, this.driver.result.stdout + this.driver.result.stderr).toBe(0);
    expect(this.driver.report.status).toBe('installed');
    expect(this.driver.report.stages).toHaveLength(1);
    expect(this.driver.report.stages[0]).toMatchObject({ name: 'installation', status: 'applied',
      packages: { packages: expect.arrayContaining([{ name: 'pypi:' + name, requested, selected, installed }]), problems: [], deferred: [] } });
  }
  async expectNativePackageVersion(name: string, version: string): Promise<void> {
    expect(await this.driver.installedVersion(name)).toBe(version);
  }
  async expectNoEnvironmentInstalled(): Promise<void> {
    await expect(stat(this.driver.path('project/.venv'))).rejects.toMatchObject({ code: 'ENOENT' });
  }
  async expectNativeToolVersions(versions: Record<string, string>): Promise<void> {
    const report = JSON.parse(await readFile(this.driver.path('project/.expec/python/environment.json'), 'utf8'));
    expect(report).toMatchObject({ format: 1, uv: { version: versions.uv }, tools: {
      pytest: versions.pytest, mypy: versions.mypy, jedi: versions.jedi, libcst: versions.libcst,
    } });
    expect(report.pending).not.toBe(true); expect(report.environment.sites.length).toBeGreaterThan(0);
  }
  async rememberLock(): Promise<void> { this.lock = await readFile(this.driver.path('project/uv.lock')); }
  async expectLockUnchanged(): Promise<void> {
    expect(this.driver.result.code, this.driver.result.stdout + this.driver.result.stderr).toBe(0);
    expect(await readFile(this.driver.path('project/uv.lock'))).toEqual(this.lock);
  }
  async expectFailedInstallationWithActualEffects(): Promise<void> {
    this.expectProblem('package-install-failed'); expect(this.driver.report.status).toBe('installation-failed');
    const observed = this.driver.report.stages[0].packages;
    expect(observed.value).toBeUndefined();
    expect(observed.effects).toContainEqual(expect.objectContaining({ path: 'pyproject.toml', state: 'file' }));
    expect(observed.effects).toContainEqual(expect.objectContaining({ path: '.expec/python/environment.json', state: 'file' }));
    expect(await readFile(this.driver.path('project/pyproject.toml'), 'utf8')).toContain('expec-absent-distribution-028452991');
    expect(JSON.parse(await readFile(this.driver.path('project/.expec/python/environment.json'), 'utf8')).pending).toBe(true);
  }
  async expectConnectedStarterWithoutInstallation(): Promise<void> {
    expect(this.driver.result.code, this.driver.result.stdout + this.driver.result.stderr).toBe(0);
    expect(this.driver.report.status).toBe('initialized');
    expect(this.driver.report.stages.map((stage: { name: string; status: string }) => [stage.name, stage.status]))
      .toEqual([['initialization', 'applied'], ['configuration', 'applied']]);
    const manifest = JSON.parse(await readFile(this.driver.path('spec/expec.json'), 'utf8'));
    expect(manifest.project.root).toBe('../project');
    expect(manifest.outputs.map((output: { id: string }) => output.id)).toEqual(['python', 'python-acceptance']);
    const files = await this.driver.capture();
    expect(Object.keys(files).filter(path => path.startsWith('project/')).sort()).toEqual([
      'project/.gitignore', 'project/expec.python.json', 'project/pyproject.toml', 'project/src/__init__.py', 'project/test/__init__.py',
    ]);
    await expect(stat(this.driver.path('project/.venv'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(this.driver.path('project/expec.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(this.driver.path('spec/main.expec'), 'utf8')).toBe('concept StoreGame {}');
  }
}
