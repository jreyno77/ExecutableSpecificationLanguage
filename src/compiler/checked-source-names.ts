import type { SourceRange } from '../language/grammar/source.js';
import { QueryError, type Model, type NodeId, type Origin } from '../model/model.js';
import { mergeChecks, type Check } from './checking.js';
import { selectedNames } from './name-evidence.js';

export interface CheckedSourceName {
  readonly range: SourceRange;
  readonly spelling: string;
  /** Aliases and captures use their authored Name handle; other names use the declaration. */
  readonly declaration: NodeId;
}
export interface CheckedSourceNames {
  /** Zero-based scalar cursor; whole-token range, or ordinary absence outside an editable name. */
  at(sourceId: string, offset: number): Check<CheckedSourceName>;
  /** A complete source list is withheld when any name selection in it is uncertain. */
  inSource(sourceId: string): Check<readonly CheckedSourceName[]>;
  /** Includes the authored introduction; requires complete selection evidence across this specification. */
  occurrencesOf(declaration: NodeId): Check<readonly CheckedSourceName[]>;
}

type SourceOrigin = Extract<Origin, { kind: 'source' }>;
type Token = { origin: SourceOrigin; spelling: string; owners: Set<NodeId>; implicit: boolean; conflict: boolean };

/** Index only captured choices; unacknowledged source names remain explicit prerequisites. */
export function captureSourceNames(model: Model, ...evidence: readonly object[]): CheckedSourceNames {
  const sources = new Set<string>(), tokens = new Map<string, Token>(), introductions = new Set<NodeId>();
  const introduce = (token: Token, id: NodeId) => { token.owners.add(id); introductions.add(id); };
  for (const id of model.roots()) {
    const origin = model.node(id).origin;
    if (origin.kind === 'source') sources.add(origin.range.sourceId);
  }
  for (const name of model.nodes('name')) {
    if (name.origin.kind !== 'source') continue;
    const origin = sourceOrigin(name.origin), key = locationKey(origin.range);
    sources.add(origin.range.sourceId);
    const token = tokens.get(key) ?? { origin, spelling: name.decoded, owners: new Set<NodeId>(), implicit: false, conflict: false };
    tokens.set(key, token);
    const parentId = model.parent(name.id), parent = parentId ? model.node(parentId) : undefined;
    if (!parent) continue;
    if ('name' in parent && parent.name === name.id && parent.kind !== 'record-entry') introduce(token, parent.id);
    if (parent.kind === 'import-item' && parent.alias === name.id
      || 'capture' in parent && parent.capture === name.id) introduce(token, name.id);
  }
  for (const input of evidence) for (const selection of selectedNames(input)) {
    if (selection.origin.kind !== 'source') continue;
    const key = locationKey(selection.origin.range);
    const token = tokens.get(key) ?? { origin: sourceOrigin(selection.origin), spelling: selection.spelling,
      owners: new Set<NodeId>(), implicit: false, conflict: false };
    tokens.set(key, token); sources.add(selection.origin.range.sourceId);
    if (token.spelling !== selection.spelling) token.conflict = true;
    if (selection.declaration) token.owners.add(selection.declaration);
    else token.implicit = true;
  }
  const bySource = new Map<string, { range: SourceRange; answer: Check<CheckedSourceName> }[]>();
  const byOwner = new Map<NodeId, CheckedSourceName[]>();
  const ordered = [...tokens.values()].sort((a, b) => compareRange(a.origin.range, b.origin.range));
  for (const token of ordered) {
    const { origin, spelling, owners, implicit } = token, range = origin.range;
    let answer: Check<CheckedSourceName>;
    if (token.conflict || owners.size > 1 || owners.size && implicit) {
      answer = { problems: [{ code: 'ambiguous-source-name',
        message: 'Accepted checking paths selected different owners for ' + spelling + '.', at: origin,
        related: [...owners].map(id => model.node(id).origin) }], deferred: [] };
    } else if (owners.size) {
      const declaration = [...owners][0]!, value = Object.freeze({ range, spelling, declaration });
      answer = { value, problems: [], deferred: [] };
      const occurrences = byOwner.get(declaration) ?? [];
      occurrences.push(value); byOwner.set(declaration, occurrences);
    } else if (implicit) answer = { problems: [], deferred: [] };
    else answer = { problems: [], deferred: [{ reason: 'source-name-selection', origin,
      requires: 'Checking must supply the actual owner of ' + spelling + ' before reporting complete source names.' }] };
    const entries = bySource.get(range.sourceId) ?? [];
    entries.push({ range, answer: freezeCheck(answer) }); bySource.set(range.sourceId, entries);
  }
  const all = [...bySource.values()].flatMap(entries => entries.map(entry => entry.answer));
  const findings = freezeCheck(mergeChecks(...all));
  const sourceAnswers = new Map([...sources].map(sourceId => {
    const checks = (bySource.get(sourceId) ?? []).map(entry => entry.answer), problems = mergeChecks(...checks);
    return [sourceId, freezeCheck<readonly CheckedSourceName[]>({ ...problems,
      ...(!problems.problems.length && !problems.deferred.length ? { value: Object.freeze(checks.flatMap(check => check.value ? [check.value] : [])) } : {}) })] as const;
  }));
  const occurrences = new Map([...byOwner].map(([owner, entries]) => [owner, Object.freeze(entries)] as const));
  const empty = Object.freeze([]) as readonly CheckedSourceName[];
  const source = (sourceId: string) => {
    if (!sources.has(sourceId)) throw new RangeError('The compiled specification has no source provenance for ' + sourceId + '.');
    return bySource.get(sourceId) ?? [];
  };
  return Object.freeze({
    at(sourceId: string, offset: number): Check<CheckedSourceName> {
      const entries = source(sourceId);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError('A source-name offset must be a nonnegative safe integer.');
      let low = 0, high = entries.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (entries[middle]!.range.start.offset <= offset) low = middle + 1;
        else high = middle;
      }
      const selected = entries[low - 1];
      return selected && offset < selected.range.end.offset ? selected.answer : freezeCheck({ problems: [], deferred: [] });
    },
    inSource(sourceId: string): Check<readonly CheckedSourceName[]> { source(sourceId); return sourceAnswers.get(sourceId)!; },
    occurrencesOf(declaration: NodeId): Check<readonly CheckedSourceName[]> {
      const node = model.node(declaration);
      const named = 'name' in node && node.kind !== 'record-entry';
      if (!named && !introductions.has(declaration)) throw new QueryError('unexpected-kind', declaration, 'Expected a declaration, import alias or capture name.');
      return findings.problems.length || findings.deferred.length ? findings
        : freezeCheck({ value: occurrences.get(declaration) ?? empty, problems: [], deferred: [] });
    },
  });
}

function locationKey(range: SourceRange): string { return JSON.stringify([range.sourceId, range.start.offset, range.end.offset]); }
function compareRange(a: SourceRange, b: SourceRange): number {
  return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : a.start.offset - b.start.offset || a.end.offset - b.end.offset;
}
function sourceOrigin(origin: SourceOrigin): SourceOrigin {
  return Object.freeze({ ...origin, node: Object.freeze({ ...origin.node }), range: Object.freeze({ ...origin.range,
    start: Object.freeze({ ...origin.range.start }), end: Object.freeze({ ...origin.range.end }) }) });
}
function freezeCheck<T>(check: Check<T>): Check<T> {
  return Object.freeze({ ...check, problems: Object.freeze(check.problems.map(problem => Object.freeze({ ...problem,
    related: Object.freeze(problem.related.map(at => at.kind === 'source' ? sourceOrigin(at)
      : Object.freeze(at.kind === 'external' || at.kind === 'dependency' ? { ...at, path: Object.freeze([...at.path]) } : { ...at }))) }))),
    deferred: Object.freeze(check.deferred.map(requirement => Object.freeze({ ...requirement }))) });
}
