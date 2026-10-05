import type { ProjectContext, ProjectRoot, ProjectSnapshot } from '../connection/project-connection.js';
import { isDeepStrictEqual } from 'node:util';
import { callerOptions, javaContextOptions, javaProblem, requireJava, javaSnapshot } from './java-settings.js';
import { javaInputs } from './java-inputs.js';

/** Captures explicitly selected Java inputs without acquiring dependencies. */
export class JavaContext implements ProjectContext {
  private readonly file: string;
  constructor(private readonly project: ProjectContext, options: { configFile?: string } = {}) {
    requireJava(project && typeof project.readSnapshot === 'function' && typeof project.root?.path === 'string'
      && typeof project.root.identity === 'string', 'Provide a ProjectContext.');
    callerOptions(javaContextOptions, options); this.file = options.configFile ?? 'expec.java.json';
  }
  get root(): ProjectRoot { return { ...this.project.root }; }
  async readSnapshot(): Promise<ProjectSnapshot> {
    const snapshot = structuredClone(await this.project.readSnapshot()); javaSnapshot(snapshot);
    const captured = await javaInputs(snapshot, this.file, true), evidence = new Map(snapshot.nativeInputs?.map(input => [input.uri, input.version]));
    for (const input of captured.nativeInputs) {
      const previous = evidence.get(input.uri);
      if (previous && previous !== input.version) captured.problems.push(javaProblem('native-input-changed', 'Upstream native evidence contradicts the selected Java input.', this.file, input.uri));
      else evidence.set(input.uri, input.version);
    }
    const fresh = structuredClone(await this.project.readSnapshot());
    if (!isDeepStrictEqual(snapshot, fresh)) captured.problems.push(javaProblem('stale-project', 'Project changed while native inputs were captured.', this.file));
    return { ...snapshot, nativeInputs: [...evidence].map(([uri, version]) => ({ uri, version })).sort((a, b) => a.uri < b.uri ? -1 : 1), complete: !captured.problems.length, problems: captured.problems };
  }
}
