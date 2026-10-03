import { describe, expect, it } from 'vitest';
import {
  createNodeId, QueryInspection, QueryError, isNodeId, Resolver,
  type Model, type ModelNode, type NodeId, type NodeKind, type Origin,
} from '../../src/index.js';

function suppliedGetterContract(): Model {
  const nameId = createNodeId();
  const origin: Origin = { kind: 'external', module: 'getter-contract', path: [] };
  const capability = new class implements ModelNode<'capability'> {
    readonly id = createNodeId();
    readonly kind = 'capability' as const;
    readonly origin = origin;
    get name(): NodeId { return nameId; }
    get failures(): readonly NodeId[] { return []; }
    get parameters(): readonly NodeId[] { return []; }
    get body() { return { kind: 'absent' as const }; }
  }();
  const name: ModelNode<'name'> = { id: nameId, kind: 'name', origin, decoded: 'save' };
  const records: readonly ModelNode[] = [capability, name];
  function node(id: NodeId): ModelNode;
  function node<K extends NodeKind>(id: NodeId, kind: K): ModelNode<K>;
  function node(id: NodeId, kind?: NodeKind): ModelNode {
    const record = records.find(candidate => candidate.id === id);
    if (!record) throw new QueryError(isNodeId(id) ? 'foreign-node' : 'missing-node', id, 'Unknown supplied node.');
    if (kind !== undefined && record.kind !== kind) throw new QueryError('unexpected-kind', id, 'Wrong supplied kind.', kind, record.kind);
    return record;
  }
  return {
    roots: () => [capability.id],
    nodes: <K extends NodeKind>(kind: K) => records.filter(record => record.kind === kind) as ModelNode<K>[],
    node,
    children: id => { node(id); return id === capability.id ? [nameId] : []; },
    parent: id => { node(id); return id === nameId ? capability.id : undefined; },
    resolution: id => { node(id, 'reference'); return { status: 'not-analyzed' }; },
  };
}

describe('readable inspection accepts ordinary contract implementations', () => {
  it('retains supplied class getters through a resolution snapshot', () => {
    const model = { ...suppliedGetterContract(), locator: 'getter-contract' };
    const result = new Resolver().resolve(model, { modules: [], packages: [] });
    const capability = [...new QueryInspection(result.model).query('capability')][0]!;

    expect(capability.name).toBe('save');
    expect(capability.parameters).toEqual([]);
    expect(capability.body).toEqual({ kind: 'absent' });
  });
  it('reads supplied capability properties implemented by class getters', () => {
    const inspection = new QueryInspection(suppliedGetterContract());

    const capability = [...inspection.query('capability')][0]!;

    expect(capability.name).toBe('save');
    expect(capability.parameters).toEqual([]);
    expect(capability.body).toEqual({ kind: 'absent' });
  });
});
