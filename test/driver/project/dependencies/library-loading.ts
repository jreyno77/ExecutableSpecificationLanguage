import { promises as fs } from 'node:fs';
import childProcess from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { vi } from 'vitest';
import { Compiler, DependencyPlanner, ExternalModel, LangiumModel, LangiumReader, LibraryLoader, QueryInspection,
  SourceComposer, TypeDescriber, type Check, type Configuration, type ExternalDefinition, type LibraryLoad,
  type ResolutionDependencies, type Diagnostic } from '../../../../src/index.js';
import { SourceLoadingDriver } from '../connection/source-loading.js';
import type { NativePackageDriver } from './native-packages.js';

/** Loads real files/models and retains actual reports for the acquisition examples. */
export class LibraryLoadingDriver extends SourceLoadingDriver {
  readonly requirements: Configuration['libraries'][number][] = [];
  readonly packageRequirements: Configuration['packages'][number][] = [];
  native: NativePackageDriver | undefined;
  availablePackages: { name: string; version: string }[] = [];
  readonly loads = new Map<string, LibraryLoad>();
  readonly opened = vi.spyOn(fs, 'open');
  readonly spawned = vi.spyOn(childProcess, 'spawn');
  libraries!: LibraryLoad;
  selected!: Check<ResolutionDependencies>;
  last!: Check<unknown>;

  async initialize(): Promise<void> { await mkdir(this.directory); }
  async library(name: string, version: string, sources: Record<string, string>): Promise<void> {
    await this.file(`libraries/${name}/package.json`, JSON.stringify({ name, version, expec: { entry: './index.expec' } }));
    for (const [file, text] of Object.entries(sources)) await this.file(`libraries/${name}/${file}`, text);
  }
  async external(name: string, version: string, definitions: unknown): Promise<void> {
    await this.file(`libraries/${name}/package.json`, JSON.stringify({ name, version,
      main: './run.cjs', expec: { declarations: './declarations.json' } }));
    await this.file(`libraries/${name}/run.cjs`, 'require("node:fs").writeFileSync(__dirname + "/executed.txt", "ran");');
    await this.file(`libraries/${name}/declarations.json`, JSON.stringify(definitions));
  }
  requireLibrary(module: string, version: string, source?: string): void {
    const item = { module, version, ...(source === undefined ? {} : { source }) }, index = this.requirements.findIndex(value => value.module === module);
    if (index < 0) this.requirements.push(item); else this.requirements[index] = item;
  }
  async loadLibraries(): Promise<void> {
    const settings = { build: { entries: ['main.expec'] }, libraries: this.requirements, packages: this.packageRequirements };
    this.configure('expec.json', settings);
    await this.file('expec.json', JSON.stringify({ formatVersion: 1, version: '0.1.0', ...settings }));
    this.last = this.libraries = await new LibraryLoader(this.manifest).load(this.configuration);
  }
  selectDependencies(): void {
    this.last = this.selected = new DependencyPlanner().resolve(this.configuration, {
      modules: [...this.libraries.value?.inventory ?? [], ...this.modules], packages: this.availablePackages,
    });
  }
  async loadWorkspace(): Promise<void> {
    if (!this.selected.value) throw Error('No selected dependencies: ' + JSON.stringify(this.selected));
    const load = await this.loader.load(this.configuration, this.selected.value, this.libraries.value);
    const compilations = new Map<string, ReturnType<SourceLoadingDriver['compiled']>>();
    this.current = { load, compilations }; this.last = load;
    if (load.value) for (const input of load.value.entries) {
      const resolution = new SourceComposer(load.value.locate).compose(input.entry, input.dependencies);
      const compilation = new Compiler().compile({ resolution });
      compilations.set(input.entry.locator, { resolution, compilation,
        types: compilation.value?.types ?? new TypeDescriber().describe(resolution) });
      this.last = compilation;
    }
  }
  async loadAndCompile(): Promise<void> {
    await this.loadLibraries();
    if (!this.libraries.value) return;
    if (this.native) {
      const packages = await this.native.client.read(this.configuration.packages); this.last = packages;
      if (!packages.value) return;
      this.availablePackages = [...packages.value];
    }
    this.selectDependencies();
    if (this.selected.value) await this.loadWorkspace();
  }
  override moduleKey(name: string): string {
    return this.libraries?.value?.inventory.some(item => item.model.locator === name) ? name : super.moduleKey(name);
  }
  captures() { return this.libraries.captures; }
  fields(name: string, report = this.libraries): string[] {
    const model = report.value?.inventory[0]?.model;
    if (!model) throw Error('No loaded model: ' + JSON.stringify(report));
    const inspection = new QueryInspection(model), declaration = [...inspection.query('record-type-declaration')].find(item => item.name === name);
    if (!declaration) throw Error('No record ' + name);
    return declaration.fields.filter(field => field.kind === 'field').map(field => field.name);
  }
  findings(): readonly Diagnostic[] { return this.last.problems; }
  replaceSelected(module: string, text: string): void {
    this.selectDependencies();
    const parsed = new LangiumReader().read({ sourceId: 'replacement.expec', text });
    if (parsed.status !== 'accepted' || !this.selected.value) throw Error('Invalid replacement fixture');
    this.selected = { ...this.selected, value: { ...this.selected.value, modules: this.selected.value.modules.map(model =>
      model.locator === module ? new LangiumModel(module, parsed.document) : model) } };
  }
  supply(module: string, version: string, definitions: readonly ExternalDefinition[]): void {
    this.modules.push({ version, model: new ExternalModel(module, definitions) });
  }
}
