import { describe, expect, it } from 'vitest';
import { AntlrSyntaxReader } from '../../src/grammar/reader.js';
import { DescriptionInspection, InspectionError, type ModuleInspection, type InspectionNode } from '../../src/index.js';
import { Resolver } from '../../src/resolution.js';

function module(locator: string, text: string): ModuleInspection {
  const read = new AntlrSyntaxReader().read({ sourceId: `${locator}.expec`, text });
  if (read.status !== 'accepted') throw new Error('Expected grammatical module input');
  return new DescriptionInspection(locator, read.description);
}
function reference(view: ModuleInspection, name: string): InspectionNode<'reference'> {
  const found = [...view.nodes('reference')].find(node => view.reference(node.id).join('.') === name);
  if (!found) throw new Error(`Expected the declared ${name} reference`);
  return found;
}

describe('resolution enriches a retained inspection', () => {
  it('adds a builtin target to the original reference handle without changing its input', () => {
    const input = module('messages', 'type Message { body: Text }');
    const before = reference(input, 'Text');
    const resolver = new Resolver();

    const result = resolver.resolve(input, { modules: [], packages: [] });
    const after = result.node(before.id, 'reference');

    expect(after.payload.resolution.status).toBe('bound');
    if (after.payload.resolution.status !== 'bound') throw new Error('Expected Text to resolve');
    const target = result.node(after.payload.resolution.target, 'builtin-type');
    expect(result.name(target.payload.name)).toBe('Text');
    expect(target.origin).toEqual({ kind: 'builtin', name: 'Text' });
    expect(input.node(before.id)).toBe(before);
    expect(before.payload.resolution).toEqual({ status: 'not-analyzed' });
    expect(after.origin).toEqual(before.origin);
  });

  it('retains node identity across analyses of the same inspection but rejects an independent read', () => {
    const input = module('messages', 'type Message { body: Text }');
    const original = [...input.nodes('record-type-declaration')][0]!;
    const resolver = new Resolver();
    const first = resolver.resolve(input, { modules: [], packages: [] });
    const second = resolver.resolve(input, { modules: [], packages: [] });
    expect(first.node(original.id).id).toBe(original.id);
    expect(second.node(original.id).id).toBe(original.id);

    const reread = module('messages', 'type Message { body: Text }');
    const independent = resolver.resolve(reread, { modules: [], packages: [] });
    expect(() => independent.node(original.id)).toThrow(InspectionError);
    try { independent.node(original.id); } catch (error) { expect(error).toMatchObject({ code: 'foreign-node' }); }
  });

  it('returns complete facts that do not call the input collaborator during later queries', () => {
    const input = module('messages', 'type Message { body: Text }');
    const ref = reference(input, 'Text');
    let available = true;
    const collaborator = new Proxy(input, {
      get(target, property, receiver) {
        if (!available) throw new Error('The input collaborator is unavailable');
        return Reflect.get(target, property, receiver);
      },
    });
    const result = new Resolver().resolve(collaborator, { modules: [], packages: [] });
    available = false;

    const binding = result.node(ref.id, 'reference').payload.resolution;
    expect(binding.status).toBe('bound');
    if (binding.status !== 'bound') throw new Error('Expected the Text target');
    expect(result.node(binding.target).payload.kind).toBe('builtin-type');
    expect([...result.nodes('record-type-declaration')]).toHaveLength(1);
    expect(result.problems).toEqual([]);
  });

  it('distinguishes a supplied but unreached node from an unrelated inspection handle', () => {
    const input = module('entry', 'type Message {}');
    const unused = module('unused', 'type Receipt { missing: Missing }');
    const unusedNode = [...unused.nodes('record-type-declaration')][0]!;
    const result = new Resolver().resolve(input, { modules: [unused], packages: [] });

    expect(result.problems).toEqual([]);
    expect([...result.nodes('record-type-declaration')].map(node => result.name(node.payload.name))).toEqual(['Message']);
    try { result.node(unusedNode.id); throw new Error('Expected an unanalysed query'); }
    catch (error) { expect(error).toMatchObject({ code: 'not-analyzed' }); }
    expect(unused.node(unusedNode.id)).toBe(unusedNode);
  });
});
