import { z } from 'zod';
import type { OutputAdapter, OutputContext, OutputPlan, OutputRegistration, OutputRequest } from '../output/output.js';
import type { Check } from '../../compiler/checking.js';
import type { ProjectSnapshot } from '../connection/project-connection.js';
import { canonical, failure, success } from '../../model/identity-baseline.js';
import { JavaProject } from './java-project.js';
import { javaOptions, javaProblem, optionProblems } from './java-settings.js';
import { JavaDeclarations } from './java-declarations.js';
import { hash } from '../connection/project-files.js';
import { JavaAnalysis } from './java-analysis.js';
import { readJavaOutputState } from './java-output-state.js';
import { JavaPreservation, type JavaBaseline } from './java-preservation.js';
import { validDiff } from '../output/output-contract.js';
import type { JavaMappingState } from './java-mappings.js';
import type { Diagnostic } from '../../compiler/checking.js';
import type { FileChange } from '../connection/project-writer.js';

const statePath = '.expec/outputs/java.json';


export const javaOutput: OutputRegistration = {
  id: 'java', validate: value => optionProblems(javaOptions, value),
  open: (options, context) => new JavaOutput(javaOptions.parse(options), context),
};

class JavaOutput implements OutputAdapter {
  readonly id = 'java';
  constructor(private readonly options: z.infer<typeof javaOptions>, private readonly context?: OutputContext) {}
  private project(snapshot: ProjectSnapshot) {
    const state = readJavaOutputState(this.id,this.options,javaOptions,snapshot);
    return { state, project: new JavaProject({ outputId: this.id, configFile: this.options.configFile ?? 'expec.java.json' }, state.value?.files.flatMap(file => file.artifacts) ?? []) };
  }
  async read(id: string, snapshot: ProjectSnapshot) {
    const { state, project } = this.project(snapshot), result = await project.read(id, snapshot);
    return { ...result, problems: [...state.problems, ...result.problems], coverage: { ...result.coverage,
      complete: !state.problems.length && result.coverage.complete, limitations: [...result.coverage.limitations, ...state.problems.map(item => item.message)] } };
  }
  async search(id: string, snapshot: ProjectSnapshot) {
    const { state, project } = this.project(snapshot), result = await project.search(id, snapshot);
    const direction = (value: typeof result.incoming) => ({ ...value, coverage: { ...value.coverage, complete: !state.problems.length && value.coverage.complete,
      limitations: [...value.coverage.limitations, ...state.problems.map(item => item.message)] } });
    return { ...result, problems: [...state.problems, ...result.problems], incoming: direction(result.incoming), outgoing: direction(result.outgoing) };
  }
  async plan(request: OutputRequest, snapshot: ProjectSnapshot): Promise<Check<OutputPlan>> {
    if (!snapshot.complete || snapshot.problems.length) return { problems: snapshot.problems, deferred: [] };
    const stored = readJavaOutputState(this.id,this.options,javaOptions,snapshot); if (stored.problems.length) return { problems: stored.problems, deferred: [] };
    const analysis = new JavaAnalysis(this.options.configFile ?? 'expec.java.json');
    if (request.operation === 'delete') {
      const preservation = new JavaPreservation(snapshot, analysis);
      const changed = await preservation.remove(stored.value?.files ?? [], request.id);
      return preservation.problems.length ? { problems: preservation.problems, deferred: [] } : this.changed(snapshot, changed.files, changed.changes, preservation.obligations, stored.value?.mappings);
    }
    if ('diff' in request && !validDiff(request.diff, request.current)) return failure('inconsistent-diff', 'The transition disagrees with current checked identity.');
    if (request.operation === 'insert' && (request.diff.contextChanged || request.diff.changes.some(change => change.kinds.some(kind => kind !== 'add' && kind !== 'artifacts'))))
      return failure('not-addition-only', 'Use update for existing contract changes.');
    const projection = new JavaDeclarations(request.current, this.options, this.context), files = projection.files();
    projection.mappings.check(stored.value?.mappings);
    const problems = [...projection.problems];
    if (problems.length) return { problems, deferred: [] };
    if (stored.value) {
      const preservation = new JavaPreservation(snapshot, analysis);
      const changed = await preservation.update(stored.value.files, files);
      if (preservation.problems.length) return { problems: preservation.problems, deferred: [] };
      return this.changed(snapshot, changed.files, changed.changes, [...projection.obligations, ...preservation.obligations], projection.mappings.capture());
    }
    for (const file of files) if (!this.options.adoptExisting && snapshot.files.some(existing => existing.path === file.path))
      problems.push(javaProblem('output-conflict', 'Existing Java file needs explicit ownership/adoption.', file.path));
    if (problems.length) return { problems, deferred: [] };
    let baselines: JavaBaseline[] = files.map(file => ({ ...file, hash: hash(Buffer.from(file.generated)), renderedArtifacts: structuredClone(file.artifacts), adopted: [] }));
    if (this.options.adoptExisting) {
      const preservation = new JavaPreservation(snapshot, analysis);
      baselines = await preservation.adopt(files, request.current.baseline.artifacts);
      if (preservation.problems.length) return { problems: preservation.problems, deferred: [] };
    }
    const additions = baselines.filter(file => !file.adopted?.length).map(file => ({ path: file.path, bytes: Buffer.from(file.generated), version: hash(Buffer.from(file.generated)) }));
    const analyzed = await analysis.read({ ...snapshot, files: [...snapshot.files, ...additions] });
    if (analyzed.problems.length) return { problems: analyzed.problems, deferred: [] };
    return this.changed(snapshot, baselines, additions.map(file => ({ kind: 'write', path: file.path, bytes: file.bytes })), projection.obligations, projection.mappings.capture());
  }
  private changed(snapshot: ProjectSnapshot, files: readonly JavaBaseline[], changes: readonly FileChange[], obligations: readonly Diagnostic[] = [], mappings?:JavaMappingState): Check<OutputPlan> {
    const state = Buffer.from(canonical({ format: 1, options: this.options, files, ...mappings?{mappings}:{} }, 2) + '\n');
    const proposed: FileChange[] = [...changes, { kind: 'write', path: statePath, bytes: state }];
    return success({ outputId: this.id, basedOn: snapshot, ...obligations.length ? { obligations } : {}, artifacts: files.flatMap(file => file.artifacts), changes: proposed.filter(change => {
      if (change.kind !== 'write') return true;
      const previous = snapshot.files.find(file => file.path === change.path);
      return !previous || !Buffer.from(previous.bytes).equals(Buffer.from(change.bytes));
    }) });
  }
}
