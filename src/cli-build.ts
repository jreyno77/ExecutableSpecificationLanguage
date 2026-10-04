import { isDeepStrictEqual } from 'node:util';
import type { Diagnostic } from './checking.js';
import { cliProblem, type CheckedManifest } from './cli-check.js';
import { BuildContext } from './cli-context.js';
import { BuildJournal, pendingStage } from './cli-journal.js';
import { identities, identityPath, pendingPath, readIdentity, readDecisions } from './cli-identity.js';
import type { CommandResult } from './cli-project.js';
import { Outputs, type Output, type OutputPlan } from './output.js';
import type { ProjectContext } from './project-connection.js';
import { FileProjectWriter, type FileChange } from './project-writer.js';

export async function build(checked: CheckedManifest, project: ProjectContext, outputs: Outputs,
  testIds: ReadonlySet<string>, signal: AbortSignal, decisionsFile?: string): Promise<CommandResult & { obligations: Diagnostic[] }> {
  const result: CommandResult & { obligations: Diagnostic[] } = { status: 'invalid', exitCode: 1, project: project.root, problems: [], stages: [], obligations: [] };
  const retain = (obligations: readonly Diagnostic[]) => { for (const obligation of obligations)
    if (!result.obligations.some(before => isDeepStrictEqual(before, obligation))) result.obligations.push(obligation); };
  const configuration = checked.configuration!, selected = configuration.outputs;
  const decisions = await readDecisions(decisionsFile, checked);
  if (!decisions.value) return { ...result, problems: decisions.problems };
  const initial = await project.readSnapshot(), stage = pendingStage(initial);
  if (!initial.complete) return { ...result, problems: initial.problems };
  const allContext = new BuildContext(project, checked, selected.filter(output => testIds.has(output.id) === (stage === 'tests')), decisions.value.inputs);
  const recovered = await new BuildJournal(checked, allContext, signal).recover(initial);
  if (!('value' in recovered)) return { ...result, problems: recovered.problems };
  if (recovered.value) {
    result.stages.push(...recovered.value.stages); retain(recovered.value.obligations ?? []);
    if (recovered.value.exitCode) return { ...result, problems: recovered.value.problems };
  }
  const snapshot = await allContext.readSnapshot();
  if (!snapshot.complete) return { ...result, problems: snapshot.problems };
  const read = readIdentity(snapshot, checked);
  if (!read.value) return { ...result, problems: read.problems };
  const identity = identities(), association = identity.associate(checked.specification!, read.value.baseline, decisions.value.decisions);
  if (!association.value) return { ...result, status: 'action-required', exitCode: 3, problems: association.problems };
  let current = association.value;
  const difference = identity.compare(read.value.baseline, current);
  if (!difference.value) return { ...result, problems: difference.problems };
  const protectedPaths = new Set<string>();
  for (const name of ['contracts', 'tests'] as const) {
    let failureStage: string = name;
    try {
      const profiles = selected.filter(output => testIds.has(output.id) === (name === 'tests'));
      if (!profiles.length) { result.stages.push({ name, status: 'not-run' }); continue; }
      const context = new BuildContext(project, checked, profiles, decisions.value.inputs), basedOn = await context.readSnapshot();
      if (!basedOn.complete) return { ...result, problems: basedOn.problems, stages: [...result.stages, { name, status: 'stopped' }] };
      const writer = new FileProjectWriter(context), plans: OutputPlan[] = [], opened: { id: string; output: Output }[] = [];
      for (const profile of profiles) {
        const output = outputs.open(profile.id, profile.options, context, writer, { workspaceModules: checked.workspaceModules ?? [] });
        if (!output.value) return { ...result, problems: output.problems, stages: [...result.stages, { name, status: 'stopped' }] };
        opened.push({ id: profile.id, output: output.value });
        const plan = await output.value.plan(read.value.baseline ? { operation: 'update', current, diff: difference.value } : { operation: 'create', current }, basedOn);
        if (!plan.value) return { ...result, problems: plan.problems, stages: [...result.stages, { name, status: 'stopped' }] };
        plans.push(plan.value);
      }
      const changes = plans.flatMap(plan => [...plan.changes]), collisions = conflicts(changes, protectedPaths);
      if (collisions.length) return { ...result, problems: collisions.map(path => cliProblem('output-path-conflict', 'Conflicting output endpoint: ' + path, checked.manifest)), stages: [...result.stages, { name, status: 'stopped' }] };
      const confirmed = identity.withArtifacts(current, [...current.baseline.artifacts.filter(item => !profiles.some(profile => profile.id === item.locator.outputId)), ...plans.flatMap(plan => [...plan.artifacts])]);
      if (!confirmed.value) return { ...result, problems: confirmed.problems };
      const applied = await new BuildJournal(checked, context, signal).apply(name, basedOn, plans, confirmed.value.baseline);
      result.stages.push(...applied.stages);
      retain(plans.flatMap(plan => [...plan.obligations ?? []]));
      if (applied.exitCode) return { ...result, problems: applied.problems };
      current = confirmed.value;
      if (name === 'contracts' && selected.some(profile => testIds.has(profile.id))) {
        failureStage = 'tests';
        changes.flatMap(endpoints).forEach(path => protectedPaths.add(path));
        for (const { id: outputId, output } of opened) for (const id of new Set(current.baseline.artifacts.filter(item => item.locator.outputId === outputId).map(item => item.specId))) {
          const read = await output.read(id);
          if (read.problems.length || !read.coverage.complete) return { ...result, problems: [...read.problems, cliProblem('incomplete-output', 'Complete contract artifact evidence is required before test generation.', checked.manifest)], stages: [...result.stages, { name: 'tests', status: 'stopped' }] };
          read.artifacts.forEach(artifact => protectedPaths.add(artifact.file.path));
        }
      }
    } catch (error) {
      return { ...result, status: 'failed', exitCode: 1, problems: [cliProblem('host-failure', String(error), checked.manifest)],
        stages: [...result.stages, { name: failureStage, status: 'stopped' }] };
    }
  }
  return { ...result, status: 'built', exitCode: 0 };
}
const key = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
export const endpoints = (change: FileChange): string[] => change.kind === 'move' ? [change.from, change.to] : [change.path];
function conflicts(changes: readonly FileChange[], protectedPaths: ReadonlySet<string>): string[] {
  const prior = [...protectedPaths, identityPath, pendingPath, '.expec/write.lock'].map(key), problems: string[] = [];
  for (const path of changes.flatMap(endpoints)) {
    const next = key(path);
    if (prior.some(before => before === next || before.startsWith(next + '/') || next.startsWith(before + '/'))) problems.push(path);
    prior.push(next);
  }
  return problems;
}
