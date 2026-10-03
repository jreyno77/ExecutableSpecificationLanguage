import { z } from 'zod';
import type { Check } from './checking.js';
import { captured, failure, identifier, jsonData, locatorSchema, success, validateBaseline, type JsonValue, type SpecIdentifier } from './identity-baseline.js';
import type { IdentifiedSpecification } from './specification-identity.js';

const useSchema = z.strictObject({
  target: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('specified'), id: identifier }),
    z.strictObject({ kind: z.literal('project'), id: z.string().min(1) })]),
  at: locatorSchema,
});
const observationSchema = z.strictObject({ subject: identifier, direction: z.enum(['incoming', 'outgoing']),
  coverage: z.strictObject({ scope: z.array(locatorSchema), complete: z.boolean(), limitations: z.array(z.string().min(1)) }),
  uses: z.array(useSchema), unresolved: z.array(z.strictObject({ at: locatorSchema, reason: z.string().min(1) })) });
type ReadonlyData<T> = JsonValue extends T ? T : T extends object ? { readonly [K in keyof T]: ReadonlyData<T[K]> } : T;
export type ObservedRelationship = ReadonlyData<z.infer<typeof useSchema>>;
export type RelationshipObservation = ReadonlyData<z.infer<typeof observationSchema>>;
export interface Reconciliation {
  readonly observation: RelationshipObservation;
  readonly matched: readonly { readonly id: SpecIdentifier; readonly uses: readonly ObservedRelationship[] }[];
  readonly unobserved: readonly SpecIdentifier[];
  readonly observedOnly: readonly ObservedRelationship[];
}

/** Compare supplied identity facts; completeness remains the observing adapter's scoped claim. */
export function reconcileRelationships(current: IdentifiedSpecification, expected: readonly SpecIdentifier[], observed: RelationshipObservation): Check<Reconciliation> {
  const baseline = validateBaseline(current.baseline);
  if (!baseline.value) return { problems: baseline.problems, deferred: baseline.deferred };
  if (!jsonData(observed)) return failure('identity-observation', 'Observations must contain finite acyclic JSON data.');
  const parsed = observationSchema.safeParse(observed);
  if (!parsed.success) return failure('identity-observation', parsed.error.message);
  const observation = parsed.data, active = new Set(baseline.value.elements.map(element => element.id));
  const known = new Set([...active, ...baseline.value.retired]);
  if (!known.has(observation.subject) || expected.some(id => !active.has(id)) || new Set(expected).size !== expected.length
    || observation.uses.some(use => use.target.kind === 'specified' && !known.has(use.target.id))) {
    return failure('identity-observation', 'Use established subject/target identifiers and unique active expectations.');
  }
  const incomplete = observation.coverage.limitations.length > 0 || observation.unresolved.length > 0;
  if (observation.coverage.complete === incomplete || observation.coverage.complete && !observation.coverage.scope.length) {
    return failure('identity-observation', 'Coverage contradicts its scope, limitations or unresolved observations.');
  }
  const matched = expected.map(id => ({ id, uses: observation.uses.filter(use => use.target.kind === 'specified' && use.target.id === id) }));
  return success(captured({ observation, matched: matched.filter(match => match.uses.length),
    unobserved: matched.filter(match => !match.uses.length).map(match => match.id),
    observedOnly: observation.uses.filter(use => use.target.kind === 'project' || !expected.includes(use.target.id)) }));
}
