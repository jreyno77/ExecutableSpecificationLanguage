import { dirname, isAbsolute, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Check, Diagnostic } from '../../compiler/checking.js';
import type { Configuration } from './configuration.js';
import { configurationSchema } from './configuration-schema.js';
import { jsonData } from '../../model/identity-baseline.js';
import { ProjectConnector, nativePath, type ProjectContext } from './project-connection.js';
import { FileProjectWriter, type FileChange, type WriteResult } from './project-writer.js';
import { InitializationDestination, reject } from './initialization-destination.js';
import { initialConfiguration, starter } from '../typescript/initialization-profile.js';
import { javaStarter } from '../java/java-initialization.js';

export interface InitializationPlan {
  readonly root: string;
  readonly target: 'typescript' | 'java';
  readonly configuration: Configuration;
  readonly changes: readonly FileChange[];
}
export interface InitializationResult extends Check<{ readonly context: ProjectContext; readonly configuration: Configuration }> {
  readonly status: 'declined' | 'applied' | 'stopped';
  readonly createdRoot?: string;
  readonly write?: WriteResult;
}
export class ProjectInitializer {
  private readonly configuration: Configuration;
  private readonly plans = new WeakMap<InitializationPlan, { plan: InitializationPlan; destination: InitializationDestination }>();
  private readonly attempted = new WeakSet<InitializationPlan>();
  constructor(private readonly manifestLocation: string, configuration: Configuration) {
    if (!nativePath(manifestLocation) || !isAbsolute(manifestLocation) || !jsonData(configuration as unknown)
      || typeof configuration?.sourceId !== 'string') throw new TypeError('Provide an absolute manifest filename and a validated configuration.');
    const { sourceId, ...data } = configuration;
    if (!configurationSchema.safeParse(data).success) throw new TypeError('Provide a validated configuration.');
    this.configuration = structuredClone(configuration);
  }
  async prepare(choice: { readonly root: string; readonly target: string; readonly javaHome?: string }): Promise<Check<InitializationPlan>> {
    if (!choice || !nativePath(choice.root) || typeof choice.target !== 'string') throw new TypeError('Provide a native destination and a target identifier.');
    const path = resolve(dirname(this.manifestLocation), choice.root);
    try {
      if (choice.target !== 'typescript' && choice.target !== 'java') reject('unsupported-initialization-target', path, `Unsupported initialization target ${choice.target}.`);
      const destination = await InitializationDestination.capture(path);
      const java = choice.target === 'java' ? await javaStarter(this.configuration, choice.root, choice.javaHome ?? '') : undefined;
      if (java && !java.value) return { problems: java.problems, deferred: java.deferred };
      const configuration = java?.value?.configuration ?? initialConfiguration(this.configuration, choice.root);
      const plan: InitializationPlan = { root: path, target: choice.target as InitializationPlan['target'], configuration,
        changes: java?.value?.changes ?? starter(configuration.version) };
      this.plans.set(plan, { plan: structuredClone(plan), destination });
      return { value: plan, problems: [], deferred: [] };
    } catch (error) { return { problems: [finding(error, path)], deferred: [] }; }
  }
  async apply(plan: InitializationPlan, accepted: boolean, signal?: AbortSignal): Promise<InitializationResult> {
    const captured = this.plans.get(plan);
    if (!captured || !isDeepStrictEqual(plan, captured.plan) || typeof accepted !== 'boolean'
      || signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Use an unchanged preview from this initializer and an explicit acceptance decision.');
    if (!accepted) return { status: 'declined', problems: [], deferred: [] };
    const destination = captured.destination, path = captured.plan.root, problems: Diagnostic[] = [];
    let write: WriteResult | undefined, ownsAttempt = false;
    try {
      if (this.attempted.has(plan)) reject('initialization-already-attempted', path, 'Prepare a fresh destination after inspecting the previous outcome.');
      this.attempted.add(plan); ownsAttempt = true;
      const cancelled = () => { if (signal?.aborted) reject('initialization-cancelled', path, 'Initialization was cancelled.'); };
      cancelled(); await destination.verifyEmpty(); cancelled(); await destination.create();
      await destination.verifyEmpty(); cancelled();
      const connected = await new ProjectConnector(this.manifestLocation).connect(captured.plan.configuration);
      if (connected.value?.status !== 'connected') { problems.push(...connected.problems); reject('initialization-connection-failed', path, 'The chosen project could not be connected.'); }
      const context = connected.value.context;
      await destination.verifyIdentity();
      const basedOn = await context.readSnapshot();
      if (!basedOn.complete || basedOn.files.length || basedOn.excluded.length || basedOn.problems.length) {
        problems.push(...basedOn.problems); reject('destination-changed', path, 'The chosen destination is no longer empty and fully observed.');
      }
      await destination.verifyEmpty(); cancelled();
      write = await new FileProjectWriter(context).apply({ basedOn, changes: captured.plan.changes }, signal);
      if (write.status !== 'applied' || write.problems.length) problems.push(...write.problems);
      else {
        await destination.verifyIdentity(); cancelled();
        return { status: 'applied', value: { context, configuration: structuredClone(captured.plan.configuration) },
          ...(ownsAttempt && destination.created ? { createdRoot: destination.created } : {}), write, problems: [], deferred: [] };
      }
      if (!problems.length) reject('initialization-incomplete', path, 'The starter files were not all applied.');
    } catch (error) { problems.push(finding(error, path)); }
    return { status: 'stopped', ...(ownsAttempt && destination.created ? { createdRoot: destination.created } : {}), ...(write ? { write } : {}), problems, deferred: [] };
  }
}
function finding(error: unknown, path: string): Diagnostic {
  if (error && typeof error === 'object' && 'diagnostic' in error) return (error as { diagnostic: Diagnostic }).diagnostic;
  return { code: 'initialization-failed', message: String(error), at: { kind: 'dependency', path: ['initialization', path] }, related: [] };
}
