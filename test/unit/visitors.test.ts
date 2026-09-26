import { describe, expect, it } from 'vitest';
import { visit, VisitError, type VisitorContext, type VisitorInput, type VisitorNode } from '../../src/index.js';
import { readForVisit } from '../support/visitor-inspection.js';

function firstConcept(description: VisitorInput): { node: VisitorNode<'concept'>; context: VisitorContext } {
  let first: { node: VisitorNode<'concept'>; context: VisitorContext } | undefined;
  visit(description, { concept(node, context) { first ??= { node, context }; } });
  if (!first) throw new Error('This example requires a concept.');
  return first;
}

function expectVisitError(action: () => unknown, details: object): void {
  let caught: unknown;
  try { action(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(VisitError);
  expect(caught).toMatchObject(details);
  expect((caught as Error).message.length).toBeGreaterThan(0);
}

describe('A visitor caller follows source identifiers', () => {
  it('can read a node without predicting its kind', () => {
    const { node, context } = firstConcept(readForVisit('concept StoreGame {}'));
    expect(context.node(node.payload.name).payload).toEqual({
      kind: 'name', decoded: 'StoreGame', quoted: false,
    });
  });

  it('reports a foreign source identity with the offending identifier', () => {
    const { context } = firstConcept(readForVisit('concept StoreGame {}'));
    const foreign = { sourceId: 'other.expec', ordinal: 1 };
    expectVisitError(() => context.name(foreign), { code: 'foreign-source', nodeId: foreign });
  });

  it('reports the expected and actual kinds instead of returning an untyped payload', () => {
    const { node, context } = firstConcept(readForVisit('concept StoreGame {}'));
    expectVisitError(() => context.node(node.payload.name, 'capability'), {
      code: 'unexpected-kind', nodeId: node.payload.name, expectedKind: 'capability', actualKind: 'name',
    });
  });

  it('reports an absent ordinal as a missing node', () => {
    const { context } = firstConcept(readForVisit('concept StoreGame {}'));
    const absent = { sourceId: 'store.expec', ordinal: 999 };
    expectVisitError(() => context.node(absent), { code: 'missing-node', nodeId: absent });
  });

  it('reports a negative ordinal as a missing node', () => {
    const { context } = firstConcept(readForVisit('concept StoreGame {}'));
    const invalid = { sourceId: 'store.expec', ordinal: -1 };
    expectVisitError(() => context.name(invalid), { code: 'missing-node', nodeId: invalid });
  });

  it('reports a fractional ordinal as a missing node', () => {
    const { context } = firstConcept(readForVisit('concept StoreGame {}'));
    const invalid = { sourceId: 'store.expec', ordinal: 0.5 };
    expectVisitError(() => context.node(invalid), { code: 'missing-node', nodeId: invalid });
  });

  it('applies checked access when reading a name', () => {
    const { node, context } = firstConcept(readForVisit('concept StoreGame {}'));
    expectVisitError(() => context.name(node.id), {
      code: 'unexpected-kind', nodeId: node.id, expectedKind: 'name', actualKind: 'concept',
    });
  });

  it('applies checked access when reading a reference', () => {
    const { node, context } = firstConcept(readForVisit('concept StoreGame {}'));
    expectVisitError(() => context.reference(node.payload.name), {
      code: 'unexpected-kind', nodeId: node.payload.name, expectedKind: 'reference', actualKind: 'name',
    });
  });

  it('reads ordered decoded reference segments without resolving a target', () => {
    const source = readForVisit('type Alias = Missing.`State.Snapshot`');
    const references: Array<readonly string[]> = [];
    visit(source, { 'named-type'(node, context) { references.push(context.reference(node.payload.reference)); } });
    expect(references).toEqual([['Missing', 'State.Snapshot']]);
  });

  it('preserves the original identifier and complete exclusive range', () => {
    const source = readForVisit('concept StoreGame {}');
    const { node } = firstConcept(source);
    expect(node.id).toEqual({ sourceId: 'store.expec', ordinal: 0 });
    expect(node.range).toEqual({
      sourceId: 'store.expec',
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 20, line: 1, column: 21 },
    });
  });

  it('retains Unicode scalar offsets rather than UTF-16 string offsets', () => {
    const { node, context } = firstConcept(readForVisit('concept `🚀Shop` {}'));
    const name = context.node(node.payload.name, 'name');
    expect(name.payload.decoded).toBe('🚀Shop');
    expect(name.range).toEqual({
      sourceId: 'store.expec',
      start: { offset: 8, line: 1, column: 9 },
      end: { offset: 15, line: 1, column: 16 },
    });
  });
});

describe('A caller supplies visitor operations', () => {
  it('accepts an empty registration and an absent kind', () => {
    const source = readForVisit('concept StoreGame {}');
    expect(() => visit(source, {})).not.toThrow();
    let callbacks = 0;
    visit(source, { capability() { callbacks++; } });
    expect(callbacks).toBe(0);
  });

  it('dispatches matching kinds in source order regardless of registration order', () => {
    const source = readForVisit('type Snapshot { value: Text }\nconcept StoreGame { capability save(snapshot: Text) }');
    const facts: string[] = [];
    visit(source, {
      capability(node, context) { facts.push(context.name(node.payload.name)); },
      concept(node, context) { facts.push(context.name(node.payload.name)); },
      'named-type'(node, context) { facts.push(...context.reference(node.payload.reference)); },
      'record-type-declaration'(node, context) { facts.push(context.name(node.payload.name)); },
    });
    expect(facts).toEqual(['Snapshot', 'Text', 'StoreGame', 'save', 'Text']);
  });

  it('propagates the same consumer failure, stops callbacks and permits a fresh visit', () => {
    const source = readForVisit('concept First {}\nconcept Second {}');
    const failure = new Error('Analysis failed');
    const partial: string[] = [];
    let caught: unknown;
    try {
      visit(source, {
        concept(node, context) {
          partial.push(context.name(node.payload.name));
          throw failure;
        },
        name() { partial.push('must not run'); },
      });
    } catch (error) { caught = error; }
    expect(caught).toBe(failure);
    expect(partial).toEqual(['First']);

    const fresh: string[] = [];
    visit(source, { concept(node, context) { fresh.push(context.name(node.payload.name)); } });
    expect(fresh).toEqual(['First', 'Second']);
  });

  it('can compose another independent visit inside a callback', () => {
    const source = readForVisit('concept StoreGame { capability save() }');
    const facts: string[] = [];
    visit(source, {
      concept(node, context) {
        facts.push(context.name(node.payload.name));
        visit(source, { capability(capability, inner) { facts.push(inner.name(capability.payload.name)); } });
      },
      capability(node, context) { facts.push(context.name(node.payload.name)); },
    });
    expect(facts).toEqual(['StoreGame', 'save', 'save']);
  });

  it('can read a deeply frozen reader result without mutating it', () => {
    const source = readForVisit('concept StoreGame { capability save(snapshot: Text) returns Nothing }');
    function freeze(value: unknown): void {
      if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    }
    freeze(source);
    const names: string[] = [];
    visit(source, { capability(node, context) { names.push(context.name(node.payload.name)); } });
    expect(names).toEqual(['save']);
  });
});