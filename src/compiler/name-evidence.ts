import type { NodeId, Origin } from '../model/model.js';

interface Selection {
  readonly origin: Origin;
  readonly spelling: string;
  readonly declaration?: NodeId;
}
interface Packet { readonly parents: readonly Packet[]; readonly selection?: Selection }
const evidence = Symbol('checked source names');
type WithEvidence = { readonly [evidence]?: Packet };

/** Result-owned immutable evidence; non-enumerable to preserve public Check surfaces. */
export function retainNames<T extends object>(result: T, ...inputs: readonly object[]): T {
  const parents = [...new Set([result, ...inputs].flatMap(input => {
    const packet = (input as WithEvidence)[evidence];
    return packet ? [packet] : [];
  }))];
  return !parents.length ? result : attach(result, parents.length === 1 ? parents[0]! : { parents: Object.freeze(parents) });
}

/** Undefined declaration acknowledges a checked implicit result, never an unknown selection. */
export function selectName<T extends object>(result: T, origin: Origin, spelling: string, declaration?: NodeId): T {
  const parent = (result as WithEvidence)[evidence];
  const selection = Object.freeze({ origin: captureOrigin(origin), spelling, ...(declaration ? { declaration } : {}) });
  return attach(result, { parents: Object.freeze(parent ? [parent] : []), selection });
}

export function* selectedNames(input: object): Iterable<Selection> {
  const packet = (input as WithEvidence)[evidence], pending = packet ? [packet] : [], seen = new Set<Packet>();
  while (pending.length) {
    const next = pending.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    if (next.selection) yield next.selection;
    pending.push(...next.parents);
  }
}

function attach<T extends object>(result: T, packet: Packet): T {
  return Object.defineProperty({ ...result }, evidence, { value: Object.freeze(packet) });
}
function captureOrigin(origin: Origin): Origin {
  if (origin.kind === 'source') return Object.freeze({ ...origin, node: Object.freeze({ ...origin.node }),
    range: Object.freeze({ ...origin.range, start: Object.freeze({ ...origin.range.start }), end: Object.freeze({ ...origin.range.end }) }) });
  return Object.freeze(origin.kind === 'external' ? { ...origin, path: Object.freeze([...origin.path]) } : { ...origin });
}
