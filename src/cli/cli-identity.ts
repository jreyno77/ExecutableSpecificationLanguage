import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { Check, Diagnostic } from '../compiler/checking.js';
import type { CheckedManifest } from './cli-check.js';
import { cliProblem } from './cli-check.js';
import { canonical, eligibleKinds, identifier } from '../model/identity-baseline.js';
import { hash } from '../project/connection/project-files.js';
import { readJson } from '../project/connection/json-data.js';
import type { ProjectRoot, ProjectSnapshot } from '../project/connection/project-connection.js';
import { SpecificationIdentity, type IdentifiedSpecification, type IdentityBaseline, type IdentityDecision } from '../model/specification-identity.js';

export const identityPath = '.expec/identity.json', pendingPath = '.expec/build-pending.json', transitionPath = '.expec/build-transition.json';
export const identities = () => new SpecificationIdentity(randomUUID);
export function readIdentity(snapshot: ProjectSnapshot, checked: CheckedManifest): Check<{ baseline?: IdentityBaseline }> {
  const file = snapshot.files.find(file => file.path === identityPath), problems: Diagnostic[] = [];
  if (!file) return { value: {}, problems: [], deferred: [] };
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); }
  catch { return { problems: [cliProblem('identity-baseline', 'The confirmed identity file is not valid UTF-8.', checked.manifest)], deferred: [] }; }
  const data = readJson(text, (code, message) => problems.push(cliProblem(code, message, checked.manifest)));
  if (problems.length) return { problems, deferred: [] };
  if (data && typeof data === 'object' && 'format' in data && data.format !== 1) return { problems: [cliProblem('identity-format', 'Unsupported confirmed identity format.', checked.manifest)], deferred: [] };
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).sort().join(',') !== 'baseline,format,manifest,project'
    || !('format' in data) || data.format !== 1 || !('manifest' in data) || data.manifest !== checked.manifest
    || !('project' in data) || canonical(data.project) !== canonical(snapshot.root) || !('baseline' in data)) {
    return { problems: [cliProblem('identity-baseline', 'The confirmed ledger belongs to another manifest/root or has an unsupported shape.', checked.manifest)], deferred: [] };
  }
  const result = identities().read({ sourceId: identityPath, text: JSON.stringify(data.baseline) });
  return { problems: result.problems, deferred: result.deferred, ...(result.value ? { value: { baseline: result.value } } : {}) };
}
export function identityBytes(checked: CheckedManifest, root: ProjectRoot, baseline: IdentityBaseline): Uint8Array {
  const valid = identities().write(baseline);
  if (!valid.value) throw Error('Cannot persist invalid identity: ' + JSON.stringify(valid.problems));
  return Buffer.from(canonical({ format: 1, manifest: checked.manifest, project: root, baseline: JSON.parse(valid.value) }, 2) + '\n');
}

/** Native execution requires the current source to match the confirmed generated identity. */
export function currentTestIdentity(checked: CheckedManifest, snapshot: ProjectSnapshot): Check<IdentifiedSpecification> {
  const fail = (message: string): Check<IdentifiedSpecification> => ({ problems: [cliProblem('generation-required', message, checked.manifest)], deferred: [] });
  if (snapshot.files.some(file => file.path === pendingPath || file.path === transitionPath)) return fail('Complete the pending build before executing tests.');
  const saved = readIdentity(snapshot, checked);
  if (!saved.value) return { problems: saved.problems, deferred: saved.deferred };
  if (!saved.value.baseline) return fail('Build the current specification before executing its tests.');
  const identity = identities(), associated = identity.associate(checked.specification!, saved.value.baseline);
  if (!associated.value) return fail('Current source requires generation or explicit identity correspondence.');
  const compared = identity.compare(saved.value.baseline, associated.value);
  if (!compared.value || compared.value.contextChanged || compared.value.changes.length) return fail('Current source differs from its confirmed generated specification.');
  return associated;
}

const decisionSchema = z.strictObject({ format: z.literal(1), matches: z.array(z.strictObject({ id: identifier, to: z.union([
  z.strictObject({ source: z.string().trim().min(1), line: z.number().int().positive(), column: z.number().int().positive() }),
  z.strictObject({ module: z.string().trim().min(1), path: z.array(z.union([z.string(), z.number().int().nonnegative()])) }),
]) })), retire: z.array(identifier) });
export async function readDecisions(filename: string | undefined, checked: CheckedManifest): Promise<Check<{
  decisions: IdentityDecision[]; inputs: { uri: string; version: string }[];
}>> {
  if (!filename) return { value: { decisions: [], inputs: [] }, problems: [], deferred: [] };
  const problems: Diagnostic[] = [], refuse = (message: string) => ({ problems: [cliProblem('invalid-decisions', message, filename)], deferred: [] });
  try {
    const path = await fs.realpath(filename), before = await fs.lstat(path, { bigint: true }), bytes = await fs.readFile(path), after = await fs.lstat(path, { bigint: true });
    if (!before.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.mtimeNs !== after.mtimeNs) return refuse('Decision file changed during capture.');
    const raw = readJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), (code, message) => problems.push(cliProblem(code, message, filename)));
    if (problems.length) return { problems, deferred: [] };
    const parsed = decisionSchema.safeParse(raw);
    if (!parsed.success) return refuse('Provide format 1 with exact matches and retire lists: ' + parsed.error.message);
    const decisions: IdentityDecision[] = parsed.data.retire.map(retire => ({ retire }));
    for (const match of parsed.data.matches) {
      const target = match.to, sourceId = 'source' in target ? pathToFileURL(resolve(dirname(checked.manifest), target.source)).href : undefined;
      const nodes = eligibleKinds.flatMap(kind => [...checked.specification!.inspection.query(kind)]).filter(item => {
        const origin = item.origin;
        return 'source' in target ? origin.kind === 'source' && origin.range.sourceId === sourceId
          && origin.range.start.line === target.line && origin.range.start.column === target.column
          : origin.kind === 'external' && origin.module === target.module && canonical(origin.path) === canonical(target.path);
      });
      if (nodes.length !== 1) return refuse('Decision ' + match.id + ' must select one actual eligible declaration start: ' + JSON.stringify(target));
      decisions.push({ id: match.id, to: nodes[0]!.id });
    }
    return { value: { decisions, inputs: [{ uri: pathToFileURL(path).href, version: hash(bytes) }] }, problems: [], deferred: [] };
  } catch (error) { return refuse(String(error)); }
}
