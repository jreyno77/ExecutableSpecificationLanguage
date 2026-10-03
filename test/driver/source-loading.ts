import { mkdtempSync, realpathSync } from 'node:fs';
import { link, mkdir, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  Compiler, ConfigurationReader, DependencyPlanner, ExpressionChecker, ExternalModel, FixtureChecker,
  LangiumModel, LangiumReader, QueryInspection, SourceComposer, SourceLoader, TypeDescriber,
  type Compilation, type Configuration, type ExternalDefinition, type Inspection, type Item, type ModuleModel,
  type Resolution, type SourceCapture, type SourceLoad, type TypeCatalog, type TypeFact, type TypeId,
} from '../../src/index.js';

type CompiledEntry = { resolution: Resolution; compilation: Compilation; types: TypeCatalog };
export type LoadedWorkspace = { load: SourceLoad; compilations: ReadonlyMap<string, CompiledEntry> };

export class SourceLoadingDriver {
  readonly temporary = realpathSync.native(mkdtempSync(join(tmpdir(), 'expec-sources-')));
  readonly directory: string;
  readonly modules: { version: string; model: ModuleModel }[] = [];
  readonly texts = new Map<string, string>();
  readonly remembered = new Map<string, LoadedWorkspace>();
  readonly authored = new Map<string, Buffer>();
  configuration!: Configuration;
  manifest!: string;
  loader!: SourceLoader;
  current!: LoadedWorkspace;

  constructor(directoryName = 'project') { this.directory = this.bounded(directoryName); }
  bounded(name: string): string {
    const path = resolve(this.temporary, name), remainder = relative(this.temporary, path);
    if (isAbsolute(remainder) || remainder === '..' || remainder.startsWith('..' + sep)) throw new Error('Fixture escaped its temporary directory.');
    return path;
  }
  path(name: string): string { return this.bounded(relative(this.temporary, resolve(this.directory, name))); }
  fileUrl(name: string): string { return pathToFileURL(this.path(name)).href; }
  moduleKey(name: string): string { return this.modules.some(item => item.model.locator === name) ? name : this.fileUrl(name); }
  configure(name: string, settings: object): void {
    this.manifest = this.path(name);
    const result = new ConfigurationReader([]).read({
      sourceId: pathToFileURL(this.manifest).href, text: JSON.stringify({ formatVersion: 1, version: '0.1.0', ...settings }),
    });
    if (!result.value) throw new Error('Invalid manifest fixture: ' + JSON.stringify(result));
    this.configuration = result.value;
    this.loader = new SourceLoader(this.manifest);
  }
  async file(name: string, contents: string | Uint8Array): Promise<void> {
    await mkdir(dirname(this.path(name)), { recursive: true });
    await writeFile(this.path(name), contents);
    this.authored.set(this.path(name), Buffer.from(contents));
    if (typeof contents === 'string') this.texts.set(this.fileUrl(name), contents);
  }
  async files(files: Record<string, string>, sibling = false): Promise<void> {
    for (const [name, text] of Object.entries(files)) await this.file(sibling ? '../' + name : name, text);
  }
  async removeFile(name: string): Promise<void> {
    await unlink(this.path(name)); this.authored.delete(this.path(name));
  }
  async directoryLink(name: string, target: string): Promise<void> {
    await symlink(this.path(target), this.path(name), process.platform === 'win32' ? 'junction' : 'dir');
  }
  async hardLink(name: string, target: string): Promise<void> { await link(this.path(target), this.path(name)); }
  sourceLibrary(module: string, version: string, text: string, sourceId: string): void {
    const read = new LangiumReader().read({ sourceId, text });
    if (read.status !== 'accepted') throw new Error('Invalid supplied source fixture: ' + JSON.stringify(read.diagnostics));
    this.modules.push({ version, model: new LangiumModel(module, read.document) });
    this.texts.set(sourceId, text);
  }
  externalLibrary(module: string, version: string, definitions: readonly ExternalDefinition[]): void {
    this.modules.push({ version, model: new ExternalModel(module, definitions) });
  }
  async load(compile: boolean): Promise<void> {
    const selected = new DependencyPlanner().resolve(this.configuration, { modules: this.modules, packages: [] });
    if (!selected.value) throw new Error('Invalid dependency fixture: ' + JSON.stringify(selected));
    const load = await this.loader.load(this.configuration, selected.value), compilations = new Map<string, CompiledEntry>();
    this.current = { load, compilations };
    if (compile && load.value) for (const input of load.value.entries) {
      const resolution = new SourceComposer(load.value.locate).compose(input.entry, input.dependencies);
      const compilation = new Compiler().compile({ resolution });
      compilations.set(input.entry.locator, { resolution, compilation, types: compilation.value?.types ?? new TypeDescriber().describe(resolution) });
    }
  }
  capture(name: string, state = this.current): SourceCapture {
    const capture = state.load.captures.find(capture => capture.source.sourceId === this.fileUrl(name));
    if (!capture) throw new Error('Missing captured file: ' + name);
    return capture;
  }
  compiled(entry?: string, state = this.current): CompiledEntry {
    const result = entry ? state.compilations.get(this.moduleKey(entry)) : [...state.compilations.values()][0];
    if (!result) throw new Error('No compilation was produced: ' + JSON.stringify(state.load));
    return result;
  }
  inspected(module?: string, state = this.current): CompiledEntry {
    return [...state.compilations.values()].find(result => [...result.types.inspection.roots()]
      .some(node => node.origin.kind !== 'builtin' && node.origin.module === this.moduleKey(module ?? '')))
      ?? this.compiled(undefined, state);
  }
  items(inspection: Inspection): Item[] {
    const result: Item[] = [];
    const visit = (node: Item): void => { result.push(node); for (const child of inspection.children(node.id)) visit(child); };
    for (const root of inspection.roots()) visit(root);
    return result;
  }
  name(node: Item, inspection: Inspection): string {
    const path: string[] = [];
    for (let current: Item | undefined = node; current; current = inspection.parent(current.id)) {
      if ('name' in current) path.unshift(current.name);
    }
    return path.join('.');
  }
  declaration(name: string, module?: string, state = this.current): Item {
    const inspection = this.inspected(module, state).types.inspection;
    const candidates = this.items(inspection).filter(node => 'name' in node && (this.name(node, inspection) === name || node.name === name)
      && (!module || node.origin.kind !== 'builtin' && node.origin.module === this.moduleKey(module)));
    if (candidates.length !== 1) throw new Error('Expected one declaration ' + name + ', found ' + candidates.length);
    return candidates[0]!;
  }
  typeName(type: TypeId, types: TypeCatalog): string {
    let meaning = types.describe(type);
    while (meaning.kind === 'alias') {
      if (meaning.target.status !== 'known') throw new Error('Alias target unavailable.');
      meaning = types.describe(meaning.target.value);
    }
    if (!('declaration' in meaning)) throw new Error('Expected a declared or builtin type.');
    return this.name(types.inspection.read(meaning.declaration), types.inspection);
  }
  fieldType(module: string, path: string, state = this.current): { fact: TypeFact<TypeId>; types: TypeCatalog } {
    const node = this.declaration(path, module, state), { types } = this.inspected(module, state);
    if (node.kind !== 'field') throw new Error('Expected a field.');
    return { fact: types.typeOf(node.declaredType.id), types };
  }
  parameterTypes(callable: string, names: readonly string[]): readonly TypeFact<TypeId>[] {
    const { types } = this.compiled(), signature = types.callable(this.declaration(callable).id);
    return names.map(name => {
      const parameter = signature.parameters.find(parameter => types.inspection.read(parameter.declaration, 'parameter').name === name);
      if (!parameter) throw new Error('Missing parameter ' + name);
      return parameter.type;
    });
  }
  fixtureType(module: string, name: string) {
    const { types } = this.inspected(module);
    return new FixtureChecker(types, new ExpressionChecker(types)).check(this.declaration(name, module).id);
  }
  callTarget(module: string, title: string) {
    const { types } = this.inspected(module);
    const example = [...types.inspection.query('example')].find(node => node.origin.kind === 'source'
      && node.origin.module === this.moduleKey(module) && node.title.value === title);
    if (!example) throw new Error('Missing example ' + title);
    return new ExpressionChecker(types).calledOperation(example.actual.id);
  }
  locators(module: string): readonly string[] {
    const model = this.capture(module).model;
    if (!model) throw new Error('Source was not accepted.');
    return [...model.nodes('use'), ...model.nodes('include'), ...model.nodes('examples-attachment')]
      .map(node => model.node(node.locator, 'string-literal').value);
  }
  originalDeclaration(module: string, name: string): Item {
    const model = this.modules.find(item => item.model.locator === module)!.model;
    const inspection = new QueryInspection(model);
    const node = this.items(inspection).find(node => 'name' in node && node.name === name);
    if (!node) throw new Error('Missing supplied declaration ' + name);
    return node;
  }
  rememberedState(name: string): LoadedWorkspace {
    const state = this.remembered.get(name);
    if (!state) throw new Error('No remembered load ' + name);
    return state;
  }
  async currentFiles(directory = this.directory): Promise<string[]> {
    const result: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = this.bounded(relative(this.temporary, join(directory, entry.name)));
      if (entry.isDirectory()) result.push(...await this.currentFiles(path));
      else result.push(path);
    }
    return result.sort();
  }
  async fileContents(name: string): Promise<Buffer> { return readFile(this.path(name)); }
  async dispose(): Promise<void> {
    const root = resolve(this.temporary);
    if (root !== this.temporary || !relative(realpathSync.native(tmpdir()), root).startsWith('expec-sources-')) throw new Error('Unsafe fixture cleanup.');
    await rm(root, { recursive: true, force: true });
  }
}
