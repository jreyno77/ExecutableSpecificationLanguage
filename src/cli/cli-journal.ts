import { z } from 'zod';
import { resolve } from 'node:path';
import { validateReadOnlyFacts } from '../project/connection/project-readonly.js';
import type { Check, Diagnostic } from '../compiler/checking.js';
import { cliProblem, type CheckedManifest } from './cli-check.js';
import { identities, identityBytes, identityPath, pendingPath, readIdentity, transitionPath } from './cli-identity.js';
import type { CommandResult } from './cli-project.js';
import type { BuildContext } from './cli-context.js';
import { nativeInputs } from '../project/connection/native-inputs.js';
import { canonical } from '../model/identity-baseline.js';
import { readJson } from '../project/connection/json-data.js';
import type { OutputPlan } from '../project/output/output.js';
import { checkPlan } from '../project/output/output-contract.js';
import { hash, literal } from '../project/connection/project-files.js';
import type { ProjectContext, ProjectSnapshot } from '../project/connection/project-connection.js';
import { FileProjectWriter, type FileChange, type WriteResult } from '../project/connection/project-writer.js';
import type { IdentityBaseline } from '../model/specification-identity.js';
import { acceptanceOptions } from '../project/typescript/acceptance-bindings.js';
import { acceptanceState, acceptanceStatePath, confirmationOnly } from '../project/typescript/acceptance-state.js';

const pathKey = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
const bytes = z.string().refine(value => Buffer.from(value, 'base64').toString('base64') === value), path = z.string().refine(literal);
const change = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('write'), path, bytes }), z.strictObject({ kind: z.literal('remove'), path }),
  z.strictObject({ kind: z.literal('move'), from: path, to: path, bytes })]);
const graphSchema = z.strictObject({ root: z.strictObject({ path: z.string(), identity: z.string() }),
  files: z.array(z.strictObject({ path, bytes, version: z.string().regex(/^[a-f0-9]{64}$/) })),
  excluded: z.array(path), excludeNames: z.array(z.string()), nativeInputs: z.array(z.strictObject({ uri: z.string(), version: z.string() })) });
const compactGraphSchema = graphSchema.extend({ files: z.array(z.strictObject({ path, bytes: bytes.optional(), version: z.string().regex(/^[a-f0-9]{64}$/) })) });
const legacyJournalSchema = z.strictObject({ format: z.literal(1), stage: z.enum(['contracts', 'tests']), manifest: z.string(),
  candidate: z.unknown(), facts: z.string(), graph: graphSchema,
  plans: z.array(z.strictObject({ outputId: z.string(), changes: z.array(change), artifacts: z.array(z.unknown()), obligations: z.array(z.unknown()) })), ledger: bytes });
const journalSchema = z.discriminatedUnion('format', [legacyJournalSchema, legacyJournalSchema.extend({ format: z.literal(2), graph: compactGraphSchema })]);
type Journal = z.infer<typeof journalSchema>;
const retainedFacts = z.strictObject({ root: graphSchema.shape.root, excluded: z.array(path), excludeNames: z.array(z.string()),
  readOnly: z.array(z.tuple([path, z.string().regex(/^[a-f0-9]{64}$/)])), native: graphSchema.shape.nativeInputs });
const preimagePaths = (changes: readonly (FileChange | z.infer<typeof change>)[]) => new Set([identityPath,
  ...changes.flatMap(change => change.kind === 'move' ? [change.from, change.to] : [change.path])]);
const graphOf = (snapshot: ProjectSnapshot, required: ReadonlySet<string>): z.infer<typeof compactGraphSchema> => ({ root: { ...snapshot.root },
  files: snapshot.files.filter(file => file.path !== pendingPath && file.path !== '.expec/write.lock').map(file => ({ path: file.path, version: file.version,
    ...(required.has(file.path) ? { bytes: Buffer.from(file.bytes).toString('base64') } : {}) })),
  excluded: [...snapshot.excluded], excludeNames: [...snapshot.excludeNames], nativeInputs: (snapshot.nativeInputs ?? []).map(input => ({ ...input })) });
/** Owns one original graph; untouched bodies come only from independently verified raw acquisition. */
function originalOf(journal: Journal, current: ProjectSnapshot): ProjectSnapshot {
  const graph = journal.graph, required = preimagePaths(journal.plans.flatMap(plan => plan.changes));
  if (new Set(graph.files.map(file => file.path)).size !== graph.files.length
    || graph.files.some(file => file.path === pendingPath || file.path === '.expec/write.lock')) throw Error('Invalid original file table.');
  if (journal.format === 2 && (!current.complete || current.problems.length
    || canonical({ root: current.root, excluded: current.excluded, excludeNames: current.excludeNames })
      !== canonical({ root: graph.root, excluded: graph.excluded, excludeNames: graph.excludeNames }))) throw Error('Raw original acquisition changed.');
  const observed = new Map(current.files.map(file => [file.path, file]));
  const files = graph.files.map(file => {
    if (journal.format === 2 && (file.bytes !== undefined) !== required.has(file.path)) throw Error('Missing or extra original preimage.');
    let body: Uint8Array;
    if (file.bytes !== undefined) body = Buffer.from(file.bytes, 'base64');
    else {
      const fresh = observed.get(file.path);
      if (!fresh || fresh.version !== file.version || hash(fresh.bytes) !== file.version) throw Error('Untouched original file changed: ' + file.path);
      body = Buffer.from(fresh.bytes);
    }
    if (hash(body) !== file.version) throw Error('Invalid retained acquisition bytes.');
    return { path: file.path, version: file.version, bytes: body };
  });
  const original: ProjectSnapshot = { root: { ...graph.root }, files, excluded: [...graph.excluded], excludeNames: [...graph.excludeNames],
    nativeInputs: graph.nativeInputs.map(input => ({ ...input })), complete: true, problems: [] };
  if (!nativeInputs(original)) throw Error('Invalid original native input evidence.');
  return original;
}
export function pendingStage(snapshot: ProjectSnapshot): 'contracts' | 'tests' {
  try {
    const file = snapshot.files.find(file => file.path === pendingPath);
    return file && JSON.parse(new TextDecoder().decode(file.bytes)).stage === 'tests' ? 'tests' : 'contracts';
  } catch { return 'contracts'; }
}
const encode = (value: Uint8Array) => Buffer.from(value).toString('base64');
const versions = (snapshot: ProjectSnapshot) => snapshot.files.filter(file => file.path !== pendingPath && file.path !== '.expec/write.lock')
  .map(file => [file.path, file.version] as [string, string]).sort(([a], [b]) => a.localeCompare(b));
const facts = (snapshot: ProjectSnapshot) => canonical({ root: snapshot.root, excluded: [...snapshot.excluded].sort(), excludeNames: [...snapshot.excludeNames].sort(),
  readOnly: (snapshot.readOnlyFiles ?? []).map(file => [file.path, file.version]).sort(), native: [...snapshot.nativeInputs ?? []].sort((a, b) => a.uri.localeCompare(b.uri)) });
const changes = (journal: Journal): FileChange[] => journal.plans.flatMap(plan => plan.changes.map(change => change.kind === 'remove' ? change : { ...change, bytes: Buffer.from(change.bytes, 'base64') }));
const sameFiles = (expected: Map<string, string>, actual: Map<string, string>) => expected.size === actual.size && [...expected].every(([path, version]) => actual.get(path) === version);
const advance = (files: Map<string, string>, change: FileChange): void => {
  if (change.kind === 'remove') files.delete(change.path);
  else if (change.kind === 'write') files.set(change.path, hash(change.bytes));
  else { files.delete(change.from); files.set(change.to, hash(change.bytes!)); }
};

/** Retains exact stage intent and resumes only an observed whole-operation prefix. */
export class BuildJournal {
  constructor(private readonly checked: CheckedManifest, private readonly context: BuildContext, private readonly signal: AbortSignal) {}
  private problem(message: string) { return cliProblem('recovery-conflict', message, this.checked.manifest); }
  async apply(stage: 'contracts' | 'tests', basedOn: ProjectSnapshot, plans: readonly OutputPlan[], candidate: IdentityBaseline, completion?: FileChange): Promise<CommandResult> {
    if (completion) plans = plans.map((plan, index) => index === plans.length - 1 ? { ...plan, changes: [...plan.changes, completion] } : plan);
    const fresh = await this.context.readSnapshot();
    if (!fresh.complete || facts(fresh) !== facts(basedOn) || !sameFiles(new Map(versions(fresh)), new Map(versions(basedOn)))) return {
      status: 'invalid', exitCode: 1, problems: fresh.problems.length ? fresh.problems : [cliProblem('stale-project', 'Project changed after output planning.', this.checked.manifest)],
      stages: [{ name: stage, status: 'stopped' }],
    };
    const ledger = identityBytes(this.checked, basedOn.root, candidate), all = plans.flatMap(plan => [...plan.changes]);
    const desired = new Map(versions(basedOn)); all.forEach(change => advance(desired, change.kind === 'move' && !change.bytes
      ? { ...change, bytes: basedOn.files.find(file => file.path === change.from)!.bytes } : change));
    desired.set(identityPath, hash(ledger));
    if (sameFiles(desired, new Map(versions(basedOn)))) {
      const problems = this.context.completionProblems(fresh);
      return problems.length ? { status: 'invalid', exitCode: 1, problems, stages: [{ name: stage, status: 'stopped' }] }
        : { status: 'built', exitCode: 0, problems: [], stages: [{ name: stage, status: 'unchanged', outputs: plans.map(plan => plan.outputId) }] };
    }
    const journal: Journal = { format: 2, stage, manifest: this.checked.manifest, candidate, facts: facts(basedOn), graph: graphOf(basedOn, preimagePaths(all)), ledger: encode(ledger),
      plans: plans.map(plan => ({ outputId: plan.outputId, artifacts: [...plan.artifacts], obligations: [...plan.obligations ?? []], changes: plan.changes.map(change =>
        change.kind === 'remove' ? change : { ...change, bytes: encode(change.bytes ?? basedOn.files.find(file => file.path === (change as { from: string }).from)!.bytes) }) })) };
    const original = originalOf(journal, fresh);
    const pendingBytes = Buffer.from(canonical(journal) + '\n');
    const stageContext = this.context.during(original);
    const saved = await new FileProjectWriter(stageContext).apply({ basedOn, changes: [{ kind: 'write', path: pendingPath, bytes: pendingBytes }] }, this.signal);
    if (saved.status === 'stopped') return { status: 'invalid', exitCode: 1, problems: saved.problems, stages: [{ name: stage, status: 'stopped', journal: saved }] };
    return this.finish(journal, original, await stageContext.readSnapshot(), 0, false, hash(pendingBytes));
  }
  async recover(snapshot: ProjectSnapshot): Promise<Check<CommandResult | null>> {
    const file = snapshot.files.find(file => file.path === pendingPath);
    if (!file) return { value: null, problems: [], deferred: [] };
    const problems: Diagnostic[] = [];
    try {
      const parsed = journalSchema.safeParse(readJson(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes), (_code, message) => problems.push(this.problem(message))));
      if (!parsed.success || problems.length) throw Error('Malformed pending build record.');
      const journal = parsed.data, completed = await this.completedConfirmation(journal, snapshot);
      if (completed) return { value: completed, problems: [], deferred: [] };
      const original = originalOf(journal, snapshot);
      snapshot = await this.context.during(original).readSnapshot();
      const read = identities().read({ sourceId: pendingPath, text: JSON.stringify(journal.candidate) });
      if (!read.value || journal.manifest !== this.checked.manifest || journal.facts !== facts(snapshot) || !snapshot.complete) throw Error('Pending inputs, native evidence or baseline changed.');
      const identity = identities(), current = identity.associate(this.checked.specification!, read.value);
      if (!current.value || canonical(current.value.baseline) !== canonical(read.value)) throw Error('The checked specification no longer matches the retained identities.');
      if (encode(identityBytes(this.checked, snapshot.root, read.value)) !== journal.ledger) throw Error('Pending confirmation does not describe its candidate.');
      const selected = new Set(this.checked.configuration!.outputs.map(profile => profile.id));
      if (!journal.plans.length || new Set(journal.plans.map(plan => plan.outputId)).size !== journal.plans.length || journal.plans.some(plan => !selected.has(plan.outputId))) throw Error('Pending output selection is invalid.');
      const all = changes(journal), endpoints: string[] = [];
      for (const plan of journal.plans) {
        const decoded = plan.changes.map(change => change.kind === 'remove' ? change : { ...change, bytes: Buffer.from(change.bytes, 'base64') });
        checkPlan({ value: { ...plan, basedOn: snapshot, changes: decoded } as OutputPlan, problems: [], deferred: [] }, snapshot, plan.outputId);
        for (const change of decoded) for (const path of change.kind === 'move' ? [change.from, change.to] : [change.path]) {
          const key = process.platform === 'win32' ? path.toLowerCase() : path;
          if ([identityPath, pendingPath, ...endpoints].some(before => key === before || key.startsWith(before + '/') || before.startsWith(key + '/'))) throw Error('Pending endpoints overlap protected state.');
          endpoints.push(key);
        }
      }
      const actual = new Map(versions(snapshot)), expected = new Map(versions(original));
      let prefix = sameFiles(expected, actual) ? 0 : -1;
      for (let index = 0; index < all.length; index++) { advance(expected, all[index]!); if (sameFiles(expected, actual)) prefix = index + 1; }
      expected.set(identityPath, hash(Buffer.from(journal.ledger, 'base64')));
      const confirmed = sameFiles(expected, actual);
      if (!confirmed && prefix < 0) throw Error('Project bytes are not an unchanged pending prefix; retain the record and resolve the conflicting edit explicitly.');
      return { value: await this.finish(journal, original, snapshot, confirmed ? all.length : prefix, confirmed, file.version), problems: [], deferred: [] };
    } catch (error) { return { problems: [...problems, this.problem(String(error))], deferred: [] }; }
  }
  private async completedConfirmation(journal: Journal, captured: ProjectSnapshot): Promise<CommandResult | undefined> {
    const plan = journal.plans[0], change = plan?.changes[0];
    if (journal.format !== 2 || journal.stage !== 'tests' || journal.plans.length !== 1 || plan?.outputId !== 'acceptance'
      || plan.obligations.length || plan.changes.length !== 1 || change?.kind !== 'write' || change.path !== acceptanceStatePath) return;
    const selected = this.checked.configuration!.outputs.find(output => output.id === 'acceptance');
    if (!selected) return;
    const settings = acceptanceOptions.parse(selected.options), graph = journal.graph, required = preimagePaths([change]);
    if (journal.manifest !== this.checked.manifest || canonical(graph.root) !== canonical(captured.root)
      || canonical(graph.excluded) !== canonical(captured.excluded) || canonical(graph.excludeNames) !== canonical(captured.excludeNames)
      || new Set(graph.files.map(file => file.path)).size !== graph.files.length
      || graph.files.some(file => [pendingPath, transitionPath, '.expec/write.lock'].some(path => pathKey(file.path) === path || pathKey(file.path).startsWith(path + '/'))
        || graph.excluded.some(path => pathKey(file.path) === pathKey(path) || pathKey(file.path).startsWith(pathKey(path) + '/'))
        || file.path.split('/').some(part => graph.excludeNames.some(name => pathKey(name) === pathKey(part)))
        || (file.bytes !== undefined) !== required.has(file.path) || file.bytes !== undefined && hash(Buffer.from(file.bytes, 'base64')) !== file.version)) return;
    const recorded = retainedFacts.safeParse(JSON.parse(journal.facts));
    if (!recorded.success || canonical({ ...recorded.data, root: graph.root, excluded: [...graph.excluded].sort(),
      excludeNames: [...graph.excludeNames].sort(), native: [...graph.nativeInputs].sort((a, b) => a.uri.localeCompare(b.uri)) }) !== journal.facts
      || !validateReadOnlyFacts(graph.files, recorded.data.readOnly.map(([path]) => ({ path })))) return;
    const evidence = nativeInputs({ ...captured, nativeInputs: graph.nativeInputs });
    const retained = new Map([...graph.files.map(file => [file.path, file.version] as const), ...recorded.data.readOnly]
      .map(([path, version]) => [pathKey(resolve(graph.root.path, path)), version]));
    if (!evidence?.has(pathKey(resolve(journal.manifest)))
      || [...evidence].some(([path, version]) => retained.has(path) && retained.get(path) !== version)) return;
    const priorIdentity = graph.files.find(file => file.path === identityPath), priorState = graph.files.find(file => file.path === acceptanceStatePath);
    if (!priorIdentity?.bytes || !priorState?.bytes) return;
    const candidate = identities().read({ sourceId: pendingPath, text: JSON.stringify(journal.candidate) }).value;
    if (!candidate || encode(identityBytes(this.checked, captured.root, candidate)) !== journal.ledger) return;
    const stateSnapshot = (body: Uint8Array) => ({ ...captured, files: captured.files.map(file => file.path === acceptanceStatePath
      ? { ...file, bytes: body, version: hash(body) } : file) });
    const before = acceptanceState(stateSnapshot(Buffer.from(priorState.bytes, 'base64')), settings), plannedBytes = Buffer.from(change.bytes, 'base64');
    const after = acceptanceState(stateSnapshot(plannedBytes), settings);
    const links = (artifacts: readonly unknown[]) => canonical(artifacts.map(item => canonical(item)).sort());
    if (!before.value || before.problems.length || !after.value || after.problems.length || !confirmationOnly(before.value, after.value, graph.files)
      || links(plan.artifacts) !== links(after.value.files.flatMap(file => file.artifacts))
      || links(plan.artifacts) !== links(candidate.artifacts.filter(item => item.locator.outputId === 'acceptance'))) return;
    const fresh = await this.context.readSnapshot(), identity = readIdentity(fresh, this.checked).value?.baseline;
    const normalized = (baseline: IdentityBaseline) => canonical({ ...baseline, artifacts: baseline.artifacts.map(item => canonical(item)).sort() });
    if (!fresh.complete || fresh.problems.length || canonical(fresh.root) !== canonical(graph.root)
      || canonical(fresh.excluded) !== canonical(graph.excluded) || canonical(fresh.excludeNames) !== canonical(graph.excludeNames)
      || fresh.files.some(file => pathKey(file.path) === transitionPath)
      || fresh.files.find(file => file.path === pendingPath)?.version !== captured.files.find(file => file.path === pendingPath)?.version
      || fresh.files.find(file => file.path === identityPath)?.version !== priorIdentity.version
      || fresh.files.find(file => file.path === acceptanceStatePath)?.version !== hash(plannedBytes)
      || !identity || normalized(identity) !== normalized(candidate)) return;
    checkPlan({ value: { ...plan, basedOn: fresh, changes: [{ ...change, bytes: plannedBytes }] } as OutputPlan, problems: [], deferred: [] }, fresh, 'acceptance');
    const receipt = await new FileProjectWriter(this.context).apply({ basedOn: fresh, changes: [{ kind: 'remove', path: pendingPath }] }, this.signal);
    return { status: receipt.status === 'stopped' ? 'invalid' : 'recovered', exitCode: receipt.status === 'stopped' ? 1 : 0,
      problems: receipt.problems, stages: [{ name: 'recovery', status: receipt.status, receipt }] };
  }
  private async finish(journal: Journal, original: ProjectSnapshot, snapshot: ProjectSnapshot, prefix: number, confirmed: boolean, pendingVersion: string): Promise<CommandResult> {
    const stageContext = this.context.during(original), writer = new FileProjectWriter(stageContext), result: CommandResult = { status: 'invalid', exitCode: 1, problems: [], stages: [],
      obligations: journal.plans.flatMap(plan => plan.obligations) as Diagnostic[] };
    const owned = (snapshot: ProjectSnapshot) => canonical({ root: snapshot.root, excluded: [...snapshot.excluded].sort(), excludeNames: [...snapshot.excludeNames].sort(),
      files: snapshot.files.filter(file => file.path !== '.expec/write.lock').map(file => [file.path, file.version]).sort() });
    const incomplete = (snapshot: ProjectSnapshot): ProjectSnapshot => ({ ...snapshot, complete: false,
      problems: [...snapshot.problems, this.problem('Project or native inputs changed while checking the completed stage; pending intent is retained.')] });
    const completionContext: ProjectContext = { root: this.context.root, readSnapshot: async () => {
      const captured = await stageContext.readSnapshot();
      if (!captured.complete || captured.problems.length || facts(captured) !== journal.facts) return incomplete(captured);
      const current = await this.context.readSnapshot();
      if (!current.complete || current.problems.length || owned(current) !== owned(captured)) return incomplete(current);
      const problems = this.context.completionProblems(current);
      return problems.length ? incomplete({ ...current, problems }) : current;
    } };
    const completionWriter = new FileProjectWriter(completionContext);
    let receipt: WriteResult | undefined;
    const all = changes(journal), expected = new Map(versions(original));
    all.slice(0, prefix).forEach(change => advance(expected, change));
    if (confirmed) expected.set(identityPath, hash(Buffer.from(journal.ledger, 'base64')));
    const matches = (snapshot: ProjectSnapshot): boolean => snapshot.complete && !snapshot.problems.length
      && snapshot.files.find(file => file.path === pendingPath)?.version === pendingVersion
      && sameFiles(expected, new Map(versions(snapshot)));
    const conflict = (snapshot: ProjectSnapshot): CommandResult => ({ ...result, problems: snapshot.problems.some(problem => problem.code === 'recovery-conflict') ? [...snapshot.problems]
      : [...snapshot.problems, this.problem('Project or build inputs changed between stage effects; pending intent is retained.')] });
    if (!matches(snapshot) || facts(snapshot) !== journal.facts) return conflict(snapshot);
    if (!confirmed) {
      receipt = await writer.apply({ basedOn: snapshot, changes: changes(journal).slice(prefix) }, this.signal);
      result.stages.push({ name: journal.stage, status: receipt.status, outputs: journal.plans.map(plan => plan.outputId), receipt, resumed: prefix });
      if (receipt.status === 'stopped') return { ...result, problems: receipt.problems };
      all.slice(prefix).forEach(change => advance(expected, change));
      const beforeConfirmation = await completionContext.readSnapshot();
      if (!matches(beforeConfirmation)) return conflict(beforeConfirmation);
      const saved = await completionWriter.apply({ basedOn: beforeConfirmation, changes: [{ kind: 'write', path: identityPath, bytes: Buffer.from(journal.ledger, 'base64') }] }, this.signal);
      if (saved.status === 'stopped') return { ...result, problems: [...saved.problems, cliProblem('unconfirmed-state', 'Output applied, but identity confirmation remains pending.', this.checked.manifest)] };
    }
    expected.set(identityPath, hash(Buffer.from(journal.ledger, 'base64')));
    const beforeCleanup = await completionContext.readSnapshot();
    if (!matches(beforeCleanup)) return conflict(beforeCleanup);
    const cleanup = await completionWriter.apply({ basedOn: beforeCleanup, changes: [{ kind: 'remove', path: pendingPath }] }, this.signal);
    if (cleanup.status === 'stopped') return { ...result, problems: cleanup.problems };
    return { ...result, status: 'built', exitCode: 0 };
  }
}
