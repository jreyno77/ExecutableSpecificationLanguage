import { expect, onTestFinished } from 'vitest';
import type { Diagnostic, ExternalDefinition, PackagePhase } from '../../src/index.js';
import { ConfigurationDriver } from '../driver/configuration.js';

/** Author actions and independently supplied observations for project settings. */
export class ConfigurationExamples {
  private readonly driver = new ConfigurationDriver();
  private problem!: Diagnostic;

  output(id: string, fields?: Readonly<Record<string, 'nonempty text'>>): void { this.driver.output(id, fields); }
  manifest(value: unknown, sourceId?: string): void { this.driver.manifest(value, sourceId); }
  document(text: string): void { this.driver.document(text); }
  read(): void { this.driver.read(); }
  captureReader(label: string): void { this.driver.captureReader(label); }
  readWith(label: string): void { this.driver.read(label); }
  resolveDependencies(): void { this.driver.resolveDependencies(); }
  sourceModule(locator: string, version: string, text: string): void { this.driver.sourceModule(locator, version, text); }
  externalModule(locator: string, version: string, definitions: readonly ExternalDefinition[]): void { this.driver.externalModule(locator, version, definitions); }
  availablePackage(name: string, version: string): void { this.driver.availablePackage(name, version); }
  packageInventory(packages: readonly { name: string; version: string }[]): void { this.driver.packageInventory(packages); }
  compile(text: string): void { this.driver.compile(text); }
  rememberConfiguration(label: string): void { this.driver.rememberConfiguration(label); }
  rememberDependencies(label: string): void { this.driver.rememberDependencies(label); }

  expectConfiguration(): void {
    expect(this.driver.configurationReport()).toMatchObject({ problems: [], deferred: [] });
    expect(this.driver.configurationReport().value).toBeDefined();
  }
  expectNoConfiguration(): void {
    expect(this.driver.configurationReport().value).toBeUndefined();
    expect(this.driver.configurationReport().problems.length).toBeGreaterThan(0);
    expect(this.driver.configurationReport().deferred).toEqual([]);
  }
  expectVersion(version: string): void { expect(this.driver.configuration().version).toBe(version); }
  expectProject(root: string): void { expect(this.driver.configuration().project).toEqual({ root }); }
  expectNoProject(): void { expect(this.driver.configuration()).not.toHaveProperty('project'); }
  expectEntries(entries: string[]): void { expect(this.driver.configuration().build.entries).toEqual(entries); }
  expectOutput(id: string, options: Record<string, unknown>): void {
    expect(this.driver.configuration().outputs.filter(output => output.id === id)).toEqual([{ id, options }]);
  }
  expectOutputs(ids: string[]): void { expect(this.driver.configuration().outputs.map(output => output.id)).toEqual(ids); }
  expectLibraryRequirement(module: string, version: string): void {
    expect(this.driver.configuration().libraries.filter(library => library.module === module)).toEqual([{ module, version }]);
  }
  expectPackageRequirement(alias: string, name: string, version: string, phases: PackagePhase[]): void {
    expect(this.driver.configuration().packages.filter(item => item.alias === alias)).toEqual([{ alias, name, version, phases }]);
  }
  expectRequirements(requirements: { libraries: unknown[]; packages: unknown[] }): void {
    const { libraries, packages } = this.driver.configuration();
    expect({ libraries, packages }).toEqual(requirements);
  }
  expectManifestSource(sourceId: string): void { expect(this.driver.configuration().sourceId).toBe(sourceId); }
  expectManifestProblem(code: string, path: (string | number)[]): void { this.expectProblem(code, ['manifest', this.driver.sourceId(), ...path]); }
  expectInventoryProblem(code: string, path: (string | number)[]): void { this.expectProblem(code, ['inventory', ...path]); }
  private expectProblem(code: string, path: (string | number)[]): void {
    const problem = this.driver.findings().problems.find(item => item.code === code && item.at.kind === 'dependency' && JSON.stringify(item.at.path) === JSON.stringify(path));
    expect(problem, `Expected ${code} at ${JSON.stringify(path)}`).toBeDefined();
    this.problem = problem!;
  }
  expectRelatedManifestPath(path: (string | number)[]): void { this.expectRelated(['manifest', this.driver.sourceId(), ...path]); }
  expectRelatedInventoryPath(path: (string | number)[]): void { this.expectRelated(['inventory', ...path]); }
  expectRelatedCompilationPath(path: (string | number)[]): void { this.expectRelated(path); }
  private expectRelated(path: (string | number)[]): void { expect(this.problem.related).toContainEqual({ kind: 'dependency', path }); }
  expectProblemMentions(...parts: string[]): void { for (const part of parts) expect(this.problem.message).toContain(part); }

  expectDependencies(): void {
    expect(this.driver.dependencyReport()).toMatchObject({ problems: [], deferred: [] });
    expect(this.driver.dependencyReport().value).toBeDefined();
  }
  expectNoDependencies(): void {
    expect(this.driver.dependencyReport().value).toBeUndefined();
    expect(this.driver.dependencyReport().problems.length).toBeGreaterThan(0);
    expect(this.driver.dependencyReport().deferred).toEqual([]);
  }
  expectCompilerModules(modules: string[]): void { expect(this.driver.compilerInput().modules.map(module => module.locator)).toEqual(modules); }
  expectCompilerPackages(packages: readonly { alias: string; phases: readonly PackagePhase[] }[]): void {
    expect(this.driver.compilerInput().packages).toEqual(packages);
  }
  expectSuppliedModuleIdentity(locator: string): void {
    const selected = this.driver.compilerInput().modules.filter(module => module.locator === locator);
    expect(selected).toHaveLength(1);
    expect(selected[0]).toBe(this.driver.suppliedModule(locator));
  }
  expectCompiled(): void {
    expect(this.driver.compilation()).toMatchObject({ syntax: [], problems: [], deferred: [] });
    expect(this.driver.compilation().value).toBeDefined();
  }
  expectNoSpecification(): void { expect(this.driver.compilation().value).toBeUndefined(); }
  expectParameterType(callable: string, parameter: string, module: string, name: string): void {
    const observed = this.driver.parameterType(callable, parameter, module, name);
    expect(observed.actual).toBe(observed.expected);
    expect(observed.declaration).toBe(observed.supplied);
  }
  expectTypeOrigin(name: string, origin: { kind: 'external'; module: string }): void { expect(this.driver.typeOrigin(name)).toMatchObject(origin); }
  expectCompilationProblem(code: string, at?: { module: string; text: string; line: number }): void {
    const problem = this.driver.compilation().problems.find(item => item.code === code && (!at || JSON.stringify(this.driver.sourceLocation(item.at)) === JSON.stringify(at)));
    expect(problem, `Expected compilation problem ${code}${at ? ` at ${JSON.stringify(at)}` : ''}`).toBeDefined();
    this.problem = problem!;
  }
  expectRememberedConfiguration(label: string, expected: { root: string; version: string; outputs: string[] }): void {
    const { value } = this.driver.rememberedConfiguration(label);
    expect({ root: value.project?.root, version: value.version, outputs: value.outputs.map(output => output.id) }).toEqual(expected);
  }
  expectRememberedConfigurationUnchanged(label: string): void {
    const { value, snapshot } = this.driver.rememberedConfiguration(label);
    expect(value).toEqual(snapshot);
  }
  expectRememberedDependenciesUnchanged(label: string): void {
    const { value, modules, packages } = this.driver.rememberedDependencies(label);
    expect(value.modules).toHaveLength(modules.length);
    value.modules.forEach((module, index) => expect(module).toBe(modules[index]));
    expect(value.packages).toEqual(packages);
  }
  async existingFiles(files: Readonly<Record<string, string>>): Promise<void> {
    onTestFinished(() => this.driver.dispose());
    await this.driver.existingFiles(files);
  }
  fileLocation(path: string): string { return this.driver.fileLocation(path); }
  async expectFilesExactly(files: Readonly<Record<string, string>>): Promise<void> {
    const directories = new Set<string>();
    for (const name of Object.keys(files)) {
      const parts = name.split('/');
      while (parts.length > 1) { parts.pop(); directories.add(parts.join('/')); }
    }
    expect(await this.driver.files()).toEqual({ files, directories: [...directories].sort() });
  }
  async expectNoProjectCreated(root: string): Promise<void> { expect(await this.driver.projectExists(root)).toBe(false); }
}
