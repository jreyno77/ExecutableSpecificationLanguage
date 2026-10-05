import type { OutputAdapter, OutputContext, OutputPlan, OutputRegistration, OutputRequest } from '../output/output.js';
import type { Check } from '../../compiler/checking.js';
import type { ProjectSnapshot } from '../connection/project-connection.js';
import type { ProjectRead, ProjectSearch } from '../connection/project-inspection.js';
import { KotlinDeclarations, kotlinOptions, type KotlinFile, type KotlinOptions } from './kotlin-declarations.js';
import { outputProblem } from '../output/specification/output-documents.js';
import { canonical, success } from '../../model/identity-baseline.js';
import { hash } from '../connection/project-files.js';
import { KotlinProject } from './kotlin-project.js';
import { adoptKotlin } from './kotlin-adoption.js';
import { preserveKotlin, retireKotlin } from './kotlin-preservation.js';
import { nativeInputs } from '../connection/native-inputs.js';
import { validDiff } from '../output/output-contract.js';
import { kotlinConfiguration } from './kotlin-configuration.js';
import { checkKotlinImports } from './kotlin-imports.js';
import { kotlinState, kotlinStatePath as statePath, type KotlinOutputState } from './kotlin-output-state.js';

export const kotlinOutput: OutputRegistration = {
  id: 'kotlin', validate: options => {
    const result = kotlinOptions.safeParse(options);
    return result.success ? [] : result.error.issues.map(issue => ({ path: issue.path as (string | number)[], message: issue.message }));
  },
  open: (options, context) => new KotlinOutput(kotlinOptions.parse(options), context),
};

function documentation(file: KotlinFile, previous?: KotlinOutputState['files'][number]): { documentation: string[] } | Record<string, never> {
  if (!file.adopted) return {};
  const owned = new Set(previous?.documentation ?? []), prior = new Set(previous?.artifacts.map(item => item.specId));
  if (previous) for (const artifact of file.artifacts) if (!prior.has(artifact.specId)) owned.add(artifact.specId);
  return { documentation: [...owned].filter(id => file.artifacts.some(item => item.specId === id)).sort() };
}

class KotlinOutput implements OutputAdapter {
  readonly id = 'kotlin';
  constructor(private readonly options: KotlinOptions, private readonly context?: OutputContext) {}
  async plan(request: OutputRequest, snapshot: ProjectSnapshot): Promise<Check<OutputPlan>> {
    if (!snapshot.complete || snapshot.problems.length) return { problems: [...snapshot.problems, outputProblem('incomplete-project', '', 'A complete captured project is required.')], deferred: [] };
    if (!nativeInputs(snapshot) || !snapshot.nativeInputs?.length) return { problems: [outputProblem('native-inputs-unavailable', '', 'Supply captured Kotlin native inputs before planning.')], deferred: [] };
    const configuration = kotlinConfiguration(snapshot, 'expec.kotlin.json');
    if (!configuration.value) return { problems: configuration.problems, deferred: [] };
    const stored = kotlinState(snapshot);
    if (stored.problems.length) return { problems: stored.problems, deferred: [] };
    const previous = stored.value;
    const missing = previous?.files.filter(file => !snapshot.files.some(current => current.path === file.path)) ?? [];
    if (missing.length) return { problems: missing.map(file => outputProblem('output-conflict', file.path, 'The recorded generated Kotlin file is missing.')), deferred: [] };
    if (request.operation === 'delete') return this.delete(request.id, snapshot, previous);
    const known = new Set([...request.current.baseline.elements.map(item => item.id), ...request.current.baseline.retired]);
    if (previous?.files.some(file => file.artifacts.some(item => !known.has(item.specId)))) return { problems: [outputProblem('unknown-output-identity', statePath, 'Current identity does not recognize earlier Kotlin output subjects.')], deferred: [] };
    if ('diff' in request && !validDiff(request.diff, request.current)) return { problems: [outputProblem('inconsistent-diff', '', 'The supplied transition disagrees with current identity facts.')], deferred: [] };
    if (request.operation === 'insert' && (request.diff.contextChanged || request.diff.changes.some(change => change.kinds.some(kind => kind !== 'add' && kind !== 'artifacts')))) return { problems: [outputProblem('not-addition-only', '', 'Use update when existing contracts change.')], deferred: [] };
    const declarations = new KotlinDeclarations(request.current, this.options, this.context);
    let files = declarations.render().map(file => {
      const adopted = previous?.files.find(old => old.id === file.id && old.adopted);
      return adopted ? { ...file, adopted: true, path: adopted.path, artifacts: file.artifacts.map(item => ({ ...item, locator: { ...item.locator,
        value: { ...item.locator.value as { file: string }, file: adopted.path },
      } })) } : file;
    });
    if (!previous && this.options.adoptExisting && !declarations.problems.length) {
      const adopted = await adoptKotlin(snapshot, files, request.current.baseline.artifacts, this.options.package);
      if (!adopted.value) return { problems: adopted.problems, deferred: adopted.deferred }; files = adopted.value;
    }
    const mappings = declarations.mapping(), problems = [...declarations.problems];
    if (previous) {
      const fixed = ({ names: _names, imports: _imports, ...options }: KotlinOptions) => canonical(options);
      const changed = new Set([...previous.mappings, ...mappings].map(rule => rule.id));
      const unsafe = [...changed].some(id => previous!.subjects.includes(id)
        && canonical(previous!.mappings.filter(rule => rule.id === id)) !== canonical(mappings.filter(rule => rule.id === id))
        && (previous!.mappings.some(rule => rule.id === id && rule.kind === 'import') || mappings.some(rule => rule.id === id && rule.kind === 'import')
          || !('diff' in request && request.diff.changes.some(change => change.id === id && change.kinds.some(kind => kind === 'rename' || kind === 'move')))));
      if (fixed(kotlinOptions.parse(JSON.parse(previous.options))) !== fixed(this.options) || unsafe) {
        return { problems: [outputProblem('output-options-changed', statePath, 'Retained native mappings and placement require an actual corresponding transition.')], deferred: [] };
      }
    }
    if (request.operation === 'create' && previous?.files.some(before => !files.some(file => file.id === before.id && file.path === before.path && file.text === before.generated))) return { problems: [outputProblem('use-update', statePath, 'Existing Kotlin contracts changed; use update.')], deferred: [] };
    for (const file of files) {
      const existing = snapshot.files.find(existing => existing.path === file.path), before = previous?.files.find(before => before.path === file.path);
      if (request.operation === 'create' && existing && !before && !file.adopted) problems.push(outputProblem('output-conflict', file.path, 'Existing native file needs explicit ownership before changing it.'));
      if (file.path.split('/').some(part => snapshot.excludeNames.includes(part))) problems.push(outputProblem('excluded-kotlin-input', file.path, 'The captured scope excludes this output destination.'));
    }
    const next = { format: 1, deleted: previous?.deleted.filter(id => !files.some(file => file.artifacts.some(item => item.specId === id))) ?? [], options: canonical(this.options), subjects: request.current.baseline.elements.map(item => item.id), mappings, files: files.map(file => ({ ...(file.adopted ? { adopted: true } : {}), ...documentation(file, previous?.files.find(old => old.id === file.id)), id: file.id, path: file.path, generated: file.text, hash: hash(Buffer.from(file.text)), artifacts: file.artifacts })) };
    if (problems.length) return { problems, deferred: [] };
    const imported = await checkKotlinImports(request.current, snapshot, this.options.directory, mappings.filter(item => item.kind === 'import'));
    if (imported.problems.length || imported.deferred.length) return imported;
    const preserved = request.operation === 'create' && !previous ? undefined : await preserveKotlin(snapshot, previous?.files ?? [], files, declarations.constraints);
    if (preserved?.problems.length) problems.push(...preserved.problems);
    const changes = [...(preserved?.value?.changes ?? files.filter(file => !file.adopted).map(file => ({ kind: 'write' as const, path: file.path, bytes: Buffer.from(file.text) }))), { kind: 'write' as const, path: statePath, bytes: Buffer.from(canonical(next, 2) + '\n') }]
      .filter(change => change.kind !== 'write' || !snapshot.files.some(file => file.path === change.path && file.version === hash(change.bytes)));
    return problems.length ? { problems, deferred: [] } : success({ outputId: this.id, basedOn: snapshot, changes, artifacts: files.flatMap(file => file.artifacts),
      obligations: [...declarations.obligations, ...preserved?.value?.obligations ?? []] });
  }
  private async delete(id: string, snapshot: ProjectSnapshot, previous?: KotlinOutputState): Promise<Check<OutputPlan>> {
    if (!previous || !previous.files.some(file => file.artifacts.some(item => item.specId === id)) && !previous.deleted.includes(id)) {
      return { problems: [outputProblem('output-not-found', '', 'No owned Kotlin declaration exists for ' + id)], deferred: [] };
    }
    if (previous.options !== canonical(this.options)) return { problems: [outputProblem('output-options-changed', statePath, 'Reopen the recorded Kotlin options before deleting an owned declaration.')], deferred: [] };
    if (previous.deleted.includes(id)) return success({ outputId: this.id, basedOn: snapshot, changes: [], artifacts: previous.files.flatMap(file => file.artifacts) });
    const retired = await retireKotlin(snapshot, previous.files, id);
    if (!retired.value) return { problems: retired.problems, deferred: retired.deferred };
    const preserved = await preserveKotlin(snapshot, previous.files, retired.value.files, new Set());
    if (!preserved.value) return { problems: preserved.problems, deferred: preserved.deferred };
    const next = { ...previous, deleted: [...new Set([...previous.deleted, ...retired.value.removed])].sort(), files: retired.value.files.map(file => ({
      id: file.id, path: file.path, generated: file.text, hash: hash(Buffer.from(file.text)), artifacts: file.artifacts, ...file.adopted ? { adopted: true } : {}, ...documentation(file, previous.files.find(old => old.id === file.id)),
    })) };
    return success({ outputId: this.id, basedOn: snapshot, changes: [...preserved.value.changes,
      { kind: 'write', path: statePath, bytes: Buffer.from(canonical(next, 2) + '\n') }],
      artifacts: next.files.flatMap(file => file.artifacts), obligations: preserved.value.obligations });
  }
  async read(id: string, snapshot: ProjectSnapshot): Promise<ProjectRead> {
    const stored = kotlinState(snapshot);
    if (stored.problems.length) return { artifacts: [], problems: stored.problems, coverage: {
      scope: [], complete: false, limitations: stored.problems.map(problem => problem.message),
    } };
    return new KotlinProject({ outputId: this.id }, stored.value?.files.flatMap(file => file.artifacts) ?? []).read(id, snapshot);
  }
  async search(id: string, snapshot: ProjectSnapshot): Promise<ProjectSearch> {
    const stored = kotlinState(snapshot);
    if (stored.problems.length) {
      const coverage = { scope: [], complete: false, limitations: stored.problems.map(problem => problem.message) };
      return { definitions: [], problems: stored.problems,
        incoming: { subject: id, direction: 'incoming', coverage, uses: [], unresolved: [] },
        outgoing: { subject: id, direction: 'outgoing', coverage, uses: [], unresolved: [] } };
    }
    return new KotlinProject({ outputId: this.id }, stored.value?.files.flatMap(file => file.artifacts) ?? []).search(id, snapshot);
  }
}
