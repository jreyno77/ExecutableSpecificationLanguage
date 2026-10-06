import type { ProjectContext, ProjectRoot, ProjectSnapshot } from '../connection/project-connection.js';
import { NativeDeclarations } from './native-declarations.js';
import { TypeScriptCapture, diagnostic, pathValid, requireInput } from './typescript-capture.js';
import { packagePath, validateReadOnly } from '../connection/project-readonly.js';
import { isDeepStrictEqual } from 'node:util';

/** Captures installed native declaration evidence without granting project write ownership. */
export class TypeScriptContext implements ProjectContext {
  private readonly options: { configFile?: string; imports?: readonly string[] };
  private readonly libraries = new Map<string, string>();
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
    const problems = [...snapshot.problems], native = new NativeDeclarations(snapshot.root, this.options.imports ?? []);
    if (!snapshot.excludeNames.includes('node_modules') || snapshot.files.some(file => packagePath(file.path))) problems.push(diagnostic('unsupported-native-input', 'Native dependencies must remain excluded from editable capture.', 'node_modules'));
    if (!problems.length) {
      const capture = new TypeScriptCapture({ ...snapshot, readOnlyFiles: [] }, 'native-inputs', this.options.configFile, this.libraries, native);
      try {
        for (const problem of capture.problems) {
          if (problem.code === 'native-input-unavailable') problems.push(problem);
          else if (/^typescript-(2307|2688|2726|2727|6053|6231|5083|2792|7016)$/.test(problem.code) || problem.code === 'missing-project-config') problems.push({ ...problem, code: 'native-input-unavailable' });
          else if (['unsupported-native-input', 'unsupported-project-config', 'typescript-library-unavailable', 'invalid-project-encoding'].includes(problem.code)) problems.push(problem);
        }
      } finally { capture.service.dispose(); }
    }
    const fresh = await this.project.readSnapshot();
    if (!isDeepStrictEqual(snapshot, structuredClone(fresh))) problems.push(diagnostic('stale-project', 'Project inputs changed during native capture.', ''));
    for (const file of snapshot.readOnlyFiles ?? []) {
      const current = native.read(file.path);
      if (current === undefined || native.files.get(file.path)?.version !== file.version) problems.push(diagnostic('stale-project', 'Previously supplied native evidence changed.', file.path));
    }
    native.verify(); problems.push(...native.problems);
    const readOnlyFiles = [...native.files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return { ...snapshot, readOnlyFiles, complete: problems.length === 0, problems };
  }
}
