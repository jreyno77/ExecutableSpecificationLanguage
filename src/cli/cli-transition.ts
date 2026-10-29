import { z } from 'zod';
import type { Check } from '../compiler/checking.js';
import { canonical } from '../model/identity-baseline.js';
import type { IdentityBaseline, IdentifiedSpecification, IdentityDecision } from '../model/specification-identity.js';
import type { ProjectSnapshot } from '../project/connection/project-connection.js';
import type { FileChange } from '../project/connection/project-writer.js';
import { hash } from '../project/connection/project-files.js';
import { readJson } from '../project/connection/json-data.js';
import { cliProblem, type CheckedManifest } from './cli-check.js';
import { identities, readIdentity, transitionPath } from './cli-identity.js';
import { pathPolicy } from '../project/connection/project-exclusions.js';

type Stage = 'contracts' | 'tests';
const fields = { manifest: z.string(), root: z.strictObject({ path: z.string(), identity: z.string() }),
  inputs: z.string(), before: z.unknown(), candidate: z.unknown(), remaining: z.array(z.enum(['contracts', 'tests'])).min(1),
  native: z.array(z.tuple([z.string(), z.string()])), exclusions: z.string() };
const schema = z.discriminatedUnion('format', [z.strictObject({ format: z.literal(1), ...fields }),
  z.strictObject({ format: z.literal(2), ...fields, contractBefore: z.unknown() })]);
const version = z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/);
const inputSchema = z.strictObject({ manifest: z.string(), captures: z.array(z.tuple([z.string().min(1), version])),
  packages: z.array(z.strictObject({ uri: z.string().min(1), version })), tests: z.array(z.string().min(1)) });
export interface BuildTransition {
  readonly before?: IdentityBaseline;
  readonly contractBefore?: IdentityBaseline;
  readonly candidate: IdentityBaseline;
  readonly remaining: readonly Stage[];
  readonly record: z.infer<typeof schema>;
}
const inputs = (checked: CheckedManifest, tests: ReadonlySet<string>) => canonical({ manifest: checked.text,
  captures: checked.captures.map(capture => [capture.source.sourceId, capture.version]).sort(),
  packages: [...checked.packageInputs ?? []].sort((a, b) => a.uri.localeCompare(b.uri)), tests: [...tests].sort() });
const native = (snapshot: ProjectSnapshot): [string, string][] => (snapshot.readOnlyFiles ?? []).map(file => [file.path, file.version] as [string, string]).sort(([a], [b]) => a.localeCompare(b));
const exclusions = (snapshot: ProjectSnapshot) => canonical({ excluded: [...snapshot.excluded].sort(), names: [...snapshot.excludeNames].sort(), ...pathPolicy(snapshot) });
const specification = (baseline: IdentityBaseline) => canonical({ ...baseline, artifacts: [] });

/** A revised source does not relax configuration, package or output-selection evidence. */
function sameEnvironment(previous: string, current: string): boolean {
  const parse = (text: string) => {
    const errors: string[] = [], result = inputSchema.safeParse(readJson(text, (_code, message) => errors.push(message)));
    if (!result.success || errors.length || canonical(result.data) !== text
      || new Set(result.data.captures.map(([uri]) => uri)).size !== result.data.captures.length
      || new Set(result.data.tests).size !== result.data.tests.length) return undefined;
    return { manifest: result.data.manifest, packages: result.data.packages, tests: result.data.tests };
  };
  const before = parse(previous), after = parse(current);
  return before !== undefined && after !== undefined && canonical(before) === canonical(after);
}

/** Keeps an actual specification transition until each selected stage confirms it. */
export function retainTransition(checked: CheckedManifest, snapshot: ProjectSnapshot, tests: ReadonlySet<string>,
  before: IdentityBaseline | undefined, current: IdentifiedSpecification): BuildTransition {
  const remaining = (['contracts', 'tests'] as const).filter(stage => checked.configuration!.outputs.some(output => tests.has(output.id) === (stage === 'tests')));
  const record = { format: 1 as const, manifest: checked.manifest, root: snapshot.root, inputs: inputs(checked, tests),
    before: before ?? null, candidate: current.baseline, remaining, native: native(snapshot), exclusions: exclusions(snapshot) };
  return { ...(before ? { before } : {}), candidate: current.baseline, remaining, record };
}
export function readTransition(checked: CheckedManifest, snapshot: ProjectSnapshot, tests: ReadonlySet<string>,
  correction?: { readonly replan: true; readonly decisions: readonly IdentityDecision[] }): Check<BuildTransition | null> {
  const file = snapshot.files.find(file => file.path === transitionPath);
  if (!file) return { value: null, problems: [], deferred: [] };
  const refuse = (message: string): Check<BuildTransition | null> => ({ problems: [cliProblem('recovery-conflict', message, checked.manifest)], deferred: [] });
  try {
    const errors: string[] = [], parsed = schema.safeParse(readJson(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes), (_code, message) => errors.push(message)));
    if (!parsed.success || errors.length || hash(file.bytes) !== file.version) return refuse('The retained output transition is malformed.');
    const record = parsed.data, identity = identities(), currentInputs = inputs(checked, tests);
    if (record.manifest !== checked.manifest || canonical(record.root) !== canonical(snapshot.root)
      || (correction ? !sameEnvironment(record.inputs, currentInputs) : record.inputs !== currentInputs)
      || record.exclusions !== exclusions(snapshot) || canonical(record.native) !== canonical(native(snapshot))) return refuse('Retained source, configuration, project or native dependency evidence changed.');
    const selected = (['contracts', 'tests'] as const).filter(stage => checked.configuration!.outputs.some(output => tests.has(output.id) === (stage === 'tests')));
    if (!selected.some((_stage, index) => canonical(selected.slice(index)) === canonical(record.remaining))) return refuse('Retained output stages are not a remaining suffix of this build.');
    const prior = record.before === null ? undefined : identity.read({ sourceId: transitionPath, text: JSON.stringify(record.before) }).value;
    const contractBefore = record.format === 2 && record.contractBefore !== null
      ? identity.read({ sourceId: transitionPath, text: JSON.stringify(record.contractBefore) }).value : undefined;
    const candidate = identity.read({ sourceId: transitionPath, text: JSON.stringify(record.candidate) }).value;
    if (record.before !== null && !prior || !candidate || record.format === 2 && record.contractBefore !== null && !contractBefore)
      return refuse('The retained specification baselines are invalid.');
    const confirmed = readIdentity(snapshot, checked);
    if (!confirmed.value) return refuse('The current identity confirmation is invalid.');
    const expected = record.remaining[0] === selected[0] ? (record.format === 2 ? contractBefore : prior) : candidate;
    if ((confirmed.value.baseline === undefined) !== (expected === undefined)
      || confirmed.value.baseline && expected && specification(confirmed.value.baseline) !== specification(expected)) return refuse('Current identity confirmation does not belong to the retained transition.');
    const associated = identity.associate(checked.specification!, candidate, correction?.decisions ?? []);
    if (!associated.value) return correction ? { problems: associated.problems, deferred: associated.deferred } : refuse('Current specification does not match the retained candidate identities.');
    if (!correction && (canonical(associated.value.baseline) !== canonical(candidate) || !identity.compare(prior, associated.value).value))
      return refuse('Current specification does not match the retained candidate identities.');
    if (correction) {
      const actualContractBefore = confirmed.value.baseline;
      const next = { format: 2 as const, manifest: record.manifest, root: record.root, inputs: currentInputs, before: prior ?? null,
        contractBefore: actualContractBefore ?? null, candidate: associated.value.baseline, remaining: selected, native: record.native, exclusions: record.exclusions };
      return { value: { ...(prior ? { before: prior } : {}), ...(actualContractBefore ? { contractBefore: actualContractBefore } : {}),
        candidate: associated.value.baseline, remaining: selected, record: next }, problems: [], deferred: [] };
    }
    return { value: { ...(prior ? { before: prior } : {}), ...(contractBefore ? { contractBefore } : {}), candidate, remaining: record.remaining, record }, problems: [], deferred: [] };
  } catch (error) { return refuse('Cannot read the retained output transition: ' + String(error)); }
}
export function transitionChange(transition: BuildTransition, completed?: Stage): FileChange {
  const remaining = completed ? transition.remaining.filter(stage => stage !== completed) : transition.remaining;
  return remaining.length ? { kind: 'write', path: transitionPath, bytes: Buffer.from(canonical({ ...transition.record, remaining }) + '\n') }
    : { kind: 'remove', path: transitionPath };
}
