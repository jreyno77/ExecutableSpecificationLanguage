import type { ProjectContext, ProjectRoot, ProjectSnapshot } from '../connection/project-connection.js';
import { NativeDeclarations } from './native-declarations.js';
import { TypeScriptCapture, diagnostic, pathValid, requireInput } from './typescript-capture.js';
import { packagePath, validateReadOnly } from '../connection/project-readonly.js';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';

/** Captures installed native declaration evidence without granting project write ownership. */
export class TypeScriptContext implements ProjectContext {
  private readonly options: { configFile?: string; imports?: readonly string[] };
  private readonly libraries = new Map<string, string>();
  private retained: { key: ReturnType<typeof inputKey>; native: NativeDeclarations } | undefined;
  constructor(private readonly project: ProjectContext, options: { configFile?: string; imports?: readonly string[] } = {}) {
    requireInput(project && typeof project.readSnapshot === 'function' && project.root && typeof project.root.path === 'string' && typeof project.root.identity === 'string', 'Provide a ProjectContext.');
    requireInput(options && typeof options === 'object' && !Array.isArray(options) && Object.keys(options).every(key => ['configFile', 'imports'].includes(key))
      && (options.configFile === undefined || pathValid(options.configFile))
      && (options.imports === undefined || Array.isArray(options.imports) && options.imports.every(name => typeof name === 'string' && !!name.trim()
        && name === name.trim() && !/[\\:\s\0]/.test(name) && !name.startsWith('.') && !name.startsWith('/')
        && name.split('/').every(part => !!part && part !== '.' && part !== '..')) && new Set(options.imports).size === options.imports.length), 'Provide valid native configuration and unique bare import specifiers.');
    this.options = structuredClone(options);
  }
  get root(): ProjectRoot { return { ...this.project.root }; }
  async readSnapshot(): Promise<ProjectSnapshot> {
    const snapshot = structuredClone(await this.project.readSnapshot());
    requireInput(validateReadOnly({ ...snapshot, files: snapshot.files.filter(file => !packagePath(file.path)) }), 'Malformed read-only native inputs.');
    const key = inputKey(snapshot), retained = this.retained;
    const reused = retained !== undefined && isDeepStrictEqual(key, retained.key) && retained.native.unchanged();
    if (!reused && this.retained === retained) this.retained = undefined;
    const problems = [...snapshot.problems], native = reused ? retained.native : new NativeDeclarations(snapshot.root, this.options.imports ?? []);
    if (!snapshot.excludeNames.includes('node_modules') || snapshot.files.some(file => packagePath(file.path))) problems.push(diagnostic('unsupported-native-input', 'Native dependencies must remain excluded from editable capture.', 'node_modules'));
    if (!problems.length && !reused) {
      const capture = new TypeScriptCapture({ ...snapshot, readOnlyFiles: [] }, 'native-inputs', this.options.configFile, this.libraries, native);
      try {
        for (const problem of capture.problems) {
          if (capture.editableImportProblems.has(problem)) continue;
          if (problem.code === 'native-input-unavailable') problems.push(problem);
          else if (/^typescript-(2307|2688|2726|2727|6053|6231|5083|2792|7016)$/.test(problem.code) || problem.code === 'missing-project-config') problems.push({ ...problem, code: 'native-input-unavailable' });
          else if (['unsupported-native-input', 'unsupported-project-config', 'typescript-library-unavailable', 'invalid-project-encoding'].includes(problem.code)) problems.push(problem);
        }
      } finally { capture.service.dispose(); }
    }
    const fresh = await this.project.readSnapshot();
    if (!isDeepStrictEqual(key, inputKey(fresh))) problems.push(diagnostic('stale-project', 'Project inputs changed during native capture.', ''));
    for (const file of snapshot.readOnlyFiles ?? []) {
      if (!reused) native.read(file.path);
      const current = native.files.get(file.path);
      if (!current || current.version !== file.version) problems.push(diagnostic('stale-project', 'Previously supplied native evidence changed.', file.path));
    }
    if (!reused) { native.verify(); problems.push(...native.problems); }
    if (!problems.length && !native.unchanged()) problems.push(diagnostic('stale-project', 'Native inputs changed while completing capture.', ''));
    if (!problems.length) { if (!reused) this.retained = { key, native }; }
    else if (this.retained?.native === native) this.retained = undefined;
    const readOnlyFiles = structuredClone([...native.files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { ...snapshot, readOnlyFiles, complete: problems.length === 0, problems };
  }
}

function inputKey(snapshot: ProjectSnapshot) {
  const file = (value: ProjectSnapshot['files'][number]) => ({ ...value,
    bytes: createHash('sha256').update(value.bytes).digest('hex') });
  return structuredClone({ ...snapshot, files: snapshot.files.map(file),
    ...(snapshot.readOnlyFiles === undefined ? {} : { readOnlyFiles: snapshot.readOnlyFiles.map(file) }) });
}
