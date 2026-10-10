import { isNodeId, QueryError, type Model, type ModelNode, type NodeId, type NodeKind, type ReferenceResolution } from '../model/model.js';
import { nameText } from '../language/name-text.js';
import type { Check, Diagnostic, Requirement } from './checking.js';
import type { Resolution } from './resolution.js';
import { lookupResolution, typeLookupKinds } from './resolution/reference-resolver.js';
import type { ScopeGraph, CandidateContext } from './resolution/scopes.js';
import type { SourceIndex } from './resolution/source-index.js';

/** An eligible type spelling and its declaration in the same captured resolution. */
export interface TypeCandidate {
  readonly name: string;
  readonly insertionText: string;
  readonly target: NodeId;
}

type CapturedQuery = {
  readonly reference: ModelNode<'reference'>;
  readonly path: readonly string[];
  readonly binding: ReferenceResolution;
  readonly context: CandidateContext;
  readonly kinds: ReadonlySet<NodeKind>;
};
type CandidateCapture = {
  readonly graph: ScopeGraph;
  readonly queries: ReadonlyMap<NodeId, CapturedQuery>;
  readonly replies: Map<NodeId, Check<readonly TypeCandidate[]>>;
};
const captures = new WeakMap<Model, CandidateCapture>();

/** Internal linking handoff: no supplied model or live scope graph survives it. */
export function captureTypeCandidates(model: Model, scopes: ScopeGraph, sources: readonly SourceIndex[],
  bindings: ReadonlyMap<NodeId, ReferenceResolution>, capture: <T>(value: T) => T): void {
  const snapshot = scopes.snapshot(capture);
  const queries = new Map<NodeId, CapturedQuery>();
  for (const source of sources) for (const reference of source.of('reference')) {
    const parent = source.parent(reference.id);
    if (parent?.kind !== 'named-type' && parent?.kind !== 'depends-on') continue;
    const path = source.reference(reference.id);
    const context = scopes.candidateContext(scopes.scope(reference.id), path.slice(0, -1), reference.lookup, source.locator);
    queries.set(reference.id, { reference: capture(reference), path: [...path], binding: capture(bindings.get(reference.id)!),
      kinds: typeLookupKinds(reference.lookup), context: {
        scope: context.scope && snapshot.scope(context.scope), requester: snapshot.scope(context.requester),
        ownOnly: context.ownOnly, exportsOnly: context.exportsOnly,
        ...(context.failure ? { failure: capture(context.failure) } : {}),
      } });
  }
  captures.set(model, { graph: snapshot.graph, queries, replies: new Map() });
}

/** Ask the captured type-reference context for eligible final-segment names. */
export function typeCandidates(resolution: Resolution, reference: NodeId): Check<readonly TypeCandidate[]> {
  resolution.model.node(reference, 'reference');
  const captured = captures.get(resolution.model);
  if (!captured) throw new QueryError('not-analyzed', reference, 'This model has no captured type-candidate context.');
  const query = captured.queries.get(reference);
  if (!query) throw new QueryError('unexpected-kind', reference, 'Expected a named-type or depends-on reference.');
  const cached = captured.replies.get(reference);
  if (cached) return cached;
  const reply = freeze(answer(resolution.model, captured.graph, query));
  captured.replies.set(reference, reply);
  return reply;
}

function answer(model: Model, graph: ScopeGraph, query: CapturedQuery): Check<readonly TypeCandidate[]> {
  if (query.binding.status === 'deferred') return { problems: [], deferred: [query.binding.requirement] };
  const problems: Diagnostic[] = [], deferred: Requirement[] = [], value: TypeCandidate[] = [];
  const outcome = (found: Parameters<typeof lookupResolution>[2], path: readonly string[], required?: ReadonlySet<NodeKind>) =>
    lookupResolution(query.reference, path, found, required, {
      moduleLookup: query.context.exportsOnly,
      ...(found.status === 'subject-context' ? { subject: model.resolution(found.subject) } : {}),
    });
  const retain = (result: ReferenceResolution): void => {
    if (result.status === 'invalid') problems.push(...result.problems);
    if (result.status === 'deferred') deferred.push(result.requirement);
  };
  if (query.context.failure) {
    retain(outcome(query.context.failure, query.path));
    return { problems, deferred };
  }
  for (const { name, found } of graph.candidateLookups(query.context)) {
    // Visibility and nearest-name selection happen before this type-kind filter.
    if (found.status === 'missing' || found.status === 'inaccessible' ||
        (found.status === 'found' && !query.kinds.has(found.declaration.kind))) continue;
    const result = outcome(found, [...query.path.slice(0, -1), name], query.kinds);
    if (result.status !== 'bound') { retain(result); continue; }
    if (!name || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(name) || /[\uD800-\uDFFF]/u.test(name)) {
      const declaration = model.node(result.target);
      problems.push({ code: 'invalid-dependency-input', message: 'This type name has no valid single-segment language spelling.',
        at: 'name' in declaration ? model.node(declaration.name, 'name').origin : declaration.origin, related: [] });
      continue;
    }
    value.push({ name, insertionText: nameText(name), target: result.target });
  }
  return { value, problems, deferred };
}

/** Replies own only plain captured facts and opaque handles; callers cannot poison reuse. */
function freeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || isNodeId(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}
