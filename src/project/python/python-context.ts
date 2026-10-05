import type { ProjectContext, ProjectRoot, ProjectSnapshot } from '../connection/project-connection.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { pythonConfiguration, pythonPath } from './python-profile.js';
import { outputProblem } from '../output/specification/output-documents.js';
import { PythonInputs, pythonEnvironment } from './python-inputs.js';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { nativeInputs } from '../connection/native-inputs.js';
import { canonical } from '../../model/identity-baseline.js';

/** Adds Python's captured native inputs to the caller's live project boundary. */
export class PythonContext implements ProjectContext {
  private captured: { key: string; inputs: PythonInputs } | undefined;
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
    const supplied = nativeInputs(snapshot), combined = supplied ? [...snapshot.nativeInputs ?? []] : [];
    if (!supplied) problems.push(outputProblem('native-inputs-unavailable', '', 'Upstream native evidence is malformed.'));
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
      const environment = pythonEnvironment(snapshot, checked.value, this.options.configFile); problems.push(...environment.problems);
      if (!problems.length && environment.value) {
        const key = canonical([snapshot.root, checked.value, environment.value, this.options]);
        let inputs = this.captured?.key === key ? this.captured.inputs : undefined;
        if (inputs && (await inputs.verify()).length) { this.captured = undefined; inputs = undefined; }
        if (!inputs) { inputs = new PythonInputs(); await inputs.capture(environment.value, checked.value); }
        problems.push(...inputs.problems);
        for (const input of inputs.evidence()) {
          const path = fileURLToPath(input.uri), previous = supplied!.get(process.platform === 'win32' ? path.toLowerCase() : path);
          if (previous === undefined) combined.push(input);
          else if (previous !== input.version) problems.push(outputProblem('native-input-conflict', input.uri, 'Upstream and Python evidence disagree for this native file.'));
        }
        const fresh = await this.project.readSnapshot();
        if (!isDeepStrictEqual(snapshot, structuredClone(fresh))) problems.push(outputProblem('stale-project', '', 'Project inputs changed during Python capture.'));
        if (snapshot.complete && !problems.length) this.captured = { key, inputs };
        return { ...snapshot, nativeInputs: combined.sort((a, b) => a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0), complete: snapshot.complete && problems.length === 0, problems };
      }
    }
    return { ...snapshot, complete: snapshot.complete && problems.length === 0, problems };
  }
}
