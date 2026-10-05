import type { Check, Diagnostic } from '../../compiler/checking.js';
import type { OutputProfile } from '../connection/configuration.js';
import type { ProjectContext, ProjectSnapshot } from '../connection/project-connection.js';
import type { ProjectRead, ProjectSearch } from '../connection/project-inspection.js';
import type { ProjectChanges, ProjectWriter, WriteResult } from '../connection/project-writer.js';
import type { ArtifactAssociation, IdentifiedSpecification, SpecDiff, SpecIdentifier } from '../../model/specification-identity.js';
import { canonical, captured, failure, jsonData, success } from '../../model/identity-baseline.js';
import { checkPlan, checkRead, checkSearch } from './output-contract.js';
export { contractListOutput, structureListOutput } from './specification/output-lists.js';

export interface Output {
  create(current: IdentifiedSpecification): Promise<OutputWrite>;
  insert(diff: SpecDiff, current: IdentifiedSpecification): Promise<OutputWrite>;
  update(diff: SpecDiff, current: IdentifiedSpecification): Promise<OutputWrite>;
  read(id: SpecIdentifier): Promise<ProjectRead>;
  search(id: SpecIdentifier): Promise<ProjectSearch>;
  delete(id: SpecIdentifier): Promise<OutputWrite>;
  plan(request: OutputRequest, basedOn: ProjectSnapshot): Promise<Check<OutputPlan>>;
}
export type OutputRequest =
  | { readonly operation: 'create'; readonly current: IdentifiedSpecification }
  | { readonly operation: 'insert' | 'update'; readonly diff: SpecDiff; readonly current: IdentifiedSpecification }
  | { readonly operation: 'delete'; readonly id: SpecIdentifier };
export interface OutputPlan extends ProjectChanges { readonly outputId: string; readonly artifacts: readonly ArtifactAssociation[]; readonly obligations?: readonly Diagnostic[] }
export interface OutputWrite { readonly receipt?: WriteResult; readonly problems: readonly Diagnostic[]; readonly artifacts?: readonly ArtifactAssociation[]; readonly obligations?: readonly Diagnostic[] }
export interface OutputAdapter {
  readonly id: string;
  plan(request: OutputRequest, basedOn: ProjectSnapshot): Promise<Check<OutputPlan>>;
  read(id: SpecIdentifier, basedOn: ProjectSnapshot): Promise<ProjectRead>;
  search(id: SpecIdentifier, basedOn: ProjectSnapshot): Promise<ProjectSearch>;
}
export interface OutputContext { readonly workspaceModules: readonly string[] }
export interface OutputRegistration extends OutputProfile { open(options: Readonly<Record<string, unknown>>, context?: OutputContext): OutputAdapter }
export class ProjectOutput implements Output {
  constructor(private readonly adapter: OutputAdapter, private readonly project: ProjectContext, private readonly writer: ProjectWriter) {
    if (!adapter?.id?.trim() || !['plan', 'read', 'search'].every(key => typeof adapter[key as 'plan'] === 'function')
      || typeof project?.readSnapshot !== 'function' || typeof writer?.apply !== 'function') throw new TypeError('Provide an output adapter, live project, and writer.');
  }
  create(current: IdentifiedSpecification): Promise<OutputWrite> { return this.apply({ operation: 'create', current }); }
  insert(diff: SpecDiff, current: IdentifiedSpecification): Promise<OutputWrite> { return this.apply({ operation: 'insert', diff, current }); }
  update(diff: SpecDiff, current: IdentifiedSpecification): Promise<OutputWrite> { return this.apply({ operation: 'update', diff, current }); }
  delete(id: SpecIdentifier): Promise<OutputWrite> { return this.apply({ operation: 'delete', id }); }
  async plan(request: OutputRequest, basedOn: ProjectSnapshot): Promise<Check<OutputPlan>> {
    const snapshot = structuredClone(basedOn), result = await this.adapter.plan(request, structuredClone(snapshot));
    checkPlan(result, snapshot, this.adapter.id); return observed(result, snapshot);
  }
  private async apply(request: OutputRequest): Promise<OutputWrite> {
    const plan = await this.plan(request, await this.project.readSnapshot());
    if (!plan.value) return { problems: plan.problems };
    const receipt = await this.writer.apply(plan.value);
    return { receipt, problems: receipt.problems, ...plan.value.obligations === undefined ? {} : { obligations: structuredClone(plan.value.obligations) },
      ...(receipt.status === 'stopped' ? {} : { artifacts: structuredClone(plan.value.artifacts) }) };
  }
  async read(id: SpecIdentifier): Promise<ProjectRead> {
    const snapshot = await this.project.readSnapshot(), result = await this.adapter.read(id, structuredClone(snapshot));
    checkRead(result, snapshot, this.adapter.id); return observed(result, snapshot);
  }
  async search(id: SpecIdentifier): Promise<ProjectSearch> {
    const snapshot = await this.project.readSnapshot(), result = await this.adapter.search(id, structuredClone(snapshot));
    checkSearch(result, snapshot, this.adapter.id, id); return observed(result, snapshot);
  }
}
function observed<T extends { readonly problems: readonly Diagnostic[] }>(result: T, snapshot: ProjectSnapshot): T {
  const problems = new Map([...snapshot.problems, ...result.problems].map(problem => [canonical(problem), problem]));
  return structuredClone({ ...result, problems: [...problems.values()] });
}
export class Outputs {
  private readonly registrations = new Map<string, OutputRegistration>();
  register(output: OutputRegistration): void {
    if (!output?.id?.trim() || typeof output.validate !== 'function' || typeof output.open !== 'function'
      || this.registrations.has(output.id)) throw new TypeError('Register a unique nonblank output ID with validate and open.');
    this.registrations.set(output.id, { id: output.id, validate: output.validate.bind(output), open: output.open.bind(output) });
  }
  get profiles(): readonly OutputProfile[] { return [...this.registrations.values()].map(({ id, validate }) => ({ id, validate })); }
  open(id: string, options: Readonly<Record<string, unknown>>, project: ProjectContext, writer: ProjectWriter, context?: OutputContext): Check<Output> {
    const registration = this.registrations.get(id);
    if (!registration) return failure('unknown-output', 'Output is not registered: ' + id, ['outputs', id]);
    if (context !== undefined && (!jsonData(context) || !context || Array.isArray(context) || typeof context !== 'object'
      || Object.keys(context).length !== 1 || !Array.isArray(context.workspaceModules) || context.workspaceModules.some(value => typeof value !== 'string' || !value.trim())
      || new Set(context.workspaceModules).size !== context.workspaceModules.length)) return failure('invalid-output-context', 'Provide only a duplicate-free list of exact nonblank workspace module locators.', ['outputs', id, 'context']);
    if (!jsonData(options) || !options || Array.isArray(options) || typeof options !== 'object') return failure('invalid-output-options', 'Output options must be finite JSON data.', ['outputs', id, 'options']);
    const copy = captured(options), problems = registration.validate(copy);
    if (!Array.isArray(problems) || problems.some(item => !item || typeof item.message !== 'string' || !Array.isArray(item.path))) throw new TypeError('Output validator returned malformed findings.');
    if (problems.length) return { problems: problems.map(item => ({ code: 'invalid-output-options', message: item.message,
      at: { kind: 'dependency', path: ['outputs', id, 'options', ...item.path] }, related: [] })), deferred: [] };
    const adapter = registration.open(copy, context === undefined ? undefined : captured(context));
    if (adapter.id !== id) throw new TypeError('Opened adapter must retain its registered output ID.');
    return success(new ProjectOutput(adapter, project, writer));
  }
}
