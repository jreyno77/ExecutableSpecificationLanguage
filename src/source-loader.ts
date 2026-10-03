import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Check } from './checking.js';
import type { Configuration } from './configuration.js';
import { bareModule } from './configuration-schema.js';
import type { SourceDocument, SyntaxDiagnostic } from './grammar/source.js';
import { LangiumModel } from './langium-model.js';
import { LangiumReader } from './langium/reader.js';
import type { ModuleModel, ModelNode } from './model.js';
import type { ResolutionDependencies } from './resolution.js';
import type { ProblemLocation } from './resolution/problem.js';
import type { ModuleLocator } from './source-composer.js';
import { nativePath, SourceFiles } from './source-files.js';

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
  async load(configuration: Configuration, dependencies: ResolutionDependencies): Promise<SourceLoad> {
    const files = new SourceFiles(this.directory, configuration), syntax: SyntaxDiagnostic[] = [];
    const models = new Map<string, ModuleModel>(), selected = new Map(dependencies.modules
      .filter(model => configuration.libraries.some(library => library.module === model.locator)).map(model => [model.locator, model]));
    for (const model of selected.values()) for (const method of ['roots', 'nodes', 'node', 'children', 'parent', 'resolution'] as const) {
      if (typeof model[method] !== 'function') throw new TypeError('Supplied module ' + model.locator + ' needs a callable ' + method + '().');
    }
    const mappings = new Map<string, string | undefined>(), visited = new Set<string>(), parsed = new Set<string>();
    const entries: ModuleModel[] = [], entryUses = new Map<string, ProblemLocation>();
    const names = [...configuration.build.entries], packages = dependencies.packages.map(item => ({ ...item, phases: [...item.phases] }));
    await files.initialize();
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
            files.problem('unsupported-library-source', 'Supplied library ' + model.locator + ' has no captured filesystem root for ' + text + '.', at);
            continue;
          }
          target = await read(resolve(dirname(fileURLToPath(model.locator)), text), at);
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
    const supplied = [...models.values(), ...selected.values()];
    return { captures: Object.freeze(captures), syntax, problems, deferred: [],
      ...(!problems.length && !syntax.length ? { value: {
        entries: entries.map(entry => ({ entry, dependencies: { modules: supplied.filter(model => model !== entry), packages } })),
        locate: (owner: string, authored: string) => mappings.get(JSON.stringify([owner, authored])),
      } } : {}) };
  }
}
function localFilename(path: string): boolean {
  return nativePath(path) && !/[\\*?\[\]{}]/.test(path) && !/^(?:\/|[a-z][a-z\d+.-]*:)/i.test(path) && path.endsWith('.expec');
}
function validLocator(text: string): boolean {
  return /^\.{1,2}\//.test(text) ? localFilename(text) : bareModule(text);
}
function references(model: ModuleModel): { text: string; at: ProblemLocation }[] {
  const directives: ModelNode<'use' | 'include' | 'examples-attachment'>[] =
    [...model.nodes('use'), ...model.nodes('include'), ...model.nodes('examples-attachment')];
  const result = directives.map(node => {
    const literal = model.node(node.locator, 'string-literal');
    return { text: literal.value, at: literal.origin };
  });
  for (const node of model.nodes('reference')) if (node.lookup?.kind === 'module') result.push({ text: node.lookup.locator, at: node.origin });
  return result.sort((a, b) => a.at.kind === 'source' && b.at.kind === 'source' ? a.at.range.start.offset - b.at.range.start.offset : 0);
}
function ordinal(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
