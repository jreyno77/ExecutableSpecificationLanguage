import ts from 'typescript';
import fs from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { posix } from 'node:path';
import type { Diagnostic } from '../../compiler/checking.js';
import type { ProjectSnapshot } from '../connection/project-connection.js';
import type { ArtifactLocator } from '../../model/specification-identity.js';
import { validateReadOnly } from '../connection/project-readonly.js';

const root = '/__expec_project__', libraries = '/__expec_typescript__';
const sourcePattern = /\.(?:[cm]?ts|tsx)$/i;
/** Optional private acquisition host; pure project queries supply no effectful host. */
export interface NativeInputs {
  read(path: string): string | undefined;
  fileExists(path: string): boolean;
  directoryExists(path: string): boolean;
  directories(path: string): string[];
  readonly imports: readonly string[];
}
export const ordinal = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export const pathValid = (path: unknown): path is string => typeof path === 'string' && !/[:\\\0]/.test(path)
  && path.split('/').every(part => !!part && part !== '.' && part !== '..') && Buffer.from(path).toString() === path;
export const requireInput = (condition: unknown, message: string): void => { if (!condition) throw new TypeError(message); };
export function diagnostic(code: string, message: string, file: string, start?: number, length?: number): Diagnostic {
  return { code, message, at: { kind: 'dependency', path: ['typescript', file, ...(start === undefined ? [] : [start, length ?? 0])] }, related: [] };
}

/** Captured project/configuration host and the bounded installed standard-library resource. */
export class TypeScriptCapture {
  readonly snapshot: ProjectSnapshot;
  readonly texts = new Map<string, string>();
  readonly problems: Diagnostic[];
  readonly editableImportProblems = new Set<Diagnostic>();
  readonly service: ts.LanguageService;
  readonly program: ts.Program | undefined;
  readonly configurations = new Set<string>();
  readonly resolveModule: (name: string, from: string) => ts.SourceFile | undefined;
  private readonly nativeFiles = new Set<string>();
  private readonly directoryEntries = new Map<string, { files: string[]; directories: string[] }>();
  constructor(snapshot: ProjectSnapshot, readonly outputId: string, readonly configFile?: string, libraryText = new Map<string, string>(), inputs?: NativeInputs) {
    requireInput(snapshot && snapshot.root && typeof snapshot.root.path === 'string' && isAbsolute(snapshot.root.path)
      && typeof snapshot.root.identity === 'string' && !!snapshot.root.identity && Array.isArray(snapshot.files)
      && Array.isArray(snapshot.problems) && typeof snapshot.complete === 'boolean' && snapshot.complete === !snapshot.problems.length
      && Array.isArray(snapshot.excludeNames) && snapshot.excludeNames.every(name => pathValid(name) && !name.includes('/'))
      && new Set(snapshot.excludeNames).size === snapshot.excludeNames.length && Array.isArray(snapshot.excluded)
      && snapshot.excluded.every(pathValid) && new Set(snapshot.excluded).size === snapshot.excluded.length, 'Malformed project snapshot.');
    requireInput(snapshot.files.every(file => file && pathValid(file.path) && file.bytes instanceof Uint8Array
      && typeof file.version === 'string' && /^[a-f0-9]{64}$/.test(file.version))
      && new Set(snapshot.files.map(file => file.path)).size === snapshot.files.length, 'Malformed or duplicate captured file.');
    requireInput(snapshot.problems.every(problem => problem && typeof problem.code === 'string' && typeof problem.message === 'string'
      && problem.at && typeof problem.at.kind === 'string' && Array.isArray(problem.related)), 'Malformed capture diagnostic.');
    requireInput(validateReadOnly(snapshot), 'Malformed, overlapping or hash-invalid read-only evidence.');
    this.snapshot = structuredClone(snapshot); this.problems = [...this.snapshot.problems];
    for (const file of [...this.snapshot.files, ...this.snapshot.readOnlyFiles ?? []]) {
      const path = this.absolute(file.path);
      try { this.texts.set(path, new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes)); }
      catch { if (sourcePattern.test(file.path) || /\.jsonc?$/i.test(file.path)) this.problems.push(diagnostic('invalid-project-encoding', 'Source/configuration must contain valid UTF-8.', file.path)); }
      let child = path, directory = posix.dirname(path);
      while (directory.startsWith(root)) {
        const entries = this.directoryEntries.get(directory) ?? { files: [], directories: [] };
        const list = child === path ? entries.files : entries.directories, name = posix.basename(child);
        if (!list.includes(name)) list.push(name); this.directoryEntries.set(directory, entries);
        child = directory; directory = posix.dirname(directory);
      }
    }
    const projectRead = (path: string): string | undefined => {
      const normalized = posix.normalize(path);
      const logical = this.projectPath(normalized);
      if (inputs && logical === undefined && normalized !== root) this.problems.push(diagnostic('unsupported-native-input', 'Native configuration cannot read outside the connected project.', normalized));
      if (!this.texts.has(normalized) && logical !== undefined) {
        const acquired = inputs?.read(logical); if (acquired !== undefined) this.texts.set(normalized, acquired);
      }
      if (/\.jsonc?$/i.test(normalized) && this.texts.has(normalized)) this.configurations.add(logical!);
      if (this.texts.has(normalized) && this.snapshot.readOnlyFiles?.some(file => file.path === logical)) this.nativeFiles.add(logical!);
      return this.texts.get(normalized);
    };
    const exists = (path: string): boolean => this.texts.has(posix.normalize(path)) || !!inputs?.fileExists(this.projectPath(posix.normalize(path)) ?? '');
    const directories = (path: string): string[] => [...new Set([...this.directoryEntries.get(posix.normalize(path))?.directories ?? [], ...inputs?.directories(this.projectPath(posix.normalize(path)) ?? '') ?? []])];
    const host: ts.ParseConfigHost = { useCaseSensitiveFileNames: true, readFile: projectRead,
      fileExists: exists,
      readDirectory: (path, extensions, excludes, includes, depth) => nativeMatchFiles(path, extensions, excludes, includes, true, root, depth,
        directory => this.directoryEntries.get(posix.normalize(directory)) ?? { files: [], directories: [] }, path => posix.normalize(path)) };
    let options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext, moduleDetection: ts.ModuleDetectionKind.Legacy, jsx: ts.JsxEmit.Preserve, strict: true, types: [], noEmit: true };
    let roots = this.snapshot.files.filter(file => sourcePattern.test(file.path)).map(file => this.absolute(file.path));
    if (configFile !== undefined) {
      const path = this.absolute(configFile), text = projectRead(path);
      if (text === undefined) { this.problems.push(diagnostic('missing-project-config', 'The configured TypeScript file was not captured.', configFile)); roots = []; }
      else {
        const parsed = ts.parseJsonSourceFileConfigFileContent(ts.parseJsonText(path, text), host, posix.dirname(path), undefined, path);
        options = parsed.options; roots = parsed.fileNames.filter(path => this.snapshot.files.some(file => this.absolute(file.path) === path));
        this.problems.push(...parsed.errors.map(error => this.nativeDiagnostic(error)));
        if (parsed.projectReferences?.length || Array.isArray(options.plugins) && options.plugins.length) this.problems.push(diagnostic('unsupported-project-config', 'Project references and language-service plugins need a separate project orchestration contract.', configFile));
      }
    }
    options = { ...options, noEmit: true };
    const read = (path: string): string | undefined => {
      if (!path.startsWith(libraries + '/')) return projectRead(path);
      const name = path.slice(libraries.length + 1);
      if (!/^lib(?:\.[\w.-]+)?\.d\.ts$/.test(name)) return undefined;
      if (libraryText.has(name)) return libraryText.get(name);
      try {
        const directory = fs.realpathSync.native(dirname(ts.getDefaultLibFilePath(options))), file = fs.realpathSync.native(join(directory, name));
        if (relative(directory, file) !== name) throw Error('Standard library path escapes its package.');
        const content = fs.readFileSync(file, 'utf8'); libraryText.set(name, content); return content;
      } catch (error) { this.problems.push(diagnostic('typescript-library-unavailable', `Cannot load installed TypeScript standard library ${name}: ${String(error)}`, configFile ?? '<default-profile>')); return undefined; }
    };
    const moduleHost: ts.ModuleResolutionHost = { fileExists: host.fileExists, readFile: projectRead,
      getDirectories: directories,
      directoryExists: path => this.directoryEntries.has(posix.normalize(path)) || !!inputs?.directoryExists(this.projectPath(posix.normalize(path)) ?? ''), realpath: path => posix.normalize(path), getCurrentDirectory: () => root };
    this.resolveModule = (name, from) => {
      const containing = from.startsWith(root + '/') ? from : this.absolute(from), mode = ts.getImpliedNodeFormatForFile(containing, undefined, moduleHost, options),
        resolved = ts.resolveModuleName(name, containing, options, moduleHost, undefined, undefined, mode).resolvedModule;
      return resolved && this.program?.getSourceFile(resolved.resolvedFileName);
    };
    // Acquisition alone asks the native compiler for both seeded declaration closures.
    // The returned snapshot adds no project roots; pure queries build their original program.
    for (const name of inputs?.imports ?? []) {
      const targets = ([ts.ModuleKind.ESNext, ts.ModuleKind.CommonJS] as const).flatMap(mode => {
        const found = ts.resolveModuleName(name, this.absolute('__native_seed__.ts'), options, moduleHost, undefined, undefined, mode).resolvedModule;
        return found && /\.d\.[cm]?ts$/i.test(found.resolvedFileName) ? [found.resolvedFileName] : [];
      });
      if (!targets.length) this.problems.push(diagnostic('native-input-unavailable', `No native declaration is available for ${name}.`, '<imports>'));
      roots.push(...targets);
    }
    roots = [...new Set(roots)];
    const unresolved: { literal: ts.StringLiteralLike; source: ts.SourceFile; lookups: Set<string> }[] = [];
    const resolutions = new Map<ts.SourceFile, (string | undefined)[]>();
    this.service = ts.createLanguageService({ ...moduleHost, getCompilationSettings: () => options,
      getCurrentDirectory: () => root, getScriptFileNames: () => roots, getScriptVersion: () => 'capture',
      getScriptSnapshot: path => { const text = read(path); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text); },
      getDefaultLibFileName: () => libraries + '/' + ts.getDefaultLibFileName(options),
      useCaseSensitiveFileNames: () => true, readFile: read, fileExists: path => path.startsWith(libraries + '/') ? read(path) !== undefined : host.fileExists(path),
      readDirectory: (path, extensions, excludes, includes, depth) => [...host.readDirectory(path, extensions ?? [], excludes, includes ?? [], depth)],
      resolveModuleNameLiterals: (literals, containing, redirected, settings, source) => literals.map(literal => {
        if (inputs && (literal.text.startsWith('.') || /^(?:\/|[\w+.-]+:)/.test(literal.text))
          && !posix.resolve(posix.dirname(containing), literal.text).startsWith(root + '/')) {
          this.problems.push(diagnostic('unsupported-native-input', `Native import ${literal.text} is outside the connected project.`, this.projectPath(containing)!, literal.getStart(source), literal.getWidth(source)));
        }
        const lookups = new Set<string>();
        const observed: ts.ModuleResolutionHost = { ...moduleHost,
          fileExists: path => { lookups.add(path); return moduleHost.fileExists(path); },
          directoryExists: path => { lookups.add(path); return moduleHost.directoryExists!(path); },
          readFile: path => { lookups.add(path); return moduleHost.readFile(path); },
        };
        const found = ts.resolveModuleName(literal.text, containing, settings, observed, undefined, redirected, ts.getModeForUsageLocation(source, literal, settings));
        const path = found.resolvedModule?.resolvedFileName;
        if (inputs) { const paths = resolutions.get(source) ?? []; paths.push(path); resolutions.set(source, paths); }
        if (!path) unresolved.push({ literal, source, lookups });
        if (inputs && path?.startsWith(root + '/node_modules/') && !/\.d\.[cm]?ts$/i.test(path)) this.problems.push(diagnostic('unsupported-native-input', `Native import ${literal.text} requires installed implementation rather than declarations.`, this.projectPath(containing)!, literal.getStart(source), literal.getWidth(source)));
        return found;
      }) });
    try {
      this.program = this.service.getProgram();
      if (this.program) {
        // Acquisition checks sources that can report unavailable inputs; pure queries retain full diagnostics.
        const selected = inputs ? this.program.getSourceFiles().filter(source => source.referencedFiles.length
          || source.typeReferenceDirectives.length || source.libReferenceDirectives.length
          || !source.fileName.startsWith(libraries + '/') && hasModuleDeclaration(source)
          || (resolutions.get(source) ?? []).some(path => !path || /\.(?:[cm]?js|jsx)$/i.test(path) || !this.program!.getSourceFile(path))) : [];
        const diagnostics = inputs ? ts.sortAndDeduplicateDiagnostics([
          ...this.program.getConfigFileParsingDiagnostics(), ...this.program.getOptionsDiagnostics(),
          ...this.program.getGlobalDiagnostics(), ...this.program.getSyntacticDiagnostics(),
          ...selected.flatMap(source => this.program!.getSemanticDiagnostics(source)),
        ]) : ts.getPreEmitDiagnostics(this.program);
        this.problems.push(...diagnostics.map(error => this.nativeDiagnostic(error)));
        // Only real compiler errors can be deferred for files generation may create.
        for (const { literal, source, lookups } of unresolved) if (this.editableImport(literal, source, lookups)) {
          const path = this.projectPath(source.fileName)!, start = literal.getStart(source);
          for (const problem of this.problems) if (/^typescript-(2307|2792)$/.test(problem.code)
            && problem.at.kind === 'dependency' && problem.at.path[1] === path && problem.at.path[2] === start)
            this.editableImportProblems.add(problem);
        }
      }
    } catch (error) { this.service.dispose(); throw error; }
  }
  private editableImport(literal: ts.StringLiteralLike, source: ts.SourceFile, lookups: ReadonlySet<string>): boolean {
    if (!this.snapshot.files.some(file => this.absolute(file.path) === source.fileName)
      || !/^(?:\.\.?\/|\.{1,2}$)/.test(literal.text)) return false;
    const key = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
    const excluded = this.snapshot.excluded.map(key), names = new Set([...this.snapshot.excludeNames, 'node_modules'].map(key));
    const included = (absolute: string) => {
      const path = this.projectPath(posix.normalize(absolute));
      if (absolute === root) return true;
      return path !== undefined && !key(path).split('/').some(part => names.has(part))
        && !excluded.some(entry => key(path) === entry || key(path).startsWith(entry + '/'));
    };
    return included(source.fileName) && included(posix.resolve(posix.dirname(source.fileName), literal.text))
      && lookups.size > 0 && [...lookups].every(included);
  }
  absolute(path: string): string { return root + '/' + path; }
  projectPath(path: string): string | undefined { return path.startsWith(root + '/') ? path.slice(root.length + 1) : undefined; }
  get sources(): readonly ts.SourceFile[] { return this.program?.getSourceFiles().filter(file => this.snapshot.files.some(captured => this.absolute(captured.path) === file.fileName)) ?? []; }
  site(node: ts.Node, role: string, nameOnly = false): ArtifactLocator {
    const file = node.getSourceFile(), path = this.projectPath(file.fileName)!;
    const name = nameOnly && 'name' in node && node.name && typeof node.name === 'object' ? node.name as ts.Node : node;
    return { outputId: this.outputId, format: 'typescript-site-1', value: { file: path,
      version: [...this.snapshot.files, ...this.snapshot.readOnlyFiles ?? []].find(file => file.path === path)!.version, start: name.getStart(file), end: name.getEnd(), role } };
  }
  scope(): ArtifactLocator[] {
    const files = this.sources.map(file => this.projectPath(file.fileName)!).sort(ordinal);
    return [{ outputId: this.outputId, format: 'typescript-scope-1', value: { root: { ...this.snapshot.root }, configFile: this.configFile ?? null,
      files, excludeNames: [...this.snapshot.excludeNames], excluded: [...new Set([...this.snapshot.excluded,
        ...this.snapshot.files.filter(file => /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(file.path) && !files.includes(file.path)).map(file => file.path)])].sort(ordinal) } },
      ...[...new Set([...files, ...this.configurations])].filter(file => !this.snapshot.readOnlyFiles?.some(item => item.path === file)).sort(ordinal).map(file => ({ outputId: this.outputId, format: 'typescript-file-1', value: { file } })),
      ...(this.snapshot.readOnlyFiles ?? []).filter(file => this.nativeFiles.has(file.path)).map(file => ({ outputId: this.outputId, format: 'typescript-native-file-1', value: { file: file.path, version: file.version } }))];
  }
  nativeDiagnostic(error: ts.Diagnostic): Diagnostic {
    const location = (item: ts.Diagnostic) => diagnostic('', '', item.file ? this.projectPath(item.file.fileName) ?? '<standard-library>' : this.configFile ?? '<default-profile>', item.start, item.length).at;
    return { code: 'typescript-' + error.code, message: ts.flattenDiagnosticMessageText(error.messageText, '\n'), at: location(error), related: error.relatedInformation?.map(location) ?? [] };
  }
}

function hasModuleDeclaration(node: ts.Node): boolean {
  return ts.isModuleDeclaration(node) || !!ts.forEachChild(node, hasModuleDeclaration);
}

// Pinned TypeScript exposes its own config glob walker at runtime, outside the declaration file.
type MatchFiles = (path: string, extensions: readonly string[] | undefined, excludes: readonly string[] | undefined,
  includes: readonly string[] | undefined, sensitive: boolean, cwd: string, depth: number | undefined,
  entries: (path: string) => { files: readonly string[]; directories: readonly string[] }, realpath: (path: string) => string) => string[];
const nativeMatchFiles = (ts as unknown as { matchFiles: MatchFiles }).matchFiles;
if (typeof nativeMatchFiles !== 'function') throw Error('The pinned TypeScript dependency must expose its native matchFiles configuration walker.');
