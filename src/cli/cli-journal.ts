import { z } from 'zod';
import type { Check, Diagnostic } from '../compiler/checking.js';
import { cliProblem, type CheckedManifest } from './cli-check.js';
import { identities, identityBytes, identityPath, pendingPath } from './cli-identity.js';
import type { CommandResult } from './cli-project.js';
import type { BuildContext } from './cli-context.js';
import { nativeInputs } from '../project/connection/native-inputs.js';
import { canonical } from '../model/identity-baseline.js';
import { readJson } from '../model/json-data.js';
import type { OutputPlan } from '../project/output/output.js';
import { checkPlan } from '../project/output/output-contract.js';
import { hash, literal } from '../project/connection/project-files.js';
import type { ProjectContext, ProjectSnapshot } from '../project/connection/project-connection.js';
import { FileProjectWriter, type FileChange, type WriteResult } from '../project/connection/project-writer.js';
import type { IdentityBaseline } from '../model/specification-identity.js';

const bytes = z.string().refine(value => Buffer.from(value, 'base64').toString('base64') === value), path = z.string().refine(literal);
const change = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('write'), path, bytes }), z.strictObject({ kind: z.literal('remove'), path }),
  z.strictObject({ kind: z.literal('move'), from: path, to: path, bytes })]);
const graphSchema = z.strictObject({ root: z.strictObject({ path: z.string(), identity: z.string() }),
  files: z.array(z.strictObject({ path, bytes, version: z.string().regex(/^[a-f0-9]{64}$/) })),
  excluded: z.array(path), excludeNames: z.array(z.string()), nativeInputs: z.array(z.strictObject({ uri: z.string(), version: z.string() })) });
const graphOf = (snapshot: ProjectSnapshot): z.infer<typeof graphSchema> => ({ root: snapshot.root,
  files: snapshot.files.filter(file => file.path !== pendingPath && file.path !== '.expec/write.lock').map(file => ({ ...file, bytes: Buffer.from(file.bytes).toString('base64') })),
  excluded: [...snapshot.excluded], excludeNames: [...snapshot.excludeNames], nativeInputs: [...snapshot.nativeInputs ?? []] });
const restoreGraph = (graph: z.infer<typeof graphSchema>): ProjectSnapshot => ({ ...graph, complete: true, problems: [], files: graph.files.map(file => ({ ...file, bytes: Buffer.from(file.bytes, 'base64') })) });
const journalSchema = z.strictObject({ format: z.literal(1), stage: z.enum(['contracts', 'tests']), manifest: z.string(),
  candidate: z.unknown(), facts: z.string(), graph: graphSchema,
  plans: z.array(z.strictObject({ outputId: z.string(), changes: z.array(change), artifacts: z.array(z.unknown()), obligations: z.array(z.unknown()) })), ledger: bytes });
type Journal = z.infer<typeof journalSchema>;
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
  async apply(stage: 'contracts' | 'tests', basedOn: ProjectSnapshot, plans: readonly OutputPlan[], candidate: IdentityBaseline): Promise<CommandResult> {
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
    const journal: Journal = { format: 1, stage, manifest: this.checked.manifest, candidate, facts: facts(basedOn), graph: graphOf(basedOn), ledger: encode(ledger),
      plans: plans.map(plan => ({ outputId: plan.outputId, artifacts: [...plan.artifacts], obligations: [...plan.obligations ?? []], changes: plan.changes.map(change =>
        change.kind === 'remove' ? change : { ...change, bytes: encode(change.bytes ?? basedOn.files.find(file => file.path === (change as { from: string }).from)!.bytes) }) })) };
    const pendingBytes = Buffer.from(canonical(journal) + '\n');
    const stageContext = this.context.during(basedOn);
    const saved = await new FileProjectWriter(stageContext).apply({ basedOn, changes: [{ kind: 'write', path: pendingPath, bytes: pendingBytes }] }, this.signal);
    if (saved.status === 'stopped') return { status: 'invalid', exitCode: 1, problems: saved.problems, stages: [{ name: stage, status: 'stopped', journal: saved }] };
    return this.finish(journal, await stageContext.readSnapshot(), 0, false, hash(pendingBytes));
  }
  async recover(snapshot: ProjectSnapshot): Promise<Check<CommandResult | null>> {
    const file = snapshot.files.find(file => file.path === pendingPath);
    if (!file) return { value: null, problems: [], deferred: [] };
    const problems: Diagnostic[] = [];
    try {
      const parsed = journalSchema.safeParse(readJson(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes), (_code, message) => problems.push(this.problem(message))));
      if (!parsed.success || problems.length) throw Error('Malformed pending build record.');
      const journal = parsed.data, original = restoreGraph(journal.graph);
      if (!nativeInputs(original) || new Set(original.files.map(file => file.path)).size !== original.files.length || original.files.some(file => hash(file.bytes) !== file.version)) throw Error('Invalid retained acquisition bytes.');
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
      const actual = new Map(versions(snapshot)), expected = new Map(versions(restoreGraph(journal.graph)));
      let prefix = sameFiles(expected, actual) ? 0 : -1;
      for (let index = 0; index < all.length; index++) { advance(expected, all[index]!); if (sameFiles(expected, actual)) prefix = index + 1; }
      expected.set(identityPath, hash(Buffer.from(journal.ledger, 'base64')));
      const confirmed = sameFiles(expected, actual);
      if (!confirmed && prefix < 0) throw Error('Project bytes are not an unchanged pending prefix; retain the record and resolve the conflicting edit explicitly.');
      return { value: await this.finish(journal, snapshot, confirmed ? all.length : prefix, confirmed, file.version), problems: [], deferred: [] };
    } catch (error) { return { problems: [...problems, this.problem(String(error))], deferred: [] }; }
  }
  private async finish(journal: Journal, snapshot: ProjectSnapshot, prefix: number, confirmed: boolean, pendingVersion: string): Promise<CommandResult> {
    const stageContext = this.context.during(restoreGraph(journal.graph)), writer = new FileProjectWriter(stageContext), result: CommandResult = { status: 'invalid', exitCode: 1, problems: [], stages: [],
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
    const all = changes(journal), expected = new Map(versions(restoreGraph(journal.graph)));
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
