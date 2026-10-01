import { describe, it } from 'vitest';
import { ReadableInspection } from '../dsl/readable-inspection.js';

describe('a contract viewer reads declarations without reconstructing them', () => {
  it('reads capability names, inputs and their distinct declaration and name locations', () => {
    const inspection = new ReadableInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability startup(configurations: SystemConfig)
  capability saveGame(snapshot: PlayerStateSnapshot)
}`);

    inspection.expectCapabilityNames(['startup', 'saveGame']);
    inspection.expectCapabilities([
      { name: 'startup', inputs: [{ name: 'configurations', type: ['SystemConfig'] }],
        declarationAt: { line: 2, column: 3 }, nameAt: { line: 2, column: 14 }, nameEndsAt: { line: 2, column: 21 } },
      { name: 'saveGame', inputs: [{ name: 'snapshot', type: ['PlayerStateSnapshot'] }],
        declarationAt: { line: 3, column: 3 }, nameAt: { line: 3, column: 14 }, nameEndsAt: { line: 3, column: 22 } },
    ]);
  });

  it('reads differently named inputs directly in their declared order', () => {
    const inspection = new ReadableInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability merge(left: List<Pair<Number>>, right: List<Pair<Number>>)
}`);

    inspection.expectCapabilityInputs([['left', 'right']]);
  });

  it('retains separate nested type uses and promises across independent analyses', () => {
    const inspection = new ReadableInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability merge(left: List<Pair<Number>>, right: List<Pair<Number>>) {
    promises "A snapshot is saved"
  }
}`);

    inspection.expectPromises([{ text: 'A snapshot is saved', clauseAt: { line: 3, column: 5 }, textAt: { line: 3, column: 14 } }]);
    inspection.expectNamedTypes([
      { name: ['List'], at: { line: 2, column: 26 }, arguments: [['Pair']] },
      { name: ['Pair'], at: { line: 2, column: 31 }, arguments: [['Number']] },
      { name: ['Number'], at: { line: 2, column: 36 }, arguments: [] },
      { name: ['List'], at: { line: 2, column: 53 }, arguments: [['Pair']] },
      { name: ['Pair'], at: { line: 2, column: 58 }, arguments: [['Number']] },
      { name: ['Number'], at: { line: 2, column: 63 }, arguments: [] },
    ]);
    inspection.expectSeparateGenericArguments();
    inspection.expectCapabilityInputs([['left', 'right']]);
    inspection.expectPromises([{ text: 'A snapshot is saved', clauseAt: { line: 3, column: 5 }, textAt: { line: 3, column: 14 } }]);
  });

  it('finds nested capabilities and allows two consumers to interleave and replay a query', () => {
    const inspection = new ReadableInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability startup()
  local concept Storage {
    capability save(snapshot: PlayerStateSnapshot)
  }
}`);

    inspection.expectIndependentCapabilityIterations(['startup', 'save']);
    inspection.expectCapabilityNames(['startup', 'save']);
  });

  it('keeps quoted single names distinct from qualified reference segments', () => {
    const inspection = new ReadableInspection();
    inspection.sourceIs('store.expec', 'concept Store { capability save(first: `Sales.Cart`, second: Sales.Cart) }');

    inspection.expectCapabilities([{ name: 'save', inputs: [
      { name: 'first', type: ['Sales.Cart'] }, { name: 'second', type: ['Sales', 'Cart'] },
    ], declarationAt: { line: 1, column: 17 }, nameAt: { line: 1, column: 28 }, nameEndsAt: { line: 1, column: 32 } }]);
  });

  it('reads the same record contract from source and external definitions with truthful provenance', () => {
    const source = new ReadableInspection();
    source.sourceIs('shopping.expec', 'type Cart { title: Text }');
    const external = new ReadableInspection();
    external.externalContractIs('shopping', [{ kind: 'record-type', name: 'Cart', fields: [
      { kind: 'field', name: 'title', type: { kind: 'builtin', name: 'Text' } },
    ] }]);

    source.expectRecordContract([{ name: 'Cart', fields: [{ name: 'title', type: ['Text'] }] }]);
    external.expectRecordContract([{ name: 'Cart', fields: [{ name: 'title', type: ['Text'] }] }]);
    source.expectSourceField('title', 'shopping.expec', { line: 1, column: 13 });
    external.expectExternalField('title', 'shopping', [0, 'fields', 0]);
  });

  it('distinguishes a known empty record from a type whose internals are opaque', () => {
    const inspection = new ReadableInspection();
    inspection.externalContractIs('shopping', [
      { kind: 'record-type', name: 'EmptyCart', fields: [] },
      { kind: 'opaque-type', name: 'CartToken' },
    ]);

    inspection.expectRecordContract([{ name: 'EmptyCart', fields: [] }]);
    inspection.expectOpaqueTypes(['CartToken']);
  });

  it('distinguishes absent source bodies from unavailable external bodies and default expressions', () => {
    const source = new ReadableInspection();
    source.sourceIs('store.expec', 'concept Store { capability save(count: Number = 1e2) }');
    const external = new ReadableInspection();
    external.externalContractIs('store', [{ kind: 'concept', name: 'Store', public: ['save'], members: [
      { kind: 'capability', name: 'save', parameters: [{ name: 'count', type: { kind: 'builtin', name: 'Number' }, hasDefault: true }] },
    ] }]);

    source.expectCapabilityBody('absent');
    external.expectCapabilityBody('unavailable');
    source.expectInputDefault('count', true, { kind: 'number-literal', token: '1e2' });
    external.expectInputDefault('count', true, undefined);
  });

  it('captures supplied source before the argument is changed and read again', () => {
    const inspection = new ReadableInspection();
    inspection.sourceIs('store.expec', 'concept Store { capability save() }');
    inspection.expectCapabilityNames(['save']);

    inspection.replaceSourceArgument('concept Store { capability discard() }');

    inspection.expectCapabilityNames(['save']);
  });

  it('captures supplied external definitions before their arrays and fields change', () => {
    const inspection = new ReadableInspection();
    const field = { kind: 'field' as const, name: 'title', type: { kind: 'builtin' as const, name: 'Text' as const } };
    const fields = [field];
    inspection.externalContractIs('shopping', [{ kind: 'record-type', name: 'Cart', fields }]);

    field.name = 'renamed';
    fields.length = 0;

    inspection.expectRecordContract([{ name: 'Cart', fields: [{ name: 'title', type: ['Text'] }] }]);
    inspection.expectExternalField('title', 'shopping', [0, 'fields', 0]);
  });

  it('preserves an authored alias while resolution adds its target and nested failures', () => {
    const store = new ReadableInspection();
    store.sourceIs('store.expec', 'use Cart as Basket from "shopping"\nfunction save(cart: Basket) returns Nothing', 'store');
    const shopping = new ReadableInspection();
    shopping.sourceIs('shopping.expec', 'type Cart { item: Item }', 'shopping');
    store.expectOriginalReferenceUnanalyzed(['Basket']);

    store.resolveWith(shopping);

    store.expectResolvedReference(['Basket'], 'Cart', 'shopping');
    store.expectInvalidReference(['Item'], 'unresolved-reference');
    store.expectOriginalReferenceUnanalyzed(['Basket']);
  });

  it('retains scalar positions with a BOM, astral quoted name, CRLF and tab in one source', () => {
    const inspection = new ReadableInspection();
    inspection.sourceIs('unicode.expec', '\uFEFFtype `📚` {\r\n\tlabel: Text\r\n}');

    inspection.expectQuotedRecordName('📚', 'unicode.expec',
      { offset: 6, line: 1, column: 7 }, { offset: 9, line: 1, column: 10 });
    inspection.expectSourceField('label', 'unicode.expec', { offset: 14, line: 2, column: 2 });
  });

  it('rejects an incomplete declaration even if parser recovery can produce a node', () => {
    const inspection = new ReadableInspection();
    inspection.sourceIs('store.expec', 'concept StoreGame {');

    inspection.expectSyntaxRejection('store.expec');
  });

  it('requires line boundaries between record fields', () => {
    const inspection = new ReadableInspection();
    inspection.sourceIs('shopping.expec', 'type Cart { count: Number label: Text }');

    inspection.expectSyntaxRejection('shopping.expec');
  });

  it('rejects unsupported semicolon separators', () => {
    const inspection = new ReadableInspection();
    inspection.sourceIs('shopping.expec', 'type Cart { count: Number; label: Text }');

    inspection.expectSyntaxRejection('shopping.expec');
  });

  it('rejects a comparison split across ungrouped lines', () => {
    const inspection = new ReadableInspection();
    inspection.sourceIs('store.expec', 'function save() { requires 1 <\n2 }');

    inspection.expectSyntaxRejection('store.expec');
  });

  it('accepts line breaks within grouped expressions and parameter collections', () => {
    const inspection = new ReadableInspection();
    inspection.sourceIs('store.expec', `function save(
  left: List<
    Number
  >,
) {
  requires (1 <
2)
}`);

    inspection.expectAccepted();
  });
});
