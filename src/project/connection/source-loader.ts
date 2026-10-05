import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Check } from '../../compiler/checking.js';
import type { Configuration } from './configuration.js';
import type { SourceDocument, SyntaxDiagnostic } from '../../language/source.js';
import { LangiumModel } from '../../model/langium-model.js';
import { LangiumReader } from '../../language/langium/reader.js';
import type { ModuleModel, NodeId } from '../../model/model.js';
import type { ResolutionDependencies } from '../../compiler/resolution.js';
import type { ProblemLocation } from '../../compiler/resolution/problem.js';
import type { ModuleLocator } from '../../compiler/source-composer.js';
import type { LoadedLibraries } from '../dependencies/library-loader.js';
import { nativePath, SourceFiles } from './source-files.js';
import { localFilename, validLocator, references, ordinal } from './source-references.js';

export interface SourceCapture {
  readonly source: Readonly<SourceDocument>;
  readonly version: string;
  readonly model?: ModuleModel;
}
export interface LoadedSources {
  readonly entries: readonly { readonly entry: ModuleModel; readonly dependencies: ResolutionDependencies }[];
  readonly locate: ModuleLocator;
}
export interface SourceLoad extends Check<LoadedSources> {
  readonly captures: readonly SourceCapture[];
  readonly syntax: readonly SyntaxDiagnostic[];
}

/** Captures explicitly reached files; existing composition owns their meaning. */
export class SourceLoader {
  private readonly directory: string;
  private readonly reader = new LangiumReader();
  constructor(manifestLocation: string) {
    if (!nativePath(manifestLocation) || !isAbsolute(manifestLocation)) throw new TypeError('Provide a fully qualified absolute manifest filename.');
    this.directory = dirname(manifestLocation);
  }
  async load(input: Configuration, dependencies: ResolutionDependencies, libraries?: LoadedLibraries): Promise<SourceLoad> {
    const configuration = structuredClone(input);
    const files = new SourceFiles(this.directory, configuration), syntax: SyntaxDiagnostic[] = [];
    const models = new Map<string, ModuleModel>(), selected = new Map(dependencies.modules
      .filter(model => configuration.libraries.some(library => library.module === model.locator)).map(model => [model.locator, model]));
    for (const model of selected.values()) for (const method of ['roots', 'nodes', 'node', 'children', 'parent', 'resolution'] as const) {
      if (typeof model[method] !== 'function') throw new TypeError('Supplied module ' + model.locator + ' needs a callable ' + method + '().');
    }
    const mappings = new Map<string, string | undefined>(), visited = new Set<string>(), parsed = new Set<string>();
    const acquired = captureLibraries(libraries, selected, mappings, files);
    const entries: ModuleModel[] = [], entryUses = new Map<string, ProblemLocation>();
    const names = [...configuration.build.entries], packages = dependencies.packages.map(item => ({ ...item, phases: [...item.phases] }));
    await files.initialize();
    await files.initialize(configuration.libraries.flatMap((library, index) => library.source === undefined ? [] : [{ path: library.source,
      at: { kind: 'dependency' as const, path: ['manifest', configuration.sourceId, 'libraries', index, 'source'] } }]), 'excluded');
    const read = async (selectedPath: string, at: ProblemLocation): Promise<ModuleModel | undefined> => {
      const capture = await files.read(selectedPath, at);
      if (!capture) return undefined;
      if (parsed.has(capture.source.sourceId)) return models.get(capture.source.sourceId);
      parsed.add(capture.source.sourceId);
      const result = this.reader.read(capture.source);
      if (result.status === 'rejected') {
        if (!syntax.some(problem => problem.primaryRange.sourceId === capture.source.sourceId)) syntax.push(...result.diagnostics);
        return undefined;
      }
      const model = new LangiumModel(capture.source.sourceId, result.document);
      models.set(model.locator, model);
      return model;
    };
    const visit = async (model: ModuleModel, local: boolean): Promise<void> => {
      if (visited.has(model.locator)) return;
      visited.add(model.locator);
      for (const { text, at } of references(model)) {
        const key = JSON.stringify([model.locator, text]);
        if (!validLocator(text)) {
          files.problem('invalid-source-path', 'Provide an exact local .expec filename or a bare library identity: ' + text, at);
          continue;
        }
        let target: ModuleModel | undefined;
        if (/^\.{1,2}\//.test(text)) {
          if (!local) {
            if (!acquired.has(model.locator)) {
              files.problem('unsupported-library-source', 'Supplied library ' + model.locator + ' has no captured filesystem root for ' + text + '.', at);
              continue;
            }
            target = acquired.get(mappings.get(key) ?? '');
          } else target = await read(resolve(dirname(fileURLToPath(model.locator)), text), at);
        } else target = selected.get(text);
        mappings.set(key, target?.locator);
        if (target) await visit(target, models.has(target.locator));
      }
    };
    for (const [index, name] of names.entries()) {
      const at = files.manifest('entries', index);
      if (!localFilename(name)) {
        files.problem('invalid-source-path', 'Provide an exact relative .expec entry filename: ' + name, at); continue;
      }
      const model = await read(resolve(this.directory, name), at);
      if (!model) continue;
      const previous = entryUses.get(model.locator);
      if (previous) files.problem('duplicate-source-entry', 'Entry ' + name + ' repeats ' + model.locator + '.', at, [previous]);
      else { entryUses.set(model.locator, at); entries.push(model); }
      await visit(model, true);
    }
    await files.verify();
    const captures = [...files.captured.values()].map(({ capture }) => Object.freeze({
      ...capture, ...(models.has(capture.source.sourceId) ? { model: models.get(capture.source.sourceId)! } : {}),
    })).sort((a, b) => ordinal(a.source.sourceId, b.source.sourceId));
    const problems = files.problems.sort((a, b) => ordinal(JSON.stringify(a.at), JSON.stringify(b.at)) || ordinal(a.code, b.code));
    syntax.sort((a, b) => ordinal(a.primaryRange.sourceId, b.primaryRange.sourceId) || a.primaryRange.start.offset - b.primaryRange.start.offset);
    const supplied = [...new Set([...models.values(), ...selected.values(), ...acquired.values()])];
    return { captures: Object.freeze(captures), syntax, problems, deferred: [],
      ...(!problems.length && !syntax.length ? { value: {
        entries: entries.map(entry => ({ entry, dependencies: { modules: supplied.filter(model => model !== entry), packages } })),
        locate: (owner: string, authored: string) => mappings.get(JSON.stringify([owner, authored])),
      } } : {}) };
  }
}

/** Capture the supplied relative graph; the provider owns its filesystem provenance. */
function captureLibraries(input: LoadedLibraries | undefined, selected: ReadonlyMap<string, ModuleModel>,
  mappings: Map<string, string | undefined>, files: SourceFiles): Map<string, ModuleModel> {
  const models = new Map<string, ModuleModel>();
  if (input === undefined) return models;
  if (!input || !Array.isArray(input.inventory) || !Array.isArray(input.modules) || typeof input.locate !== 'function') {
    throw new TypeError('Provide library inventory, models and a callable locator.');
  }
  const problem = (message: string, path: readonly (string | number)[]) => files.problem('invalid-library-input', message,
    { kind: 'dependency', path: ['libraries', ...path] });
  const sourceOwners = new Map<string, string>();
  for (const [index, model] of input.modules.entries()) {
    for (const method of ['roots', 'nodes', 'node', 'children', 'parent', 'resolution'] as const) {
      if (!model || typeof model[method] !== 'function') throw new TypeError('A library model needs callable ' + method + '().');
    }
    if (typeof model.locator !== 'string' || !model.locator.trim() || models.has(model.locator)) {
      problem('Library module locators must be nonblank and unique.', ['modules', index]); continue;
    }
    models.set(model.locator, model);
    const seen = new Set<NodeId>();
    const visit = (id: NodeId): void => {
      if (seen.has(id)) return;
      seen.add(id);
      const node = model.node(id);
      if (node.origin.kind !== 'builtin' && node.origin.module !== model.locator) problem('A library node has a foreign module owner.', ['modules', index]);
      if (node.origin.kind === 'source') {
        const source = node.origin.range.sourceId, owner = sourceOwners.get(source);
        if (owner !== undefined && owner !== model.locator) problem('A source belongs to different supplied library modules.', ['modules', index]);
        else sourceOwners.set(source, model.locator);
      }
      for (const child of model.children(id)) visit(child);
    };
    for (const id of model.roots()) visit(id);
  }
  const reached = new Set<string>(), entries = new Set<string>();
  const visit = (model: ModuleModel): void => {
    if (reached.has(model.locator)) return;
    reached.add(model.locator);
    for (const { text, at } of references(model)) {
      if (!/^\.{1,2}\//.test(text)) continue;
      const key = JSON.stringify([model.locator, text]);
      if (!mappings.has(key)) {
        const target = input.locate(model.locator, text);
        if (target !== undefined && (typeof target !== 'string' || !target.trim())) throw new TypeError('A library locator must return a nonblank key or undefined.');
        mappings.set(key, target);
      }
      const target = models.get(mappings.get(key) ?? '');
      if (!target) files.problem('invalid-library-input', 'A captured relative reference needs its supplied target.', at);
      else visit(target);
    }
  };
  for (const [index, item] of input.inventory.entries()) {
    if (!item || !item.model || typeof item.version !== 'string') throw new TypeError('Provide a versioned library model.');
    const model = item.model;
    if (entries.has(model.locator) || selected.get(model.locator) !== model || models.get(model.locator) !== model) {
      problem('The acquired entry must be the exact selected model, supplied once.', ['inventory', index]);
    }
    entries.add(model.locator);
    if (models.get(model.locator) === model) visit(model);
  }
  for (const locator of models.keys()) if (!reached.has(locator)) problem('A supplied library module is not reached from an acquired entry.', ['modules', locator]);
  return models;
}
