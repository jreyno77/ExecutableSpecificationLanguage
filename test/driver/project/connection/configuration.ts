import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  Compiler, ConfigurationReader, DependencyPlanner, ExternalModel, LangiumModel, LangiumReader,
  type Check, type Compilation, type Configuration, type DependencyInventory, type ExternalDefinition, type Item, type ModuleModel,
  type OutputProfile, type ProblemLocation, type ResolutionDependencies, type SourceDocument, type TypeFact,
} from '../../../../src/index.js';

/** Calls the real configuration/planning boundaries and projects their returned facts. */
export class ConfigurationDriver {
  private readonly profiles: OutputProfile[] = [];
  private readonly readers = new Map<string, ConfigurationReader>();
  private reader: ConfigurationReader | undefined;
  private source: SourceDocument = { sourceId: 'expec.json', text: '' };
  private inventory: DependencyInventory = { modules: [], packages: [] };
  private readonly sources = new Map<string, string>();
  private readonly planner = new DependencyPlanner();
  private readResult!: Check<Configuration>;
  private planned!: Check<ResolutionDependencies>;
  private latest!: Check<unknown>;
  private compiled!: Compilation;
  private readonly configurations = new Map<string, { value: Configuration; snapshot: Configuration }>();
  private readonly dependencies = new Map<string, { value: ResolutionDependencies; modules: ModuleModel[]; packages: unknown }>();
  private directory?: string;

  output(id: string, fields: Readonly<Record<string, 'nonempty text'>> = {}): void {
    this.profiles.push({ id, validate: options => Object.keys(fields).flatMap(key =>
      typeof options[key] === 'string' && options[key].trim() ? [] : [{ path: [key], message: `${key} must be nonempty text.` }]) });
    this.reader = undefined;
  }
  manifest(value: unknown, sourceId = 'expec.json'): void { this.document(JSON.stringify(value), sourceId); }
  document(text: string, sourceId = 'expec.json'): void { this.source = { sourceId, text }; }
  captureReader(label: string): void { this.readers.set(label, new ConfigurationReader(this.profiles)); }
  read(label?: string): void {
    const reader = label ? this.readers.get(label) : this.reader ??= new ConfigurationReader(this.profiles);
    if (!reader) throw new Error(`Unknown reader ${label}`);
    this.latest = this.readResult = reader.read(this.source);
  }
  resolveDependencies(): void { this.latest = this.planned = this.planner.resolve(this.configuration(), this.inventory); }
  sourceModule(locator: string, version: string, text: string): void {
    const read = new LangiumReader().read({ sourceId: `${locator}.expec`, text });
    if (read.status !== 'accepted') throw new Error('Acceptance library must be grammatical: ' + JSON.stringify(read.diagnostics));
    this.sources.set(locator, text);
    this.module(version, new LangiumModel(locator, read.document));
  }
  externalModule(locator: string, version: string, definitions: readonly ExternalDefinition[]): void {
    this.module(version, new ExternalModel(locator, definitions));
  }
  private module(version: string, model: ModuleModel): void {
    this.inventory = { ...this.inventory, modules: [...this.inventory.modules.filter(item => item.model.locator !== model.locator), { version, model }] };
  }
  availablePackage(name: string, version: string): void {
    this.packageInventory([...this.inventory.packages.filter(item => item.name !== name), { name, version }]);
  }
  packageInventory(packages: DependencyInventory['packages']): void { this.inventory = { ...this.inventory, packages }; }
  compile(text: string): void {
    this.sources.set('store', text);
    this.compiled = new Compiler().compile({ source: { sourceId: 'store.expec', text }, locator: 'store', dependencies: this.compilerInput() });
  }
  findings(): Check<unknown> { return this.latest; }
  configurationReport(): Check<Configuration> { return this.readResult; }
  dependencyReport(): Check<ResolutionDependencies> { return this.planned; }
  compilation(): Compilation { return this.compiled; }
  sourceId(): string { return this.source.sourceId; }
  configuration(): Configuration { return accepted(this.readResult); }
  compilerInput(): ResolutionDependencies { return accepted(this.planned); }
  suppliedModule(locator: string): ModuleModel {
    return one(this.inventory.modules.filter(item => item.model.locator === locator), `supplied module ${locator}`).model;
  }
  parameterType(callable: string, parameter: string, module: string, declaration: string) {
    const specification = accepted(this.compiled), { inspection, types } = specification;
    const callableId = one([...types.callableDeclarations()].filter(id => this.qualified(inspection.read(id)) === callable), callable);
    const slot = one(types.callable(callableId).parameters.filter(item => inspection.read(item.declaration, 'parameter').name === parameter), parameter);
    const supplied = this.suppliedModule(module);
    const declarationId = one(supplied.roots().filter(id => {
      const node = supplied.node(id);
      return 'name' in node && supplied.node(node.name, 'name').decoded === declaration;
    }), declaration);
    const actual = known(slot.type), shape = types.describe(actual);
    if (!('declaration' in shape)) throw new Error('Expected a declaration-backed parameter type');
    return { actual, expected: types.declaredType(declarationId), declaration: shape.declaration, supplied: declarationId };
  }
  typeOrigin(name: string) {
    const { inspection, types } = accepted(this.compiled);
    const declaration = one([...types.typeDeclarations()].map(id => inspection.read(id)).filter(item => 'name' in item && item.name === name), name);
    return declaration.origin;
  }
  private qualified(item: Item): string {
    const inspection = accepted(this.compiled).inspection, names: string[] = [];
    for (let node: Item | undefined = item; node; node = inspection.parent(node.id)) if ('name' in node && typeof node.name === 'string') names.unshift(node.name);
    return names.join('.');
  }
  sourceLocation(at: ProblemLocation) {
    if (at.kind !== 'source') return undefined;
    const text = this.sources.get(at.module);
    if (text === undefined) throw new Error(`Unknown diagnostic module ${at.module}`);
    return { module: at.module, text: Array.from(text).slice(at.range.start.offset, at.range.end.offset).join(''), line: at.range.start.line };
  }
  rememberConfiguration(label: string): void {
    const value = this.configuration();
    this.configurations.set(label, { value, snapshot: structuredClone(value) });
  }
  rememberedConfiguration(label: string) {
    const result = this.configurations.get(label);
    if (!result) throw new Error(`Unknown remembered configuration ${label}`);
    return result;
  }
  rememberDependencies(label: string): void {
    const value = this.compilerInput();
    this.dependencies.set(label, { value, modules: [...value.modules], packages: structuredClone(value.packages) });
  }
  rememberedDependencies(label: string) {
    const result = this.dependencies.get(label);
    if (!result) throw new Error(`Unknown remembered dependencies ${label}`);
    return result;
  }
  async existingFiles(files: Readonly<Record<string, string>>): Promise<void> {
    this.directory = await mkdtemp(join(tmpdir(), 'expec-configuration-'));
    for (const [name, contents] of Object.entries(files)) {
      const path = this.fileLocation(name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents);
    }
  }
  fileLocation(path: string): string {
    if (!this.directory) throw new Error('No filesystem fixture');
    const location = resolve(this.directory, path), inside = relative(this.directory, location);
    if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) throw new Error('Fixture path escapes its temporary directory');
    return location;
  }
  async files(): Promise<{ files: Record<string, string>; directories: string[] }> {
    const files: Record<string, string> = {}, directories: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(this.fileLocation(directory), { withFileTypes: true })) {
        const name = directory ? `${directory}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { directories.push(name); await walk(name); }
        else files[name] = await readFile(this.fileLocation(name), 'utf8');
      }
    };
    await walk('');
    return { files, directories: directories.sort() };
  }
  async projectExists(root: string): Promise<boolean> {
    const destination = this.fileLocation(relative(this.directory!, resolve(dirname(this.source.sourceId), root)));
    try { await stat(destination); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }
  async dispose(): Promise<void> {
    if (!this.directory) return;
    const suffix = relative(resolve(tmpdir()), this.directory);
    if (isAbsolute(suffix) || suffix.includes(sep) || !suffix.startsWith('expec-configuration-')) throw new Error('Refusing to remove an unexpected fixture path');
    await rm(this.directory, { recursive: true, force: true });
  }
}

function accepted<T>(check: Check<T>): T {
  if (!check?.value || check.problems.length || check.deferred.length) throw new Error('Expected an accepted result: ' + JSON.stringify(check));
  return check.value;
}
function known<T>(fact: TypeFact<T>): T {
  if (fact.status !== 'known') throw new Error('Expected a known type: ' + JSON.stringify(fact));
  return fact.value;
}
function one<T>(values: readonly T[], description: string): T {
  if (values.length !== 1) throw new Error(`Expected one ${description}, found ${values.length}`);
  return values[0]!;
}
