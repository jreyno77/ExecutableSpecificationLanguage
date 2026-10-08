import { z } from 'zod';
import type { Check } from '../compiler/checking.js';
import { canonical } from '../model/identity-baseline.js';
import type { IdentityBaseline, IdentifiedSpecification } from '../model/specification-identity.js';
import type { ProjectSnapshot } from '../project/connection/project-connection.js';
import type { FileChange } from '../project/connection/project-writer.js';
import { hash } from '../project/connection/project-files.js';
import { readJson } from '../project/connection/json-data.js';
import { cliProblem, type CheckedManifest } from './cli-check.js';
import { identities, readIdentity, transitionPath } from './cli-identity.js';

type Stage = 'contracts' | 'tests';
const schema = z.strictObject({ format: z.literal(1), manifest: z.string(), root: z.strictObject({ path: z.string(), identity: z.string() }),
  inputs: z.string(), before: z.unknown(), candidate: z.unknown(), remaining: z.array(z.enum(['contracts', 'tests'])).min(1),
  native: z.array(z.tuple([z.string(), z.string()])), exclusions: z.string() });
export interface BuildTransition {
  readonly before?: IdentityBaseline;
  readonly candidate: IdentityBaseline;
  readonly remaining: readonly Stage[];
  readonly record: z.infer<typeof schema>;
}
const inputs = (checked: CheckedManifest, tests: ReadonlySet<string>) => canonical({ manifest: checked.text,
  captures: checked.captures.map(capture => [capture.source.sourceId, capture.version]).sort(),
  packages: [...checked.packageInputs ?? []].sort((a, b) => a.uri.localeCompare(b.uri)), tests: [...tests].sort() });
const native = (snapshot: ProjectSnapshot): [string, string][] => (snapshot.readOnlyFiles ?? []).map(file => [file.path, file.version] as [string, string]).sort(([a], [b]) => a.localeCompare(b));
const exclusions = (snapshot: ProjectSnapshot) => canonical({ excluded: [...snapshot.excluded].sort(), names: [...snapshot.excludeNames].sort() });
const specification = (baseline: IdentityBaseline) => canonical({ ...baseline, artifacts: [] });

/** Keeps an actual specification transition until each selected stage confirms it. */
export function retainTransition(checked: CheckedManifest, snapshot: ProjectSnapshot, tests: ReadonlySet<string>,
  before: IdentityBaseline | undefined, current: IdentifiedSpecification): BuildTransition {
  const remaining = (['contracts', 'tests'] as const).filter(stage => checked.configuration!.outputs.some(output => tests.has(output.id) === (stage === 'tests')));
  const record = { format: 1 as const, manifest: checked.manifest, root: snapshot.root, inputs: inputs(checked, tests),
    before: before ?? null, candidate: current.baseline, remaining, native: native(snapshot), exclusions: exclusions(snapshot) };
  return { ...(before ? { before } : {}), candidate: current.baseline, remaining, record };
}
export function readTransition(checked: CheckedManifest, snapshot: ProjectSnapshot, tests: ReadonlySet<string>): Check<BuildTransition | null> {
  const file = snapshot.files.find(file => file.path === transitionPath);
  if (!file) return { value: null, problems: [], deferred: [] };
  const refuse = (message: string): Check<BuildTransition | null> => ({ problems: [cliProblem('recovery-conflict', message, checked.manifest)], deferred: [] });
  try {
    const errors: string[] = [], parsed = schema.safeParse(readJson(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes), (_code, message) => errors.push(message)));
    if (!parsed.success || errors.length || hash(file.bytes) !== file.version) return refuse('The retained output transition is malformed.');
    const record = parsed.data, identity = identities();
    if (record.manifest !== checked.manifest || canonical(record.root) !== canonical(snapshot.root) || record.inputs !== inputs(checked, tests)
      || record.exclusions !== exclusions(snapshot) || canonical(record.native) !== canonical(native(snapshot))) return refuse('Retained source, configuration, project or native dependency evidence changed.');
    const selected = (['contracts', 'tests'] as const).filter(stage => checked.configuration!.outputs.some(output => tests.has(output.id) === (stage === 'tests')));
    if (!selected.some((_stage, index) => canonical(selected.slice(index)) === canonical(record.remaining))) return refuse('Retained output stages are not a remaining suffix of this build.');
    const prior = record.before === null ? undefined : identity.read({ sourceId: transitionPath, text: JSON.stringify(record.before) }).value;
    const candidate = identity.read({ sourceId: transitionPath, text: JSON.stringify(record.candidate) }).value;
    if (record.before !== null && !prior || !candidate) return refuse('The retained specification baselines are invalid.');
    const associated = identity.associate(checked.specification!, candidate);
    if (!associated.value || canonical(associated.value.baseline) !== canonical(candidate) || !identity.compare(prior, associated.value).value) return refuse('Current specification does not match the retained candidate identities.');
    const confirmed = readIdentity(snapshot, checked);
    if (!confirmed.value) return refuse('The current identity confirmation is invalid.');
    const expected = record.remaining[0] === selected[0] ? prior : candidate;
    if ((confirmed.value.baseline === undefined) !== (expected === undefined)
      || confirmed.value.baseline && expected && specification(confirmed.value.baseline) !== specification(expected)) return refuse('Current identity confirmation does not belong to the retained transition.');
    return { value: { ...(prior ? { before: prior } : {}), candidate, remaining: record.remaining, record }, problems: [], deferred: [] };
  } catch (error) { return refuse('Cannot read the retained output transition: ' + String(error)); }
}
export function transitionChange(transition: BuildTransition, completed?: Stage): FileChange {
  const remaining = completed ? transition.remaining.filter(stage => stage !== completed) : transition.remaining;
  return remaining.length ? { kind: 'write', path: transitionPath, bytes: Buffer.from(canonical({ ...transition.record, remaining }) + '\n') }
    : { kind: 'remove', path: transitionPath };
}
