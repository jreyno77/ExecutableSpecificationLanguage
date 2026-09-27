import type { SourceNodeId, SourcePayload } from '../grammar/source.js';
import type { InspectionInput, InspectionNode, NodeId, Origin } from './model.js';
import { createNodeId } from './view.js';

/** Adapt accepted reader data once; preserve authored nodes while normalizing declaration facts. */
export function sourceNodes(locator: string, description: InspectionInput): { roots: NodeId[]; nodes: InspectionNode[] } {
  const handles = new Map(description.nodes.map(node => [node.id.ordinal, createNodeId()]));
  const parameters = new Map<number, NodeId>();
  for (const node of description.nodes) {
    if ('typeParameters' in node.payload) {
      for (const id of node.payload.typeParameters) parameters.set(id.ordinal, createNodeId());
    }
  }
  function handle(id: Readonly<SourceNodeId>): NodeId {
    const result = handles.get(id.ordinal);
    if (!result || id.sourceId !== description.sourceId) throw new Error('Inspection requires a complete accepted reader description.');
    return result;
  }
  function map(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(map);
    if ('sourceId' in value && 'ordinal' in value) return handle(value as SourceNodeId);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, map(item)]));
  }
  const nodes: InspectionNode[] = [];
  for (const source of description.nodes) {
    const origin: Origin = { kind: 'source', module: locator, node: { ...source.id }, range: structuredClone(source.range) };
    const id = handle(source.id);
    const parameter = parameters.get(source.id.ordinal);
    if (parameter) nodes.push({ id: parameter, origin, payload: { kind: 'type-parameter', name: id } });
    const payload = map(source.payload) as Record<string, unknown>;
    const kind = source.payload.kind;
    if (kind === 'reference') payload.resolution = { status: 'not-analyzed' };
    if (kind === 'field' || kind === 'parameter') payload.hasDefault = source.payload.defaultValue !== undefined;
    if (isCallable(kind)) {
      const body = 'body' in source.payload ? source.payload.body : undefined;
      payload.body = body === undefined ? { kind: 'absent' } : { kind: 'available', node: handle(body) };
    }
    if ('typeParameters' in source.payload) payload.typeParameters = source.payload.typeParameters.map(id => parameters.get(id.ordinal)!);
    nodes.push({ id, origin, payload } as InspectionNode);
  }
  return { roots: description.roots.map(handle), nodes };
}
function isCallable(kind: SourcePayload['kind']): boolean {
  return kind === 'function' || kind === 'capability' || kind === 'setup' || kind === 'action' || kind === 'observation' || kind === 'check';
}
