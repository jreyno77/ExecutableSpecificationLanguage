import ts from 'typescript';
import fs from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { posix } from 'node:path';
import type { Diagnostic } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { ArtifactLocator } from './specification-identity.js';

const root = '/__expec_project__', libraries = '/__expec_typescript__';
const sourcePattern = /\.(?:[cm]?ts|tsx)$/i;
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
  readonly service: ts.LanguageService;
  readonly program: ts.Program | undefined;
  readonly configurations = new Set<string>();
  private readonly directoryEntries = new Map<string, { files: string[]; directories: string[] }>();
  constructor(snapshot: ProjectSnapshot, readonly outputId: string, readonly configFile?: string, libraryText = new Map<string, string>()) {
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
    this.snapshot = structuredClone(snapshot); this.problems = [...this.snapshot.problems];
    for (const file of this.snapshot.files) {
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
      if (/\.jsonc?$/i.test(normalized) && this.texts.has(normalized)) this.configurations.add(this.projectPath(normalized)!);
      return this.texts.get(normalized);
    };
    const host: ts.ParseConfigHost = { useCaseSensitiveFileNames: true, readFile: projectRead,
      fileExists: path => this.texts.has(posix.normalize(path)),
      readDirectory: (path, extensions, excludes, includes, depth) => nativeMatchFiles(path, extensions, excludes, includes, true, root, depth,
        directory => this.directoryEntries.get(posix.normalize(directory)) ?? { files: [], directories: [] }, path => posix.normalize(path)) };
    let options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext, moduleDetection: ts.ModuleDetectionKind.Legacy, jsx: ts.JsxEmit.Preserve, strict: true, types: [], noEmit: true };
    let roots = [...this.texts.keys()].filter(path => sourcePattern.test(path));
    if (configFile !== undefined) {
      const path = this.absolute(configFile), text = projectRead(path);
      if (text === undefined) { this.problems.push(diagnostic('missing-project-config', 'The configured TypeScript file was not captured.', configFile)); roots = []; }
      else {
        const parsed = ts.parseJsonSourceFileConfigFileContent(ts.parseJsonText(path, text), host, posix.dirname(path), undefined, path);
        options = parsed.options; roots = parsed.fileNames;
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
      getDirectories: path => [...this.directoryEntries.get(posix.normalize(path))?.directories ?? []],
      directoryExists: path => this.directoryEntries.has(posix.normalize(path)), realpath: path => posix.normalize(path), getCurrentDirectory: () => root };
    this.service = ts.createLanguageService({ ...moduleHost, getCompilationSettings: () => options,
      getCurrentDirectory: () => root, getScriptFileNames: () => roots, getScriptVersion: () => 'capture',
      getScriptSnapshot: path => { const text = read(path); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text); },
      getDefaultLibFileName: () => libraries + '/' + ts.getDefaultLibFileName(options),
      useCaseSensitiveFileNames: () => true, readFile: read, fileExists: path => path.startsWith(libraries + '/') ? read(path) !== undefined : host.fileExists(path),
      readDirectory: (path, extensions, excludes, includes, depth) => [...host.readDirectory(path, extensions ?? [], excludes, includes ?? [], depth)],
      resolveModuleNameLiterals: (literals, containing, redirected, settings, source) => literals.map(literal => ts.resolveModuleName(literal.text, containing, settings, moduleHost,
        undefined, redirected, ts.getModeForUsageLocation(source, literal, settings))) });
    try {
      this.program = this.service.getProgram();
      if (this.program) this.problems.push(...ts.getPreEmitDiagnostics(this.program).map(error => this.nativeDiagnostic(error)));
    } catch (error) { this.service.dispose(); throw error; }
  }
  absolute(path: string): string { return root + '/' + path; }
  projectPath(path: string): string | undefined { return path.startsWith(root + '/') ? path.slice(root.length + 1) : undefined; }
  get sources(): readonly ts.SourceFile[] { return this.program?.getSourceFiles().filter(file => this.projectPath(file.fileName) !== undefined) ?? []; }
  site(node: ts.Node, role: string, nameOnly = false): ArtifactLocator {
    const file = node.getSourceFile(), path = this.projectPath(file.fileName)!;
    const name = nameOnly && 'name' in node && node.name && typeof node.name === 'object' ? node.name as ts.Node : node;
    return { outputId: this.outputId, format: 'typescript-site-1', value: { file: path,
      version: this.snapshot.files.find(file => file.path === path)!.version, start: name.getStart(file), end: name.getEnd(), role } };
  }
  scope(): ArtifactLocator[] {
    const files = this.sources.map(file => this.projectPath(file.fileName)!).sort(ordinal);
    return [{ outputId: this.outputId, format: 'typescript-scope-1', value: { root: { ...this.snapshot.root }, configFile: this.configFile ?? null,
      files, excludeNames: [...this.snapshot.excludeNames], excluded: [...new Set([...this.snapshot.excluded,
        ...this.snapshot.files.filter(file => /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(file.path) && !files.includes(file.path)).map(file => file.path)])].sort(ordinal) } },
      ...[...new Set([...files, ...this.configurations])].sort(ordinal).map(file => ({ outputId: this.outputId, format: 'typescript-file-1', value: { file } }))];
  }
  nativeDiagnostic(error: ts.Diagnostic): Diagnostic {
    const location = (item: ts.Diagnostic) => diagnostic('', '', item.file ? this.projectPath(item.file.fileName) ?? '<standard-library>' : this.configFile ?? '<default-profile>', item.start, item.length).at;
    return { code: 'typescript-' + error.code, message: ts.flattenDiagnosticMessageText(error.messageText, '\n'), at: location(error), related: error.relatedInformation?.map(location) ?? [] };
  }
}

// Pinned TypeScript exposes its own config glob walker at runtime, outside the declaration file.
type MatchFiles = (path: string, extensions: readonly string[] | undefined, excludes: readonly string[] | undefined,
  includes: readonly string[] | undefined, sensitive: boolean, cwd: string, depth: number | undefined,
  entries: (path: string) => { files: readonly string[]; directories: readonly string[] }, realpath: (path: string) => string) => string[];
const nativeMatchFiles = (ts as unknown as { matchFiles: MatchFiles }).matchFiles;
if (typeof nativeMatchFiles !== 'function') throw Error('The pinned TypeScript dependency must expose its native matchFiles configuration walker.');
