import { describe, expect, it } from 'vitest';
import { createNodeId, type ModelNode, type NodeId, type Origin } from '../../src/index.js';
import { IndexedModel } from '../../src/model-index.js';

const origin: Origin = { kind: 'external', module: 'supplied', path: [] };

describe('a model caller reads indexed structure', () => {
  it('looks up one kind without inspecting unrelated node kinds after construction', () => {
    const nameId = createNodeId(), capabilityId = createNodeId();
    const name: ModelNode<'name'> = { id: nameId, kind: 'name', origin, decoded: 'save' };
    const capability: ModelNode<'capability'> = { id: capabilityId, kind: 'capability', failures: [], origin,
      name: nameId, parameters: [], body: { kind: 'absent' } };
    let constructing = true;
    const unrelated: ModelNode<'string-literal'> = {
      id: createNodeId(), origin, value: 'a prose observation',
      get kind(): 'string-literal' {
        if (!constructing) throw new Error('The requested kind was already indexed; unrelated nodes must not be scanned.');
        return 'string-literal';
      },
    };
    const model = new IndexedModel([capabilityId, unrelated.id], [capability, name, unrelated]);
    constructing = false;

    expect(model.nodes('capability').map(node => node.id)).toEqual([capabilityId]);
    expect(model.nodes('capability').map(node => node.id)).toEqual([capabilityId]);
    expect(model.nodes('record-type-declaration')).toEqual([]);
  });

  it('distinguishes valid roots from unknown identities when following containment', () => {
    const nameId = createNodeId(), capabilityId = createNodeId();
    const model = new IndexedModel([capabilityId], [
      { id: capabilityId, kind: 'capability', failures: [], origin, name: nameId, parameters: [], body: { kind: 'absent' } },
      { id: nameId, kind: 'name', origin, decoded: 'save' },
    ]);

    expect(model.roots()).toEqual([capabilityId]);
    expect(model.parent(capabilityId)).toBeUndefined();
    expect(model.children(capabilityId)).toEqual([nameId]);
    expect(model.parent(nameId)).toBe(capabilityId);
    expect(model.children(nameId)).toEqual([]);
    expect(() => model.parent(createNodeId())).toThrowError(expect.objectContaining({ code: 'foreign-node' }));
    expect(() => model.children({} as NodeId)).toThrowError(expect.objectContaining({ code: 'missing-node' }));
  });

  it('keeps resolution targets separate from authored containment', () => {
    const referenceId = createNodeId(), nameId = createNodeId(), targetId = createNodeId(), targetNameId = createNodeId();
    const model = new IndexedModel([referenceId, targetId], [
      { id: referenceId, kind: 'reference', origin, segments: [nameId] },
      { id: nameId, kind: 'name', origin, decoded: 'Cart' },
      { id: targetId, kind: 'record-type-declaration', error: false, origin, name: targetNameId, fields: [], typeParameters: [] },
      { id: targetNameId, kind: 'name', origin, decoded: 'Cart' },
    ], new Map([[referenceId, { status: 'bound', target: targetId }]]));

    expect(model.resolution(referenceId)).toEqual({ status: 'bound', target: targetId });
    expect(model.children(referenceId)).toEqual([nameId]);
    expect(model.parent(targetId)).toBeUndefined();
    expect(() => model.resolution(targetId)).toThrowError(expect.objectContaining({ code: 'unexpected-kind', expectedKind: 'reference' }));
  });
});
