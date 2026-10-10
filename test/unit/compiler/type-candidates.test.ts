import { it } from 'vitest';
import { ContextualTypeCandidates } from '../../dsl/compiler/type-candidates.js';

it('rejects a foreign captured reference identity', () => {
  const types = new ContextualTypeCandidates();
  types.sourceIs('type Book {}\nfunction read(value: Book)'); types.resolveDeclarations();
  types.expectForeignReferenceQueryError('type Other {}\nfunction read(value: Other)', 'foreign-node');
});
it('rejects a known reference in a supplied module that was never reached', () => {
  const types = new ContextualTypeCandidates();
  types.sourceIs('type Book {}\nfunction read(value: Book)');
  types.sourceModuleIs('unused', 'type Hidden {}\nfunction read(value: Hidden)');
  types.resolveDeclarations();
  types.expectUnreachedModuleReferenceQueryError('unused', ['Hidden'], 'not-analyzed');
});
it('rejects a real reference in a raw model without prepared resolution evidence', () => {
  const types = new ContextualTypeCandidates();
  types.expectUnpreparedReferenceQueryError('type Book {}\nfunction read(value: Book)', ['Book'], 'not-analyzed');
});
it('does not borrow the former resolution scope after its model is substituted', () => {
  const types = new ContextualTypeCandidates();
  types.sourceIs('type Book {}\nfunction read(value: Book)'); types.resolveDeclarations();
  types.expectSubstitutedModelReferenceQueryError('type Other {}\nfunction read(value: Other)', ['Other'], 'not-analyzed');
});
it('rejects an actual declaration identity instead of treating it as a reference', () => {
  const types = new ContextualTypeCandidates();
  types.sourceIs('type Book {}\nfunction read(value: Book)'); types.resolveDeclarations();
  types.expectDeclarationQueryError('Book', 'record-type-declaration', 'unexpected-kind');
});
it('rejects a nonissued identity with the existing missing-node code', () => {
  const types = new ContextualTypeCandidates();
  types.sourceIs('type Book {}\nfunction read(value: Book)'); types.resolveDeclarations();
  types.expectNonissuedReferenceQueryError('missing-node'); // actual {} cast at this runtime-input boundary
});
it('rejects a bound type-looking value reference outside a type position', () => {
  const types = new ContextualTypeCandidates();
  types.sourceIs('type Book {}\nfunction read() { requires Book }'); types.resolveDeclarations();
  types.expectReferenceQueryError(['Book'], 'unexpected-kind');
});
it('keeps an explicit external builtin lookup restricted to builtins', () => {
  const types = new ContextualTypeCandidates();
  types.externalEntryIs([{ kind: 'record-type', name: 'Box', fields: [
    { kind: 'field', name: 'body', type: { kind: 'builtin', name: 'Text' } },
  ] }]);
  types.resolveDeclarations(); types.askAtType(['Text']);
  types.expectNames(['Boolean', 'List', 'Nothing', 'Number', 'Text']); types.expectQueryFindings([], []);
});
it('keeps an explicit external module lookup within that module exported types', () => {
  const types = new ContextualTypeCandidates();
  types.externalEntryIs([{ kind: 'record-type', name: 'Box', fields: [
    { kind: 'field', name: 'body', type: { kind: 'named', path: ['Ca'], module: 'shopping' } },
  ] }]);
  types.externalModuleIs('shopping', [
    { kind: 'record-type', name: 'Cart', fields: [] },
    { kind: 'record-type', name: 'Hidden', local: true, fields: [] },
    { kind: 'function', name: 'helper', parameters: [] },
  ]);
  types.resolveDeclarations(); types.askAtType(['Ca']);
  types.expectNames(['Cart']); // no entry Box, local Hidden, helper or implicit builtins
  types.expectCandidate('Cart', 'Cart', { module: 'shopping', name: 'Cart', kind: 'record-type-declaration', externalPath: [0] });
  types.expectQueryFindings([], []);
});
it('keeps an explicit external type-parameter lookup restricted to its owner parameter', () => {
  const types = new ContextualTypeCandidates();
  types.externalEntryIs([{ kind: 'record-type', name: 'Box', typeParameters: ['T'], fields: [
    { kind: 'field', name: 'body', type: { kind: 'parameter', name: 'T' } },
  ] }]);
  types.resolveDeclarations(); types.askAtType(['T']); types.expectNames(['T']);
  types.expectCandidate('T', 'T', { module: 'entry', name: 'T', kind: 'type-parameter', externalPath: [0, 'typeParameters', 0] });
  types.expectQueryFindings([], []);
});
it('refuses an unspellable external name with its actual input location', () => {
  const types = new ContextualTypeCandidates();
  types.externalEntryIs([{ kind: 'record-type', name: 'Bad\nName', fields: [] },
    { kind: 'record-type', name: 'Box', fields: [{ kind: 'field', name: 'body', type: { kind: 'named', path: ['Box'] } }] }]);
  types.resolveDeclarations(); types.askAtType(['Box']);
  types.expectMissingCandidate('Bad\nName');
  types.expectCandidate('Box', 'Box', { module: 'entry', name: 'Box', kind: 'record-type-declaration', externalPath: [1] });
  types.expectExternalQueryProblem('invalid-dependency-input', 'entry', [0, 'name']);
});
