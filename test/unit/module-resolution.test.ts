import { describe, expect, it } from 'vitest';
import { name, written } from '../driver/resolution-model.js';
import { LangiumReader } from '../../src/language/langium/reader.js';
import { LangiumModel, ExternalModel, ExternalInputError, type Model, type ModuleModel,
  type ExternalDefinition, type ModelNode } from '../../src/index.js';
import { Resolver } from '../../src/compiler/resolution.js';
import type { Resolution } from '../../src/compiler/resolution.js';

function authored(text: string, locator = 'entry'): ModuleModel {
  const read = new LangiumReader().read({ sourceId: `${locator}.expec`, text });
  if (read.status !== 'accepted') throw new Error(JSON.stringify(read.diagnostics));
  return new LangiumModel(locator, read.document);
}
const record = (name: string): ExternalDefinition => ({ kind: 'record-type', name, fields: [] });
function reference(view: Model, name: string, occurrence = 0): ModelNode<'reference'> {
  const found = [...view.nodes('reference')].filter(node => written(view, node.id).join('.') === name)[occurrence];
  if (!found) throw new Error(`Expected the ${name} reference occurrence ${occurrence}`);
  return found;
}
function target(view: Resolution, occurrence: ModelNode<'reference'>): ModelNode {
  const state = view.model.resolution(occurrence.id);
  expect(state.status, `Resolution of ${written(view.model, occurrence.id).join('.')}`).toBe('bound');
  if (state.status !== 'bound') throw new Error('Expected a bound declaration');
  return view.model.node(state.target);
}
function invalidCodes(view: Resolution, occurrence: ModelNode<'reference'>): string[] {
  const state = view.model.resolution(occurrence.id);
  expect(state.status).toBe('invalid');
  if (state.status !== 'invalid') throw new Error('Expected an invalid reference');
  return state.problems.map(problem => problem.code);
}
function resolve(entry: ModuleModel, modules: readonly ModuleModel[]): Resolution {
  return new Resolver().resolve(entry, { modules, packages: [] });
}

describe('a caller resolves imports from common module definitions', () => {
  it('preserves one declaration identity through two imported aliases', () => {
    const shopping = new ExternalModel('shopping', [record('Cart'), record('Unused')]);
    const entry = authored('use Cart as Basket, Cart as OtherBasket from "shopping"');
    const result = resolve(entry, [shopping]);
    const imports = [...entry.nodes('reference')];
    const cart = target(result, imports[0]!);
    expect(target(result, imports[1]!).id).toBe(cart.id);
    expect(cart.id).toBe([...shopping.nodes('record-type-declaration')][0]!.id);
    expect(cart.origin).toEqual({ kind: 'external', module: 'shopping', path: [0] });
    expect([...result.model.nodes('record-type-declaration')].map(node => name(result.model, node.name))).toEqual(['Cart', 'Unused']);
  });

  it('keeps a quoted dot distinct from a qualified declaration path', () => {
    const shopping = new ExternalModel('shopping', [record('Sales.Cart'), {
      kind: 'concept', name: 'Sales', public: [], members: [record('Cart')],
    }]);
    const entry = authored('use `Sales.Cart` as LiteralCart, Sales.Cart as QualifiedCart from "shopping"');
    const result = resolve(entry, [shopping]);
    const imports = [...entry.nodes('reference')];
    expect(target(result, imports[0]!).id).not.toBe(target(result, imports[1]!).id);
    expect(written(result.model, imports[0]!.id)).toEqual(['Sales.Cart']);
    expect(written(result.model, imports[1]!.id)).toEqual(['Sales', 'Cart']);
  });

  it('preserves nested ownership and lets a public capability identify its real member', () => {
    const shopping = new ExternalModel('shopping', [{ kind: 'concept', name: 'Cart', public: ['save'], members: [
      { kind: 'capability', name: 'save', parameters: [] },
    ] }]);
    const entry = authored('use Cart from "shopping"');
    const result = resolve(entry, [shopping]);
    const cart = target(result, reference(entry, 'Cart'));
    if (cart.kind !== 'concept') throw new Error('Expected Cart concept');
    const save = target(result, reference(shopping, 'save'));
    expect(save.kind).toBe('capability');
    expect(cart.members).toContain(save.id);
  });

  it('keeps a record identity when its actual field type is missing', () => {
    const results = new ExternalModel('results', [{ kind: 'record-type', name: 'ValidationResult', fields: [
      { kind: 'field', name: 'messages', type: { kind: 'named', path: ['MissingType'] } },
    ] }]);
    const entry = authored('use ValidationResult from "results"');
    const result = resolve(entry, [results]);
    expect(target(result, reference(entry, 'ValidationResult')).kind).toBe('record-type-declaration');
    expect(invalidCodes(result, reference(results, 'MissingType'))).toEqual(['unresolved-reference']);
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'unresolved-reference', at: {
      kind: 'external', module: 'results', path: [0, 'fields', 0, 'type'],
    } }));
  });

  it('follows a transitive module reference to the same actual declaration handle', () => {
    const results = new ExternalModel('results', [{ kind: 'alias-type', name: 'ValidationResult', target: {
      kind: 'named', path: ['Message'], module: 'messages',
    } }]);
    const messages = new ExternalModel('messages', [{ kind: 'record-type', name: 'Message', fields: [
      { kind: 'field', name: 'body', type: { kind: 'builtin', name: 'Text' } },
    ] }]);
    const result = resolve(authored('use ValidationResult from "results"'), [results, messages]);
    expect(target(result, reference(results, 'Message')).id).toBe([...messages.nodes('record-type-declaration')][0]!.id);
    expect(target(result, reference(messages, 'Text')).kind).toBe('builtin-type');
    expect(result.problems).toEqual([]);
  });

  it('locates an absent transitive module at the reference that needs it', () => {
    const results = new ExternalModel('results', [{ kind: 'alias-type', name: 'ValidationResult', target: {
      kind: 'named', path: ['Message'], module: 'messages',
    } }]);
    const messages = new ExternalModel('messages', [{ kind: 'alias-type', name: 'Message', target: {
      kind: 'named', path: ['Body'], module: 'text',
    } }]);
    const entry = authored('use ValidationResult from "results"');
    const result = resolve(entry, [results, messages]);
    expect(target(result, reference(entry, 'ValidationResult')).kind).toBe('alias-type-declaration');
    expect(target(result, reference(results, 'Message')).kind).toBe('alias-type-declaration');
    expect(invalidCodes(result, reference(messages, 'Body'))).toEqual(['unavailable-module']);
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'unavailable-module', at: {
      kind: 'external', module: 'messages', path: [0, 'target'],
    } }));
  });

  it('binds declaration reference cycles without expanding aliases or duplicating them', () => {
    const first = new ExternalModel('a', [{ kind: 'alias-type', name: 'First', target: { kind: 'named', path: ['Second'], module: 'b' } }]);
    const second = new ExternalModel('b', [{ kind: 'alias-type', name: 'Second', target: { kind: 'named', path: ['First'], module: 'a' } }]);
    const result = resolve(authored('use First from "a"'), [first, second]);
    expect(target(result, reference(first, 'Second')).id).toBe([...second.nodes('alias-type-declaration')][0]!.id);
    expect(target(result, reference(second, 'First')).id).toBe([...first.nodes('alias-type-declaration')][0]!.id);
    expect([...result.model.nodes('alias-type-declaration')].map(node => name(result.model, node.name))).toEqual(['First', 'Second']);
    expect(result.problems).toEqual([]);
  });

  it('rejects a qualified descendant of a local declaration', () => {
    const shopping = new ExternalModel('shopping', [{ kind: 'concept', name: 'Hidden', public: [], local: true, members: [record('Cart')] }]);
    const entry = authored('use Hidden.Cart from "shopping"');
    const result = resolve(entry, [shopping]);
    expect(invalidCodes(result, reference(entry, 'Hidden.Cart'))).toContain('inaccessible-reference');
  });

  it('rejects owner metadata because nesting supplies actual containment', () => {
    const input = [{ kind: 'record-type', name: 'Cart', fields: [], owner: 'Missing' }] as unknown as ExternalDefinition[];
    expect(() => new ExternalModel('shopping', input)).toThrowError(expect.objectContaining({ code: 'invalid-dependency-input',
      problems: [expect.objectContaining({ at: { kind: 'external', module: 'shopping', path: [0, 'owner'] } })],
    }));
  });

  it('rejects containment cycles at the input boundary while ordinary named cycles remain legal', () => {
    const concept: Record<string, unknown> = { kind: 'concept', name: 'Loop', public: [] };
    concept.members = [concept];
    expect(() => new ExternalModel('shopping', [concept] as unknown as ExternalDefinition[])).toThrow(ExternalInputError);
  });

  it('reports both duplicate module introductions without choosing a winner', () => {
    const modules = [new ExternalModel('shopping', [record('Cart')]), new ExternalModel('shopping', [record('Cart')])];
    const entry = authored('use Cart from "shopping"');
    const result = resolve(entry, modules);
    expect(invalidCodes(result, reference(entry, 'Cart'))).toContain('invalid-dependency-input');
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'invalid-dependency-input',
      at: { kind: 'dependency', path: ['modules', 1, 'locator'] }, related: [{ kind: 'dependency', path: ['modules', 0, 'locator'] }],
    }));
  });

  it('reports duplicate names at both declarations and rejects their import', () => {
    const shopping = new ExternalModel('shopping', [record('Cart'), record('Cart')]);
    const entry = authored('use Cart from "shopping"');
    const result = resolve(entry, [shopping]);
    expect(invalidCodes(result, reference(entry, 'Cart'))).toContain('duplicate-declaration');
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'duplicate-declaration',
      at: { kind: 'external', module: 'shopping', path: [1] }, related: [{ kind: 'external', module: 'shopping', path: [0] }],
    }));
  });

  it('requires a nonempty reference path and an actual named definition', () => {
    expect(() => new ExternalModel('shopping', [{ kind: 'alias-type', name: 'Cart', target: { kind: 'named', path: [] } }]))
      .toThrow(ExternalInputError);
    const entry = authored('use Cart from "shopping"');
    const result = resolve(entry, [new ExternalModel('shopping', [])]);
    expect(invalidCodes(result, reference(entry, 'Cart'))).toEqual(['unresolved-reference']);
  });

  it('distinguishes an unavailable module from an unavailable name within an available module', () => {
    const shopping = new ExternalModel('shopping', [record('Cart')]);
    const missingModule = authored('use Cart from "missing"');
    const missingName = authored('use Receipt from "shopping"');
    expect(invalidCodes(resolve(missingModule, [shopping]), reference(missingModule, 'Cart'))).toEqual(['unavailable-module']);
    expect(invalidCodes(resolve(missingName, [shopping]), reference(missingName, 'Receipt'))).toEqual(['unresolved-reference']);
  });

  it('keeps a valid imported sibling usable when another imported name is missing', () => {
    const results = new ExternalModel('results', [record('Valid')]);
    const entry = authored('use Valid, Bad from "results"');
    const result = resolve(entry, [results]);
    expect(target(result, reference(entry, 'Valid')).kind).toBe('record-type-declaration');
    expect(invalidCodes(result, reference(entry, 'Bad'))).toEqual(['unresolved-reference']);
  });

  it('locates conflicting transitive declarations without erasing their owning alias', () => {
    const results = new ExternalModel('results', [{ kind: 'alias-type', name: 'ValidationResult', target: { kind: 'named', path: ['Message'], module: 'messages' } }]);
    const messages = new ExternalModel('messages', [record('Message'), record('Message')]);
    const entry = authored('use ValidationResult from "results"');
    const result = resolve(entry, [results, messages]);
    expect(target(result, reference(entry, 'ValidationResult')).kind).toBe('alias-type-declaration');
    expect(invalidCodes(result, reference(results, 'Message'))).toContain('duplicate-declaration');
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'duplicate-declaration', at: {
      kind: 'external', module: 'messages', path: [1],
    } }));
  });
});

describe('independent module resolution calls', () => {
  it('does not retain removed modules or mutate an earlier completed view', () => {
    const shopping = new ExternalModel('shopping', [record('Cart')]);
    const entry = authored('use Cart from "shopping"');
    const resolver = new Resolver();
    const first = resolver.resolve(entry, { modules: [shopping], packages: [] });
    const next = resolver.resolve(entry, { modules: [], packages: [] });
    expect(target(first, reference(entry, 'Cart')).kind).toBe('record-type-declaration');
    expect(invalidCodes(next, reference(entry, 'Cart'))).toEqual(['unavailable-module']);
    expect(entry.resolution(reference(entry, 'Cart').id)).toEqual({ status: 'not-analyzed' });
  });

  it('keeps selected module scopes independent across calls with the same supplied inventory', () => {
    const modules = [new ExternalModel('shopping', [record('Cart')]), new ExternalModel('shipping', [record('Receipt')])];
    const resolver = new Resolver();
    const shopping = resolver.resolve(authored('use Cart from "shopping"'), { modules, packages: [] });
    const shipping = resolver.resolve(authored('use Receipt from "shipping"'), { modules, packages: [] });
    const empty = resolver.resolve(authored(''), { modules, packages: [] });
    expect([...shopping.model.nodes('record-type-declaration')].map(node => name(shopping.model, node.name))).toEqual(['Cart']);
    expect([...shipping.model.nodes('record-type-declaration')].map(node => name(shipping.model, node.name))).toEqual(['Receipt']);
    expect([...empty.model.nodes('record-type-declaration')]).toEqual([]);
  });

  it('keeps a reached module inventory stable even when later queries fail', () => {
    const shopping = new ExternalModel('shopping', [record('Cart'), record('Unused')]);
    const entry = authored('use Cart, Missing from "shopping"');
    const before = [...shopping.nodes('record-type-declaration')];
    const result = resolve(entry, [shopping]);
    expect(target(result, reference(entry, 'Cart')).id).toBe(before[0]!.id);
    expect(invalidCodes(result, reference(entry, 'Missing'))).toEqual(['unresolved-reference']);
    expect([...shopping.nodes('record-type-declaration')]).toEqual(before);
    expect([...result.model.nodes('record-type-declaration')].map(node => name(result.model, node.name))).toEqual(['Cart', 'Unused']);
  });
});
