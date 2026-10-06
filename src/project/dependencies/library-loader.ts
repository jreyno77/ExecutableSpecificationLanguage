import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Check, Diagnostic } from '../../compiler/checking.js';
import type { Configuration } from '../connection/configuration.js';
import { fullVersion } from '../connection/configuration-schema.js';
import type { DependencyInventory } from './dependency-planner.js';
import { ExternalInputError, ExternalModel, type ExternalDefinition } from '../../model/external-model.js';
import type { SyntaxDiagnostic } from '../../language/grammar/source.js';
import { readJson } from '../connection/json-data.js';
import { LangiumModel } from '../../model/langium-model.js';
import { LangiumReader } from '../../language/langium/reader.js';
import type { ModuleModel } from '../../model/model.js';
import type { ProblemLocation } from '../../compiler/resolution/problem.js';
import type { ModuleLocator } from '../../compiler/source-composer.js';
import type { SourceCapture } from '../connection/source-loader.js';
import { nativePath, SourceFiles } from '../connection/source-files.js';
import { localFilename, ordinal, references, validLocator } from '../connection/source-references.js';

export interface LoadedLibraries {
  readonly inventory: DependencyInventory['modules'];
  readonly modules: readonly ModuleModel[];
  readonly locate: ModuleLocator;
}
export interface LibraryLoad extends Check<LoadedLibraries> {
  readonly captures: readonly SourceCapture[];
  readonly syntax: readonly SyntaxDiagnostic[];
}
export class LibraryLoader {
  private readonly directory: string;
  constructor(manifestLocation: string) {
    if (!nativePath(manifestLocation) || !isAbsolute(manifestLocation)) throw new TypeError('Provide a fully qualified absolute manifest filename.');
    this.directory = dirname(manifestLocation);
  }
  async load(input: Configuration): Promise<LibraryLoad> {
    const configuration = structuredClone(input), reader = new LangiumReader(), problems: Diagnostic[] = [], syntax: SyntaxDiagnostic[] = [];
    const inventory: { version: string; model: ModuleModel }[] = [], models = new Map<string, ModuleModel>();
    const sources = new Map<string, ModuleModel>(), captures: SourceCapture[] = [], owners: SourceFiles[] = [];
    const mappings = new Map<string, string | undefined>(), identities = new Map<string, ProblemLocation>();
    for (const [index, library] of configuration.libraries.entries()) {
      if (library.source === undefined) continue;
      const at: ProblemLocation = { kind: 'dependency', path: ['manifest', configuration.sourceId, 'libraries', index, 'source'] };
      const root = resolve(this.directory, library.source), files = new SourceFiles(this.directory, configuration);
      owners.push(files);
      await files.initialize([{ path: library.source, at }], 'library');
      if (files.problems.length) continue;
      const metadata = await files.read(join(root, 'package.json'), at);
      if (!metadata) continue;
      const jsonAt = (capture: SourceCapture, path: readonly (string | number)[] = []): ProblemLocation =>
        ({ kind: 'dependency', path: ['sources', capture.source.sourceId, ...path] });
      const parse = (capture: SourceCapture): unknown => readJson(capture.source.text, (code, message, path) =>
        files.problem(code, message, jsonAt(capture, path)));
      const data = parse(metadata);
      if (files.problems.length) continue;
      const expec = object(data) && object(data.expec) ? data.expec : undefined;
      if (!object(data) || !fullVersion(data.version) || !expec || Object.keys(expec).length !== 1
        || !(typeof expec.entry === 'string' && localFilename(expec.entry) || typeof expec.declarations === 'string' && localFilename(expec.declarations, '.json'))) {
        files.problem('invalid-library-metadata', 'Provide a complete version and exactly one relative expec.entry or expec.declarations filename.', jsonAt(metadata));
        continue;
      }
      const visited = new Set<string>(), parsed = new Set<string>();
      const readSource = async (path: string, at: ProblemLocation, locator?: string): Promise<ModuleModel | undefined> => {
        const capture = await files.read(path, at);
        if (!capture) return undefined;
        if (parsed.has(capture.source.sourceId)) return sources.get(capture.source.sourceId);
        parsed.add(capture.source.sourceId);
        const read = reader.read(capture.source);
        if (read.status === 'rejected') { syntax.push(...read.diagnostics); return undefined; }
        const model = new LangiumModel(locator ?? capture.source.sourceId, read.document);
        sources.set(capture.source.sourceId, model); models.set(model.locator, model);
        return model;
      };
      const visit = async (model: ModuleModel, path: string): Promise<void> => {
        if (visited.has(model.locator)) return;
        visited.add(model.locator);
        for (const reference of references(model)) {
          if (!validLocator(reference.text)) {
            files.problem('invalid-source-path', 'Provide an exact local .expec filename or bare library identity.', reference.at); continue;
          }
          if (!/^\.{1,2}\//.test(reference.text)) continue;
          const target = await readSource(resolve(dirname(path), reference.text), reference.at);
          mappings.set(JSON.stringify([model.locator, reference.text]), target?.locator);
          if (target) {
            const source = [...sources].find(([, value]) => value === target)![0];
            await visit(target, fileURLToPath(source));
          }
        }
      };
      let model: ModuleModel | undefined, entryPath: string;
      if (typeof expec.entry === 'string') {
        entryPath = resolve(root, expec.entry);
        model = await readSource(entryPath, jsonAt(metadata, ['expec', 'entry']), library.module);
      } else {
        entryPath = resolve(root, expec.declarations as string);
        const capture = await files.read(entryPath, jsonAt(metadata, ['expec', 'declarations']));
        if (!capture) continue;
        const before = files.problems.length, definitions = parse(capture);
        if (files.problems.length !== before) continue;
        try { model = new ExternalModel(library.module, definitions as readonly ExternalDefinition[]); models.set(model.locator, model); }
        catch (error) {
          if (!(error instanceof ExternalInputError)) throw error;
          for (const problem of error.problems) files.problem('invalid-library-declarations', problem.message, problem.at,
            [jsonAt(capture, problem.at.path)]);
        }
      }
      if (model) { inventory.push({ version: data.version, model }); await visit(model, entryPath); }
    }
    for (const files of owners) {
      await files.verify();
      for (const file of files.captured.values()) {
        const at: ProblemLocation = { kind: 'dependency', path: ['sources', file.capture.source.sourceId] };
        const key = `${file.stat.dev}:${file.stat.ino}`, previous = identities.get(key);
        if (previous) files.problem('source-alias', 'A captured library file has more than one owner.', at, [previous]);
        else identities.set(key, at);
        const model = sources.get(file.capture.source.sourceId);
        captures.push(Object.freeze({ ...file.capture, ...(model ? { model } : {}) }));
      }
      problems.push(...files.problems);
    }
    captures.sort((a, b) => ordinal(a.source.sourceId, b.source.sourceId));
    problems.sort((a, b) => ordinal(JSON.stringify(a.at), JSON.stringify(b.at)) || ordinal(a.code, b.code));
    syntax.sort((a, b) => ordinal(a.primaryRange.sourceId, b.primaryRange.sourceId) || a.primaryRange.start.offset - b.primaryRange.start.offset);
    return { captures: Object.freeze(captures), syntax, problems, deferred: [], ...(!problems.length && !syntax.length ? { value: {
      inventory: Object.freeze(inventory), modules: Object.freeze([...models.values()]),
      locate: (owner: string, authored: string) => mappings.get(JSON.stringify([owner, authored])),
    } } : {}) };
  }
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
