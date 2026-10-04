import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  Compiler, LangiumModel, LangiumReader, SourceComposer, SourceLoader, SpecificationIdentity,
  type Check, type IdentifiedSpecification, type IdentityDecision, type ModuleModel, type OutputPlan,
  type ResolutionDependencies, type SpecDiff,
} from '../../src/index.js';
import { CompositionDriver } from './source-composition.js';
import { TypeScriptOutputDriver } from './typescript-output.js';

type Entry = { entry: ModuleModel; dependencies: ResolutionDependencies };

/** One coherent captured inventory, real composition, and durable correspondence. */
export class WorkspaceDriver extends CompositionDriver {
  selected: string[] = [];
  private readonly locations = new Map<string, string>();
  private readonly sources = new Map<string, { text: string; sourceId: string }>();
  private readonly supplied = new Map<string, ModuleModel[]>();
  private readonly packages = new Map<string, ResolutionDependencies['packages']>();
  private rootsOnly = false;
  readonly identity = new SpecificationIdentity(() => 'workspace-' + ++this.next);
  private next = 0;
  current!: Check<IdentifiedSpecification>;
  diff!: SpecDiff;
  readonly baselines = new Map<string, IdentifiedSpecification>();
  readonly decisions: IdentityDecision[] = [];

  add(locator: string, text: string, entry: boolean, sourceId = locator + '.expec'): void {
    this.sources.set(locator, { text, sourceId }); this.texts.set(locator, text);
    this.modules.set(locator, this.model(locator, text, sourceId));
    if (entry) this.selected.push(locator);
  }
  private model(locator: string, text: string, sourceId: string): ModuleModel {
    const read = new LangiumReader().read({ sourceId, text });
    if (read.status !== 'accepted') throw new Error('Invalid acceptance source: ' + JSON.stringify(read));
    return new LangiumModel(locator, read.document);
  }
  dependency(owner: string, locator: string, text: string, sourceId: string): void {
    const models = this.supplied.get(owner) ?? [];
    models.push(this.model(locator, text, sourceId)); this.supplied.set(owner, models);
  }
  onlyRoots(): void { this.rootsOnly = true; }
  packageFacts(owner: string, packages: ResolutionDependencies['packages']): void { this.packages.set(owner, packages); }
  override maps(owner: string, authored: string, supplied: string): void { this.locations.set(JSON.stringify([owner, authored]), supplied); }
  entries(): Entry[] {
    return this.selected.map(locator => ({ entry: this.modules.get(locator)!, dependencies: {
      modules: this.supplied.get(locator) ?? (this.rootsOnly ? [] : [...this.modules.values()].filter(model => model.locator !== locator)),
      packages: this.packages.get(locator) ?? [],
    } }));
  }
  compileWorkspace(single = false): void {
    const composer = new SourceComposer((owner, authored) => this.locations.get(JSON.stringify([owner, authored])) ?? (authored.trim() ? authored : undefined));
    const entries = this.entries(), first = entries[0]!;
    this.resolution = single ? composer.compose(first.entry, first.dependencies) : composer.compose(entries);
    this.compile();
  }
  reload(): void { for (const [locator, source] of this.sources) this.modules.set(locator, this.model(locator, source.text, source.sourceId)); }
  identify(previous?: string): void {
    if (!this.compilation.value) throw new Error('Workspace did not compile: ' + JSON.stringify(this.compilation));
    const before = previous ? this.baselines.get(previous)!.baseline : undefined;
    this.current = this.identity.associate(this.compilation.value, before, this.decisions);
    if (this.current.value) this.diff = this.identity.compare(before, this.current.value).value!;
  }
  subject(module: string, name: string, current = this.current.value!): string {
    const record = current.baseline.elements.find(record => record.address.module === module && record.address.name === name);
    if (!record) throw new Error('Missing identified subject ' + module + ':' + name); return record.id;
  }
}

/** Real manifest files and native output; only composition selects multiple roots. */
export class WorkspaceProjectDriver extends TypeScriptOutputDriver {
  entries: string[] = [];
  plan!: Check<OutputPlan>;
  readonly baselines = new Map<string, IdentifiedSpecification>();
  readonly snapshots = new Map<string, Map<string, string>>();
  readonly nativeBefore = new Map<string, string>();
  module(path: string): string { return pathToFileURL(join(this.directory, path)).href; }
  async sourceFile(path: string, text: string): Promise<void> {
    await fs.mkdir(dirname(join(this.directory, path)), { recursive: true });
    await fs.writeFile(join(this.directory, path), text);
  }
  async load(previous?: string): Promise<void> {
    const filename = join(this.directory, 'expec.json'), config = this.configuration(this.entries);
    await fs.writeFile(filename, JSON.stringify({ formatVersion: 1, version: '0.1.0', project: config.project,
      build: config.build, libraries: config.libraries, packages: config.packages, outputs: config.outputs }));
    const loaded = await new SourceLoader(filename).load(config, { modules: this.libraries, packages: this.packages });
    if (!loaded.value) throw new Error(JSON.stringify(loaded));
    this.membership = { workspaceModules: loaded.captures.flatMap(capture => capture.model ? [capture.model.locator] : []) };
    const result = new Compiler().compile({ resolution: new SourceComposer(loaded.value.locate).compose(loaded.value.entries) });
    if (!result.value) throw new Error(JSON.stringify(result));
    const before = previous ? this.baselines.get(previous)!.baseline : undefined;
    const identified = this.identity.associate(result.value, before);
    if (!identified.value) throw new Error(JSON.stringify(identified));
    this.previous = this.current; this.current = identified.value;
    this.diff = this.identity.compare(before, this.current).value!;
    await this.capture(); this.remembered = new Map(this.files);
  }
  async planUpdate(options: Record<string, unknown>): Promise<void> {
    this.open(options); this.plan = await this.output.plan({ operation: 'update', diff: this.diff, current: this.current }, await this.context.readSnapshot());
  }
}
