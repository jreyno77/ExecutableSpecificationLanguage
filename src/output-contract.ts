import type { Check, Diagnostic } from './checking.js';
import { canonical, identifier, locatorSchema } from './identity-baseline.js';
import type { OutputPlan } from './output.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { ProjectRead, ProjectSearch } from './project-inspection.js';
import type { RelationshipObservation } from './relationship-reconciliation.js';
import { literal, marker } from './project-files.js';
const require = (condition: unknown, message: string): void => { if (!condition) throw new TypeError(message); };
function diagnostics(value: readonly Diagnostic[]): void {
  require(Array.isArray(value) && value.every(item => item && typeof item.code === 'string' && typeof item.message === 'string'
    && item.at && typeof item.at.kind === 'string' && Array.isArray(item.related)), 'Malformed output diagnostics.');
}
function locator(value: unknown, id: string): void { const parsed = locatorSchema.safeParse(value); require(parsed.success && parsed.data.outputId === id, 'Malformed or foreign output locator.'); }
function coverage(value: RelationshipObservation['coverage'], snapshot: ProjectSnapshot, id: string, unresolved = 0): void {
  require(value && Array.isArray(value.scope) && typeof value.complete === 'boolean' && Array.isArray(value.limitations)
    && value.limitations.every(item => typeof item === 'string'), 'Malformed output coverage.');
  value.scope.forEach(at => locator(at, id));
  require(value.complete === !(value.limitations.length || unresolved), 'Coverage must explain exactly why observations are incomplete.');
  require(!value.complete || snapshot.complete && !snapshot.problems.length && !!value.scope.length && !value.limitations.length, 'Incomplete project or limitations cannot claim complete coverage.');
}
export function checkPlan(result: Check<OutputPlan>, snapshot: ProjectSnapshot, id: string): void {
  require(result && Array.isArray(result.problems) && Array.isArray(result.deferred), 'Malformed output plan.'); diagnostics(result.problems);
  require(!result.deferred.length, 'An output plan cannot defer compiler requirements.');
  if (!result.value) { require(result.problems.length, 'A refused output plan must explain why.'); return; }
  const plan = result.value;
  require(snapshot.complete && !snapshot.problems.length, 'A successful output plan requires complete input.');
  require(!result.problems.length && plan.outputId === id && canonical(plan.basedOn) === canonical(snapshot), 'A successful plan must retain its output, snapshot, and clean findings.');
  require(Array.isArray(plan.changes) && Array.isArray(plan.artifacts), 'Malformed file changes or associations.');
  const endpoints: string[] = [], locators = new Set<string>();
  for (const change of plan.changes) {
    require(change && ['write', 'remove', 'move'].includes(change.kind), 'Unknown output file operation.');
    for (const path of change.kind === 'move' ? [change.from, change.to] : [change.path]) {
      require(literal(path) && !path.split('/').some(part => snapshot.excludeNames.includes(part)) && path !== '.expec'
        && path !== marker && !path.startsWith(marker + '/'), 'Output file path is not writable within this snapshot.');
      const key = process.platform === 'win32' ? path.toLowerCase() : path;
      require(!endpoints.some(other => key === other || key.startsWith(other + '/') || other.startsWith(key + '/')), 'Output changes overlap.'); endpoints.push(key);
    }
    require(change.kind === 'remove' || change.kind === 'move' && change.bytes === undefined || change.bytes instanceof Uint8Array, 'Output contents must be bytes.');
  }
  for (const association of plan.artifacts) {
    require(identifier.safeParse(association.specId).success, 'Malformed association subject.'); locator(association.locator, id);
    const key = canonical(association.locator); require(!locators.has(key), 'Duplicate output association locator.'); locators.add(key);
  }
}
export function checkRead(result: ProjectRead, snapshot: ProjectSnapshot, id: string): void {
  require(result && Array.isArray(result.artifacts), 'Malformed output read.'); diagnostics(result.problems); coverage(result.coverage, snapshot, id);
  for (const artifact of result.artifacts) {
    locator(artifact.at, id);
    const file = snapshot.files.find(file => file.path === artifact.file?.path);
    require(file && artifact.file.bytes instanceof Uint8Array && file.version === artifact.file.version
      && Buffer.from(file.bytes).equals(artifact.file.bytes), 'An output read must report complete files actually captured in its snapshot.');
  }
}
export function checkSearch(result: ProjectSearch, snapshot: ProjectSnapshot, id: string, subject: string): void {
  require(result && Array.isArray(result.definitions), 'Malformed output search.'); diagnostics(result.problems); result.definitions.forEach(at => locator(at, id));
  for (const direction of ['incoming', 'outgoing'] as const) {
    const observation = result[direction];
    require(observation && observation.subject === subject && observation.direction === direction
      && Array.isArray(observation.uses) && Array.isArray(observation.unresolved), 'Malformed relationship observation.');
    coverage(observation.coverage, snapshot, id, observation.unresolved.length);
    require(!observation.coverage.complete || !observation.unresolved.length, 'Unresolved uses cannot claim complete coverage.');
    for (const use of observation.uses) { locator(use.at, id); require(use.target && ['specified', 'project'].includes(use.target.kind) && typeof use.target.id === 'string' && use.target.id.trim(), 'Malformed relationship target.'); }
    for (const unresolved of observation.unresolved) { locator(unresolved.at, id); require(typeof unresolved.reason === 'string', 'Malformed unresolved observation.'); }
  }
}

import type { SpecDiff, IdentifiedSpecification } from './specification-identity.js';
export function validDiff(diff: SpecDiff, current: IdentifiedSpecification): boolean {
  const known = new Set([...current.baseline.elements.map(record => record.id), ...current.baseline.retired]);
  if (!diff || !Array.isArray(diff.changes) || !Array.isArray(diff.affected) || typeof diff.contextChanged !== 'boolean'
    || new Set(diff.changes.map(change => change.id)).size !== diff.changes.length || new Set(diff.affected).size !== diff.affected.length
    || diff.affected.some(id => !identifier.safeParse(id).success || !known.has(id))) return false;
  for (const change of diff.changes) {
    const { before, after, kinds } = change, record = current.baseline.elements.find(record => record.id === change.id);
    if (!identifier.safeParse(change.id).success || !known.has(change.id) || !before && !after || !Array.isArray(kinds) || !kinds.length || new Set(kinds).size !== kinds.length
      || kinds.some(kind => !['add', 'remove', 'rename', 'move', 'update', 'artifacts'].includes(kind))
      || before && before.id !== change.id || after && (after.id !== change.id || canonical(after) !== canonical(record))) return false;
    const expected = [...(!before && after ? ['add'] : []), ...(before && !after ? ['remove'] : []),
      ...(before && after && before.address.name !== after.address.name ? ['rename'] : []),
      ...(before && after && (before.address.module !== after.address.module || before.address.owner !== after.address.owner) ? ['move'] : []),
      ...(before && after && (before.structure !== after.structure || before.address.kind !== after.address.kind) ? ['update'] : [])];
    if (canonical(kinds.filter(kind => kind !== 'artifacts').sort()) !== canonical(expected.sort())
      || before && !after && (record || !current.baseline.retired.includes(change.id))) return false;
  }
  return true;
}

