import { expect, it } from 'vitest';
import { LangiumReader } from '../../../src/language/langium/reader.js';
import { LangiumModel, ExternalModel } from '../../../src/index.js';
import { Resolver } from '../../../src/compiler/resolution.js';

it('keeps external provenance relative to its definition input when module inventory order changes', () => {
  const shopping = new ExternalModel('shopping', [{ kind: 'record-type', name: 'Cart', fields: [
    { kind: 'field', name: 'item', type: { kind: 'named', path: ['Missing'] } },
  ] }]);
  const other = new ExternalModel('other', [{ kind: 'opaque-type', name: 'Other' }]);
  const read = new LangiumReader().read({ sourceId: 'provenance.expec', text: 'use Cart from "shopping"' });
  if (read.status !== 'accepted') throw new Error('Expected grammatical import');
  const entry = new LangiumModel('entry', read.document);
  const resolver = new Resolver();
  const first = resolver.resolve(entry, { modules: [shopping, other], packages: [] });
  const reordered = resolver.resolve(entry, { modules: [other, shopping], packages: [] });
  const expected = { kind: 'external', module: 'shopping', path: [0, 'fields', 0, 'type'] };
  expect(first.problems.find(problem => problem.code === 'unresolved-reference')?.at).toEqual(expected);
  expect(reordered.problems.find(problem => problem.code === 'unresolved-reference')?.at).toEqual(expected);
  const cart = [...first.model.nodes('record-type-declaration')][0]!;
  expect(cart.origin).toEqual({ kind: 'external', module: 'shopping', path: [0] });
  const sourceReference = [...entry.nodes('reference')][0]!;
  expect(first.model.node(sourceReference.id).origin).toMatchObject({ kind: 'source', module: 'entry',
    node: { sourceId: 'provenance.expec' }, range: { sourceId: 'provenance.expec', start: { line: 1, column: 5 } },
  });
});
