import { describe, expect, it } from 'vitest';
import {
  createNodeId, isNodeId, LangiumModel, LangiumReader, QueryError, QueryInspection,
  type Inspection, type Model, type ModelNode, type NodeId, type NodeKind, type Origin, type ReferenceResolution,
} from '../../src/index.js';

/** An independently supplied provider; it does not inherit production indexing or projection. */
class MemoryContract implements Model {
  private readonly byId = new Map<NodeId, ModelNode>();
  private readonly byKind = new Map<NodeKind, ModelNode[]>();
  constructor(private readonly declarations: readonly ModelNode[], private readonly containment: ReadonlyMap<NodeId, readonly NodeId[]>) {
    for (const node of declarations) {
      this.byId.set(node.id, node);
      const indexed = this.byKind.get(node.kind) ?? [];
      indexed.push(node);
      this.byKind.set(node.kind, indexed);
    }
  }
  roots(): readonly NodeId[] { return this.declarations.filter(node => this.parent(node.id) === undefined).map(node => node.id); }
  nodes<K extends NodeKind>(kind: K): readonly ModelNode<K>[] { return (this.byKind.get(kind) ?? []) as ModelNode<K>[]; }
  node(id: NodeId): ModelNode;
  node<K extends NodeKind>(id: NodeId, kind: K): ModelNode<K>;
  node(id: NodeId, kind?: NodeKind): ModelNode {
    const node = this.byId.get(id);
    if (!node) throw new QueryError(isNodeId(id) ? 'foreign-node' : 'missing-node', id, 'This node is not in the supplied contract.');
    if (kind !== undefined && node.kind !== kind) throw new QueryError('unexpected-kind', id, 'The contract node has another kind.', kind, node.kind);
    return node;
  }
  children(id: NodeId): readonly NodeId[] { this.node(id); return this.containment.get(id) ?? []; }
  parent(id: NodeId): NodeId | undefined {
    this.node(id);
    return [...this.containment].find(([, children]) => children.includes(id))?.[0];
  }
  resolution(id: NodeId): ReferenceResolution { this.node(id, 'reference'); return { status: 'not-analyzed' }; }
}

function suppliedContract(): Model {
  const origin: Origin = { kind: 'external', module: 'memory', path: [] };
  const nodes: ModelNode[] = [];
  const containment = new Map<NodeId, readonly NodeId[]>();
  const name = (decoded: string): NodeId => {
    const id = createNodeId();
    nodes.push({ id, kind: 'name', origin, decoded });
    return id;
  };
  function parameter(text: string, type: string): NodeId {
    const id = createNodeId(), typeId = createNodeId(), referenceId = createNodeId();
    const nameId = name(text), typeNameId = name(type);
    nodes.push({ id: referenceId, kind: 'reference', origin, segments: [typeNameId] },
      { id: typeId, kind: 'named-type', origin, reference: referenceId, arguments: [] },
      { id, kind: 'parameter', origin, name: nameId, declaredType: typeId, hasDefault: false });
    containment.set(id, [nameId, typeId]);
    containment.set(typeId, [referenceId]);
    containment.set(referenceId, [typeNameId]);
    return id;
  }
  const capabilityId = createNodeId(), nameId = name('save');
  const parameters = [parameter('left', 'Number'), parameter('right', 'Text')];
  const capability: ModelNode<'capability'> = { id: capabilityId, kind: 'capability', origin, name: nameId, parameters, body: { kind: 'absent' } };
  containment.set(capabilityId, [nameId, ...parameters]);
  function ordered(id: NodeId): ModelNode[] {
    return [nodes.find(node => node.id === id)!, ...(containment.get(id) ?? []).flatMap(ordered)];
  }
  nodes.push(capability);
  return new MemoryContract(ordered(capabilityId), containment);
}

function sourceContract(): Model {
  const result = new LangiumReader().read({ sourceId: 'store.expec', text: 'concept Store { capability save(left: Number, right: Text) }' });
  if (result.status !== 'accepted') throw new Error(JSON.stringify(result.diagnostics));
  return new LangiumModel('store', result.document);
}

function observeCapability(inspection: Inspection): unknown {
  const capability = [...inspection.query('capability')][0]!;
  return { name: capability.name, parameters: capability.parameters.map(parameter => ({ name: parameter.name,
    type: parameter.declaredType.kind === 'named-type' ? parameter.declaredType.reference.segments : undefined })) };
}

function expectCheckedViews(model: Model): void {
  const inspection: Inspection = new QueryInspection(model);
  const capability = [...inspection.query('capability')][0]!;
  expect(inspection.read(capability.id, 'capability').id).toBe(capability.id);
  expect(inspection.read(capability.parameters[0]!.id, 'parameter').id).toBe(capability.parameters[0]!.id);
  expect(() => inspection.read(capability.id, 'parameter')).toThrowError(expect.objectContaining({
    code: 'unexpected-kind', nodeId: capability.id, expectedKind: 'parameter', actualKind: 'capability',
  }));
  expect(() => inspection.read(createNodeId())).toThrowError(expect.objectContaining({ code: 'foreign-node' }));
  expect(() => inspection.read({} as NodeId)).toThrowError(expect.objectContaining({ code: 'missing-node' }));
}

describe('readable inspection composes with an independent model', () => {
  it('answers the same capability question using generated source and independently supplied facts', () => {
    const expected = { name: 'save', parameters: [{ name: 'left', type: ['Number'] }, { name: 'right', type: ['Text'] }] };

    expect(observeCapability(new QueryInspection(sourceContract()))).toEqual(expected);
    expect(observeCapability(new QueryInspection(suppliedContract()))).toEqual(expected);
  });

  it('preserves checked identity and kind access with either model implementation', () => {
    expectCheckedViews(sourceContract());
    expectCheckedViews(suppliedContract());
  });

  it('obtains capabilities from the selected index without walking unrelated declarations', () => {
    const model = suppliedContract();
    const restricted = new Proxy(model, {
      get(target, property) {
        if (property === 'roots' || property === 'children') throw new Error('Capability queries must use the matching index.');
        if (property === 'nodes') return (kind: NodeKind) => {
          if (kind !== 'capability') throw new Error(`Unexpected ${kind} scan during a capability query.`);
          return target.nodes(kind);
        };
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    expect(observeCapability(new QueryInspection(restricted))).toEqual({ name: 'save', parameters: [
      { name: 'left', type: ['Number'] }, { name: 'right', type: ['Text'] },
    ] });
  });

  it('gives two models from the same accepted document separate identity domains', () => {
    const read = new LangiumReader().read({ sourceId: 'store.expec', text: 'concept Store { capability save() }' });
    if (read.status !== 'accepted') throw new Error('Expected an accepted source document');
    const first = new QueryInspection(new LangiumModel('store', read.document));
    const second = new QueryInspection(new LangiumModel('store', read.document));
    const original = [...first.query('capability')][0]!;
    const independent = [...second.query('capability')][0]!;

    expect(original.name).toBe('save');
    expect(independent.name).toBe('save');
    expect(original.id).not.toBe(independent.id);
    expect(() => second.read(original.id)).toThrowError(expect.objectContaining({ code: 'foreign-node' }));
    expect(first.read(original.id).id).toBe(original.id);
  });

  it('allocates fresh opaque identities recognized across independently supplied models', () => {
    const first = createNodeId(), second = createNodeId();

    expect(isNodeId(first)).toBe(true);
    expect(isNodeId(second)).toBe(true);
    expect(first).not.toBe(second);
    expect(isNodeId({})).toBe(false);
    expect(isNodeId(undefined)).toBe(false);
    expect(isNodeId('source:1')).toBe(false);
  });
});
