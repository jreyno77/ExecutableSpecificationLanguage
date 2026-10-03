import type { ProjectContext, ProjectRoot, ProjectSnapshot } from './project-connection.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { pythonConfiguration, pythonPath, pythonReportPath } from './python-profile.js';
import { outputProblem } from './output-documents.js';

/** Adds Python's captured native inputs to the caller's live project boundary. */
export class PythonContext implements ProjectContext {
  private readonly options: { configFile?: string };
  constructor(private readonly project: ProjectContext, options: { configFile?: string } = {}) {
    if (!project?.root || typeof project.root.path !== 'string' || typeof project.root.identity !== 'string' || typeof project.readSnapshot !== 'function'
      || !options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'configFile')
      || options.configFile !== undefined && (typeof options.configFile !== 'string' || !pythonPath(options.configFile))) throw new TypeError('Provide a ProjectContext and a portable Python configuration filename.');
    this.options = structuredClone(options);
  }
  get root(): ProjectRoot { return { ...this.project.root }; }
  async readSnapshot(): Promise<ProjectSnapshot> {
    const snapshot = structuredClone(await this.project.readSnapshot()), checked = pythonConfiguration(snapshot, this.options.configFile), problems = [...snapshot.problems, ...checked.problems];
    if (checked.value) {
      for (const excluded of snapshot.excluded.filter(path => [...checked.value!.sourceRoots.main, ...checked.value!.sourceRoots.test].some(root => path === root || path.startsWith(root + '/')))) {
        let cache = false;
        if (excluded.split('/').at(-1) === '__pycache__') try {
          const path = join(snapshot.root.path, excluded), before = await fs.lstat(path, { bigint: true });
          if (before.isDirectory() && !before.isSymbolicLink()) {
            const entries = await fs.readdir(path, { withFileTypes: true }), after = await fs.lstat(path, { bigint: true });
            cache = entries.every(entry => entry.isFile() && entry.name.endsWith('.pyc')) && before.dev === after.dev && before.ino === after.ino && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
          }
        } catch { /* Missing or changing entries cannot establish a harmless cache. */ }
        if (!cache) problems.push(outputProblem('excluded-python-input', excluded, 'A selected Python source entry is excluded or unavailable.'));
      }
      if (!snapshot.files.some(file => file.path === pythonReportPath)) problems.push(outputProblem('python-install-required', pythonReportPath, 'Run an explicit Python install before using native project analysis.'));
      else problems.push(outputProblem('python-capture-unavailable', pythonReportPath, 'Native Python input capture is not implemented yet.'));
    }
    return { ...snapshot, complete: snapshot.complete && problems.length === 0, problems };
  }
}
