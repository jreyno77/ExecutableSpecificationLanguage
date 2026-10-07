import { promises as fs } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import type { CheckedManifest } from './cli-check.js';
import { cliProblem } from './cli-check.js';
import type { Configuration } from '../project/connection/configuration.js';
import type { ProjectContext, ProjectSnapshot } from '../project/connection/project-connection.js';
import { hash } from '../project/connection/project-files.js';
import { TypeScriptContext } from '../project/typescript/typescript-context.js';
import { nativeInputs } from '../project/connection/native-inputs.js';
import { JavaContext } from '../project/java/java-context.js';
import { KotlinContext } from '../project/kotlin/kotlin-context.js';
import { PythonContext } from '../project/python/python-context.js';

/** Reacquires each selected native configuration and the actual compilation inputs. */
export class BuildContext implements ProjectContext {
  private readonly native: ProjectContext[];
  private readonly inputs: { uri: string; version: string }[];
  constructor(private readonly project: ProjectContext, private readonly checked: CheckedManifest,
    private readonly selected: Configuration['outputs'], inputs: readonly { uri: string; version: string }[] = [], private readonly acquisition?: ProjectSnapshot) {
    const options = selected.filter(output => output.id === 'typescript' || output.id === 'acceptance').map(output => ({
      ...(typeof output.options.configFile === 'string' ? { configFile: output.options.configFile } : {}),
      imports: [...new Set([...(output.id === 'acceptance' ? ['vitest'] : []), ...((output.options.imports ?? []) as { from?: string }[])
        .flatMap(item => item.from && !/^[./]|:/.test(item.from) ? [item.from] : [])])],
    }));
    const nativeProject = acquisition ? { root: project.root, readSnapshot: async () => structuredClone(acquisition) } : project;
    this.native = [...new Map(options.map(value => [JSON.stringify(value), value])).values()].map(value => new TypeScriptContext(nativeProject, value));
    if (checked.profile?.target === 'java') this.native.push(new JavaContext(nativeProject, { configFile: checked.profile.configFile! }));
    if (checked.profile?.target === 'kotlin') this.native.push(new KotlinContext(nativeProject));
    if (checked.profile?.target === 'python') this.native.push(new PythonContext(nativeProject, checked.profile.configFile ? { configFile: checked.profile.configFile } : {}));
    this.inputs = [{ uri: pathToFileURL(checked.manifest).href, version: hash(Buffer.from(checked.text!)) },
      ...checked.captures.map(capture => ({ uri: capture.source.sourceId, version: capture.version.replace(/^sha256:/, '') })), ...checked.packageInputs ?? [], ...inputs];
  }
  get root() { return this.project.root; }
  during(original: ProjectSnapshot): BuildContext {
    return new BuildContext(this.project, this.checked, this.selected, [...this.inputs, ...original.nativeInputs ?? []], { ...original, readOnlyFiles: [] });
  }
  async readSnapshot(): Promise<ProjectSnapshot> {
    const snapshot = await this.project.readSnapshot(), problems = [...snapshot.problems], evidence = [...snapshot.nativeInputs ?? [], ...this.inputs];
    let complete = snapshot.complete;
    const native = new Map((snapshot.readOnlyFiles ?? []).map(file => [file.path, file]));
    for (const context of this.native) {
      const captured = await context.readSnapshot();
      problems.push(...captured.problems); complete &&= captured.complete; evidence.push(...captured.nativeInputs ?? []);
      if ((!this.acquisition && !isDeepStrictEqual(structuredClone(snapshot.files), structuredClone(captured.files))) || !isDeepStrictEqual(snapshot.root, captured.root)
        || !isDeepStrictEqual(snapshot.excluded, captured.excluded) || !isDeepStrictEqual(snapshot.excludeNames, captured.excludeNames)) problems.push(cliProblem('stale-project', 'Native configurations observed different project bytes.', this.checked.manifest));
      for (const file of captured.readOnlyFiles ?? []) {
        const previous = native.get(file.path);
        if (previous && (previous.version !== file.version || !Buffer.from(previous.bytes).equals(file.bytes))) problems.push(cliProblem('stale-project', 'Native configurations disagree at ' + file.path, this.checked.manifest));
        native.set(file.path, file);
      }
    }
    const inputs = new Map<string, { uri: string; version: string }>();
    for (const input of evidence) {
      const key = nativeInputs({ ...snapshot, nativeInputs: [input] })?.keys().next().value;
      if (!key || inputs.has(key) && inputs.get(key)!.version !== input.version) {
        problems.push(cliProblem('stale-build-input', 'Conflicting or malformed native evidence: ' + input.uri, this.checked.manifest)); continue;
      }
      inputs.set(key, input);
    }
    for (const input of inputs.values()) try {
      const path = fileURLToPath(input.uri), before = await fs.lstat(path, { bigint: true }), bytes = await fs.readFile(path), after = await fs.lstat(path, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.mtimeNs !== after.mtimeNs
        || hash(bytes) !== input.version) throw Error('Source bytes or route changed.');
    } catch (error) { problems.push(cliProblem('stale-build-input', input.uri + ': ' + String(error), this.checked.manifest)); }
    const fresh = await this.project.readSnapshot();
    if (!isDeepStrictEqual(snapshot, fresh)) problems.push(cliProblem('stale-project', 'The project changed while collecting build evidence.', this.checked.manifest));
    return { ...snapshot, readOnlyFiles: [...native.values()].sort((a, b) => a.path.localeCompare(b.path)),
      nativeInputs: [...inputs.values()], complete: complete && fresh.complete && !problems.length, problems };
  }
}
