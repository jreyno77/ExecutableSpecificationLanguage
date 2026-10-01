import { describe, expect, it } from 'vitest';
import { name, written } from '../driver/resolution-model.js';
import { LangiumReader } from '../../src/langium/reader.js';
import { LangiumModel, QueryError, type ModuleModel, type ModelNode } from '../../src/index.js';
import { Resolver } from '../../src/resolution.js';

function module(locator: string, text: string): ModuleModel {
  const read = new LangiumReader().read({ sourceId: `${locator}.expec`, text });
  if (read.status !== 'accepted') throw new Error('Expected grammatical module input');
  return new LangiumModel(locator, read.document);
}
function reference(view: ModuleModel, name: string): ModelNode<'reference'> {
  const found = [...view.nodes('reference')].find(node => written(view, node.id).join('.') === name);
  if (!found) throw new Error(`Expected the declared ${name} reference`);
  return found;
}

describe('resolution enriches a retained model', () => {
  it('adds a builtin target to the original reference handle without changing its input', () => {
    const input = module('messages', 'type Message { body: Text }');
    const before = reference(input, 'Text');
    const resolver = new Resolver();

    const result = resolver.resolve(input, { modules: [], packages: [] });
    const after = result.model.node(before.id, 'reference');

    const binding = result.model.resolution(after.id);
    expect(binding.status).toBe('bound');
    if (binding.status !== 'bound') throw new Error('Expected Text to resolve');
    const target = result.model.node(binding.target, 'builtin-type');
    expect(name(result.model, target.name)).toBe('Text');
    expect(target.origin).toEqual({ kind: 'builtin', name: 'Text' });
    expect(input.node(before.id)).toBe(before);
    expect(input.resolution(before.id)).toEqual({ status: 'not-analyzed' });
    expect(after.origin).toEqual(before.origin);
  });

  it('retains node identity across analyses of the same model but rejects an independent read', () => {
    const input = module('messages', 'type Message { body: Text }');
    const original = [...input.nodes('record-type-declaration')][0]!;
    const resolver = new Resolver();
    const first = resolver.resolve(input, { modules: [], packages: [] });
    const second = resolver.resolve(input, { modules: [], packages: [] });
    expect(first.model.node(original.id).id).toBe(original.id);
    expect(second.model.node(original.id).id).toBe(original.id);

    const reread = module('messages', 'type Message { body: Text }');
    const independent = resolver.resolve(reread, { modules: [], packages: [] });
    expect(() => independent.model.node(original.id)).toThrow(QueryError);
    try { independent.model.node(original.id); } catch (error) { expect(error).toMatchObject({ code: 'foreign-node' }); }
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

    const binding = result.model.resolution(ref.id);
    expect(binding.status).toBe('bound');
    if (binding.status !== 'bound') throw new Error('Expected the Text target');
    expect(result.model.node(binding.target).kind).toBe('builtin-type');
    expect([...result.model.nodes('record-type-declaration')]).toHaveLength(1);
    expect(result.problems).toEqual([]);
  });

  it('distinguishes a supplied but unreached node from an unrelated model handle', () => {
    const input = module('entry', 'type Message {}');
    const unused = module('unused', 'type Receipt { missing: Missing }');
    const unusedNode = [...unused.nodes('record-type-declaration')][0]!;
    const result = new Resolver().resolve(input, { modules: [unused], packages: [] });

    expect(result.problems).toEqual([]);
    expect([...result.model.nodes('record-type-declaration')].map(node => name(result.model, node.name))).toEqual(['Message']);
    try { result.model.node(unusedNode.id); throw new Error('Expected an unanalysed query'); }
    catch (error) { expect(error).toMatchObject({ code: 'not-analyzed' }); }
    expect(unused.node(unusedNode.id)).toBe(unusedNode);
  });
});


describe('resolution captures the structural model boundary', () => {
  it('captures lazy node facts before the supplied model becomes unavailable', () => {
    const input = module('messages', 'type Message { body: Text }');
    const declaration = input.nodes('record-type-declaration')[0]!;
    let available = true;
    const guard = (node: ModelNode): ModelNode => new Proxy(node, {
      get(target, property, receiver) {
        if (!available) throw new Error('The supplied node is unavailable');
        return Reflect.get(target, property, receiver);
      },
    });
    const provider = new Proxy(input, {
      get(target, property, receiver) {
        if (!available) throw new Error('The supplied model is unavailable');
        if (property === 'node') return (...args: Parameters<ModuleModel['node']>) => guard(target.node(...args));
        if (property === 'nodes') return (kind: Parameters<ModuleModel['nodes']>[0]) => target.nodes(kind).map(guard);
        return Reflect.get(target, property, receiver);
      },
    });
    const result = new Resolver().resolve(provider, { modules: [], packages: [] });
    available = false;

    const captured = result.model.node(declaration.id, 'record-type-declaration');
    expect(name(result.model, captured.name)).toBe('Message');
    const field = result.model.node(captured.fields[0]!, 'field');
    expect(name(result.model, field.name)).toBe('body');
    expect(result.problems).toEqual([]);
  });

  it('retains authored containment order when capturing a function and its inputs', () => {
    const input = module('messages', 'function save(body: Text) returns Nothing');
    const callable = input.nodes('function')[0]!;
    const expected = input.children(callable.id);
    expect(expected.map(id => input.node(id).kind)).toEqual(['name', 'parameter', 'named-type']);

    const result = new Resolver().resolve(input, { modules: [], packages: [] });

    expect(result.model.children(callable.id)).toEqual(expected);
    expect(result.model.children(callable.id).map(id => result.model.node(id).kind)).toEqual(['name', 'parameter', 'named-type']);
  });
});
