import { describe, it } from 'vitest';
import type { PackagePhase } from '../../../src/index.js';
import { DeclarationResolution } from '../../dsl/compiler/declaration-resolution.js';

describe('one inspection acquires resolution facts', () => {
  it('keeps an imported alias and adds its actual declaration target', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceModuleIs('shopping', `type Cart { title: Text }
function save(cart: Cart) returns Nothing`);
    resolution.entryIs('store', 'store.expec', `use Cart as Basket from "shopping"
function save(cart: Basket) returns Nothing`);
    resolution.expectRecord('shopping', 'Cart', { title: 'Text' }, false);
    resolution.expectFunction('shopping', 'save', { cart: 'Cart' }, 'Nothing', 'absent', false);
    resolution.expectParameterType('store', 'save', 'cart', { written: ['Basket'], resolution: 'not-analyzed' }, false);

    resolution.resolveDeclarations();

    resolution.expectNoProblems();
    resolution.expectParameterType('store', 'save', 'cart', { written: ['Basket'], target: { module: 'shopping', name: 'Cart' } });
    resolution.expectReferenceTargetsDeclaration('store', ['Basket'], 'shopping', 'record-type-declaration', 'Cart');
    resolution.expectRecord('shopping', 'Cart', { title: 'Text' });
    resolution.expectFunction('shopping', 'save', { cart: 'Cart' }, 'Nothing', 'absent');
    resolution.expectParameterType('shopping', 'save', 'cart', { written: ['Cart'], target: { module: 'shopping', name: 'Cart' } });
    resolution.expectFieldType('shopping', 'Cart', 'title', { written: ['Text'], target: { name: 'Text' } });
    resolution.expectBoundIn('shopping', ['Nothing'], { name: 'Nothing', origin: { kind: 'builtin', name: 'Nothing' } });
    resolution.expectReferenceOrigin('shopping', ['Text'], { kind: 'source', range: { sourceId: 'shopping.expec', start: { line: 1, column: 20 } } });
    resolution.expectParameterType('store', 'save', 'cart', { written: ['Basket'], resolution: 'not-analyzed' }, false);
    resolution.expectInputsUnchanged();
    resolution.expectCompleteReferenceOutcomes();
  });
});
describe('an author connects references to declared identities', () => {
  it('repairs one missing type without hiding a separate missing declaration', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`concept StoreGame {
  capability save(snapshot: PlayerStateSnapshot) returns Nothing
  capability load() returns MissingReceipt
}`);
    resolution.resolveDeclarations();
    resolution.expectInvalid(['PlayerStateSnapshot'], 'unresolved-reference');
    resolution.expectInvalid(['MissingReceipt'], 'unresolved-reference');
    resolution.expectProblem('unresolved-reference', { line: 2, column: 29 });
    resolution.expectProblem('unresolved-reference', { line: 3, column: 29 });
    resolution.expectBound(['Nothing'], { name: 'Nothing', origin: { kind: 'builtin', name: 'Nothing' } });

    resolution.sourceIs(`concept StoreGame {
  capability save(snapshot: PlayerStateSnapshot) returns Nothing
  capability load() returns MissingReceipt
}
type PlayerStateSnapshot { label: Text }`);
    resolution.resolveDeclarations();
    resolution.expectBound(['PlayerStateSnapshot'], { name: 'PlayerStateSnapshot', kind: 'record-type-declaration', origin: { kind: 'source' } });
    resolution.expectBound(['Text'], { name: 'Text', origin: { kind: 'builtin', name: 'Text' } });
    resolution.expectProblemCodes(['unresolved-reference']);
    resolution.expectIndependentObservers(['PlayerStateSnapshot'], 'PlayerStateSnapshot');
    resolution.expectInputsUnchanged();
  });

  it('supplies the fixed builtin names without imports or fabricated source declarations', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`type Message { body: Text
 count: Number
 visible: Boolean
 labels: List<Text> }
function show(item: Message) returns Nothing`);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['Text'], { name: 'Text', kind: 'builtin-type' });
    resolution.expectBound(['Number'], { name: 'Number', kind: 'builtin-type' });
    resolution.expectBound(['Boolean'], { name: 'Boolean', kind: 'builtin-type' });
    resolution.expectBound(['List'], { name: 'List', kind: 'builtin-type' });
    resolution.expectBound(['Nothing'], { name: 'Nothing', kind: 'builtin-type' });
    resolution.expectBuiltinHasNoSource('Text');
    resolution.expectBuiltinHasNoSource('Nothing');
    resolution.expectInputsUnchanged();
  });

  it('rejects a function where an input type is required', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`function PlayerStateSnapshot() returns Nothing
concept StoreGame { capability save(snapshot: PlayerStateSnapshot) }`);
    resolution.resolveDeclarations();
    resolution.expectInvalid(['PlayerStateSnapshot'], 'wrong-reference-kind');
  });

  it('does not invent URL as another builtin', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('type Config { root: URL }');
    resolution.resolveDeclarations();
    resolution.expectInvalid(['URL'], 'unresolved-reference');
  });

  it('requires a public capability to exist under its exact name', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`concept StoreGame {
  public saveGame
  capability save(snapshot: Text) returns Nothing
}`);
    resolution.resolveDeclarations();
    resolution.expectInvalid(['saveGame'], 'unresolved-reference');
    resolution.expectProblem('unresolved-reference', { line: 2, column: 10 });

    resolution.sourceIs(`concept StoreGame {
  public saveGame
  capability saveGame(snapshot: Text) returns Nothing
}`);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['saveGame'], { name: 'saveGame', kind: 'capability' });
    resolution.expectBoundAt(['saveGame'], { line: 3, column: 3 });
  });

  it('does not borrow another owners capability for a public entry', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`concept Storage { capability saveGame() }
concept StoreGame { public saveGame }`);
    resolution.resolveDeclarations();
    resolution.expectInvalid(['saveGame'], 'unresolved-reference');
    resolution.expectDeclaration('saveGame', 'capability', 'Storage');
  });

  it('does not confuse a local type with a public capability', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`concept StoreGame { public saveGame
 local type saveGame { value: Text } }`);
    resolution.resolveDeclarations();
    resolution.expectInvalid(['saveGame'], 'wrong-reference-kind');
  });

  it('reports both repeated public introductions', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`concept StoreGame { public save, save
 capability save() }`);
    resolution.resolveDeclarations();
    resolution.expectProblem('duplicate-declaration', undefined, 1);
  });

  it('rejects two construction declarations for one owner', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`concept StoreGame { construction()
 construction() }`);
    resolution.resolveDeclarations();
    resolution.expectProblem('duplicate-declaration', undefined, 1);
  });
});

describe('an author chooses supplied declarations explicitly', () => {
  it('does not import a name merely because a module is supplied', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('function save(cart: Cart)');
    resolution.externalModuleIs('shopping', [{ kind: 'record-type', name: 'Cart', fields: [] }]);
    resolution.externalModuleIs('shipping', [{ kind: 'record-type', name: 'Cart', fields: [] }]);
    resolution.resolveDeclarations();
    resolution.expectInvalid(['Cart'], 'unresolved-reference');
  });

  it('reports ambiguity between two explicitly selected exports', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart from "shopping"
use Cart from "shipping"
function save(cart: Cart)`);
    resolution.externalModuleIs('shopping', [{ kind: 'record-type', name: 'Cart', fields: [] }]);
    resolution.externalModuleIs('shipping', [{ kind: 'record-type', name: 'Cart', fields: [] }]);
    resolution.resolveDeclarations();
    resolution.expectInvalid(['Cart'], 'ambiguous-reference', 2);
    resolution.expectProblem('ambiguous-reference', undefined, 2);
  });

  it('preserves different module identities through explicit aliases', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart as Basket from "shopping"
use Cart as Shipment from "shipping"
function save(basket: Basket, shipment: Shipment)`);
    resolution.externalModuleIs('shopping', [{ kind: 'record-type', name: 'Cart', fields: [] }]);
    resolution.externalModuleIs('shipping', [{ kind: 'record-type', name: 'Cart', fields: [] }]);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['Basket'], { name: 'Cart', origin: { kind: 'external', module: 'shopping', path: [0] } });
    resolution.expectBound(['Shipment'], { name: 'Cart', origin: { kind: 'external', module: 'shipping', path: [0] } });
    resolution.expectDifferentTargets(['Basket'], ['Shipment']);
  });

  it('keeps two aliases for one export attached to the same declaration', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart as Basket from "shopping"
use Cart as Trolley from "shopping"
function save(first: Basket, second: Trolley)`);
    resolution.externalModuleIs('shopping', [{ kind: 'record-type', name: 'Cart', fields: [] }]);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectSameTargets(['Basket'], ['Trolley']);
  });

  it('rejects a repeated introduction instead of silently merging it', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart from "shopping"
use Cart from "shopping"
function save(cart: Cart)`);
    resolution.externalModuleIs('shopping', [{ kind: 'record-type', name: 'Cart', fields: [] }]);
    resolution.resolveDeclarations();
    resolution.expectProblem('duplicate-declaration', undefined, 1);
  });

  it('reports an imported name colliding with a local declaration', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart from "shopping"
type Cart { count: Number }`);
    resolution.externalModuleIs('shopping', [{ kind: 'record-type', name: 'Cart', fields: [] }]);
    resolution.resolveDeclarations();
    resolution.expectProblem('duplicate-declaration', undefined, 1);
  });

  it('keeps a quoted dotted declaration distinct from a nested declaration path', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use \`Sales.Cart\` as Dotted from "shopping"
use Sales.Cart as Qualified from "shopping"
function save(first: Dotted, second: Qualified)`);
    resolution.externalModuleIs('shopping', [
      { kind: 'record-type', name: 'Sales.Cart', fields: [] },
      { kind: 'concept', name: 'Sales', public: [], members: [
        { kind: 'record-type', name: 'Cart', fields: [] },
      ] },
    ]);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['Dotted'], { name: 'Sales.Cart', origin: { kind: 'external', module: 'shopping', path: [0] } });
    resolution.expectBound(['Qualified'], { name: 'Cart', origin: { kind: 'external', module: 'shopping', path: [1, 'members', 0] } });
    resolution.expectDifferentTargets(['Dotted'], ['Qualified']);
  });

  it('does not select a module-local declaration', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart from "shopping"
function save(cart: Cart)`);
    resolution.externalModuleIs('shopping', [{ kind: 'record-type', name: 'Cart', local: true, fields: [] }]);
    resolution.resolveDeclarations();
    resolution.expectInvalid(['Cart'], 'inaccessible-reference');
  });
});
describe('an author keeps names within their declared scopes', () => {
  it('allows local types inside their owner but rejects qualified escape', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`concept StoreGame {
 local type SessionState { label: Text }
 capability save(snapshot: SessionState)
}
function outside(snapshot: StoreGame.SessionState)`);
    resolution.resolveDeclarations();
    resolution.expectBound(['SessionState'], { name: 'SessionState', kind: 'record-type-declaration' });
    resolution.expectInvalid(['StoreGame', 'SessionState'], 'inaccessible-reference');
    resolution.expectDeclaration('SessionState', 'record-type-declaration', 'StoreGame');
  });

  it('gives each declaring type its own generic parameter identity', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`type Pair<T> = [T, T]
type Page<T> { items: List<T> }
function outside(value: T)`);
    resolution.resolveDeclarations();
    resolution.expectBound(['T'], { name: 'T', kind: 'type-parameter', origin: { kind: 'source' } });
    resolution.expectSameTargets(['T'], ['T'], 0, 1);
    resolution.expectDifferentTargets(['T'], ['T'], 0, 2);
    resolution.expectInvalid(['T'], 'unresolved-reference', 3);
  });

  it('resolves a declaration written after its first use', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`function save(cart: Cart)
type Cart { count: Number }`);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['Cart'], { name: 'Cart', kind: 'record-type-declaration' });
    resolution.expectBoundAt(['Cart'], { line: 2, column: 1 });
  });

  it('reports duplicate type declarations with both source locations', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`type Item { title: Text }
type Item { count: Number }`);
    resolution.resolveDeclarations();
    resolution.expectProblem('duplicate-declaration', undefined, 1);
  });

  it('reports two fields with the same name in one record', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`type Cart { count: Number
 count: Text }`);
    resolution.resolveDeclarations();
    resolution.expectProblem('duplicate-declaration', undefined, 1);
  });

  it('reports two parameters with the same name in one callable', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('function save(value: Number, value: Text)');
    resolution.resolveDeclarations();
    resolution.expectProblem('duplicate-declaration', undefined, 1);
  });

  it('rejects source declarations that replace builtin names', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('type Text { characters: List<Number> }');
    resolution.resolveDeclarations();
    resolution.expectProblem('duplicate-declaration', undefined, 1);
    resolution.expectBuiltinHasNoSource('Text');
  });

  it('permits nested shadowing of a nonbuiltin declaration', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`type Item { title: Text }
concept StoreGame {
 local type Item { count: Number }
 capability save(value: Item)
}
function outside(value: Item)`);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBoundAt(['Item'], { line: 3, column: 8 }, 0);
    resolution.expectBoundAt(['Item'], { line: 1, column: 1 }, 1);
    resolution.expectDifferentTargets(['Item'], ['Item'], 0, 1);
  });
});

describe('a caller supplies actual module contracts', () => {
  it('imports an external record and inspects its declared fields', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use ValidationResult from "results"
function validate(source: Text) returns ValidationResult`);
    resolution.externalModuleIs('results', [{ kind: 'record-type', name: 'ValidationResult', fields: [
      { kind: 'field', name: 'accepted', type: { kind: 'builtin', name: 'Boolean' } },
      { kind: 'field', name: 'messages', type: { kind: 'builtin', name: 'List', arguments: [{ kind: 'builtin', name: 'Text' }] } },
    ] }]);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['ValidationResult'], { name: 'ValidationResult', origin: { kind: 'external', module: 'results', path: [0] } }, 1);
    resolution.expectRecord('results', 'ValidationResult', { accepted: 'Boolean', messages: 'List<Text>' });
    resolution.expectInputsUnchanged();
  });

  it('reports a requested name absent from a real empty module', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use ValidationResult from "results"');
    resolution.sourceModuleIs('results', '');
    resolution.resolveDeclarations();
    resolution.expectInvalid(['ValidationResult'], 'unresolved-reference');
    resolution.expectProblem('unresolved-reference', { line: 1, column: 5 });
  });

  it('keeps an existing external record when one of its field types is missing', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use ValidationResult from "results"');
    resolution.externalModuleIs('results', [{ kind: 'record-type', name: 'ValidationResult', fields: [
      { kind: 'field', name: 'messages', type: { kind: 'named', path: ['MissingMessage'] } },
    ] }]);
    resolution.resolveDeclarations();
    resolution.expectBound(['ValidationResult'], { name: 'ValidationResult', origin: { kind: 'external', module: 'results' } });
    resolution.expectInvalidIn('results', ['MissingMessage'], 'unresolved-reference');
    resolution.expectExternalProblem('unresolved-reference', 'results', [0, 'fields', 0, 'type']);
    resolution.expectRecord('results', 'ValidationResult', { messages: 'MissingMessage' });
  });

  it('follows an explicit external field reference into another supplied module', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use ValidationResult from "results"
function validate() returns ValidationResult`);
    resolution.externalModuleIs('results', [{ kind: 'record-type', name: 'ValidationResult', fields: [
      { kind: 'field', name: 'message', type: { kind: 'named', module: 'messages', path: ['Message'] } },
    ] }]);
    resolution.externalModuleIs('messages', [{ kind: 'record-type', name: 'Message', fields: [] }]);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['ValidationResult'], { name: 'ValidationResult', origin: { kind: 'external', module: 'results' } }, 1);
    resolution.expectFieldType('results', 'ValidationResult', 'message', { written: ['Message'], target: { module: 'messages', name: 'Message' } });
  });

  it('keeps existing declarations when a different field needs an unavailable module', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use ValidationResult from "results"
use Cart from "shopping"
function save(cart: Cart)`);
    resolution.externalModuleIs('results', [{ kind: 'record-type', name: 'ValidationResult', fields: [
      { kind: 'field', name: 'message', type: { kind: 'named', module: 'messages', path: ['Message'] } },
    ] }]);
    resolution.externalModuleIs('shopping', [{ kind: 'record-type', name: 'Cart', fields: [] }]);
    resolution.resolveDeclarations();
    resolution.expectExternalProblem('unavailable-module', 'results', [0, 'fields', 0, 'type']);
    resolution.expectInvalidIn('results', ['Message'], 'unavailable-module');
    resolution.expectBound(['ValidationResult'], { name: 'ValidationResult', origin: { kind: 'external', module: 'results' } });
    resolution.expectBound(['Cart'], { name: 'Cart', origin: { kind: 'external', module: 'shopping' } }, 1);
  });

  it('connects mutually referring records without expanding their field types', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use First from "records"
function save(value: First)`);
    resolution.externalModuleIs('records', [
      { kind: 'record-type', name: 'First', fields: [{ kind: 'field', name: 'next', type: { kind: 'named', path: ['Second'] } }] },
      { kind: 'record-type', name: 'Second', fields: [{ kind: 'field', name: 'previous', type: { kind: 'named', path: ['First'] } }] },
    ]);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['First'], { name: 'First', kind: 'record-type-declaration' }, 1);
    resolution.expectFieldType('records', 'First', 'next', { written: ['Second'], target: { module: 'records', name: 'Second' } });
    resolution.expectFieldType('records', 'Second', 'previous', { written: ['First'], target: { module: 'records', name: 'First' } });
    resolution.expectCompleteReferenceOutcomes();
  });

  it('rejects duplicate module locators instead of choosing a first match', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use Cart from "shopping"');
    resolution.externalModuleIs('shopping', [{ kind: 'record-type', name: 'Cart', fields: [] }]);
    resolution.externalModuleIs('shopping', [{ kind: 'record-type', name: 'Cart', fields: [] }]);
    resolution.resolveDeclarations();
    resolution.expectProblem('invalid-dependency-input');
    resolution.expectInvalid(['Cart'], 'invalid-dependency-input');
  });

  it('rejects duplicate external declarations instead of choosing an export', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use Cart from "shopping"');
    resolution.externalModuleIs('shopping', [
      { kind: 'record-type', name: 'Cart', fields: [] },
      { kind: 'record-type', name: 'Cart', fields: [] },
    ]);
    resolution.resolveDeclarations();
    resolution.expectProblem('duplicate-declaration', undefined, 1);
    resolution.expectInvalid(['Cart'], 'duplicate-declaration');
  });

  it('rejects conflicting source identity in separately supplied modules', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use Cart from "shopping"');
    resolution.sourceModuleIs('shopping', 'type Cart {}', 'same.expec');
    resolution.sourceModuleIs('shipping', 'type Receipt {}', 'same.expec');
    resolution.resolveDeclarations();
    resolution.expectProblem('invalid-dependency-input');
  });

  it('does not let a qualified import bypass an external local declaration', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use StoreGame.SessionState from "store"');
    resolution.externalModuleIs('store', [{ kind: 'concept', name: 'StoreGame', public: [], members: [
      { kind: 'record-type', name: 'SessionState', local: true, fields: [] },
    ] }]);
    resolution.resolveDeclarations();
    resolution.expectInvalid(['StoreGame', 'SessionState'], 'inaccessible-reference');
  });
});
describe('an author declares dependencies without implicitly introducing them', () => {
  it('binds an explicit dependency to its existing declaration', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`type Storage {}
concept StoreGame { depends on Storage }`);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['Storage'], { name: 'Storage', kind: 'record-type-declaration' });
  });

  it('does not create the declaration mentioned by a dependency clause', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('concept StoreGame { depends on Storage }');
    resolution.resolveDeclarations();
    resolution.expectInvalid(['Storage'], 'unresolved-reference');
  });

  it('rejects a function where a dependency requires a concept or type', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`function Storage()
concept StoreGame { depends on Storage }`);
    resolution.resolveDeclarations();
    resolution.expectInvalid(['Storage'], 'wrong-reference-kind');
  });

  it('requires the declared package phase and independently reports another missing package', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`concept StoreGame {
 requires package "vite" for build
 requires package "supabase"
}`);
    resolution.dependenciesAre({ modules: [], packages: [{ alias: 'vite', phases: ['runtime'] }] });
    resolution.resolveDeclarations();
    resolution.expectProblemCodes(['unavailable-package', 'unavailable-package']);
  });

  it('accepts an available unqualified package without inventing its phase', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`concept StoreGame {
 requires package "vite" for build
 requires package "supabase"
}`);
    resolution.dependenciesAre({ modules: [], packages: [
      { alias: 'vite', phases: ['build'] }, { alias: 'supabase', phases: [] },
    ] });
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectDeclaration('StoreGame', 'concept');
    resolution.expectInputsUnchanged();
  });

  it('rejects duplicate configured package aliases', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('concept StoreGame { requires package "vite" }');
    resolution.dependenciesAre({ modules: [], packages: [
      { alias: 'vite', phases: ['build'] }, { alias: 'vite', phases: ['runtime'] },
    ] });
    resolution.resolveDeclarations();
    resolution.expectProblem('invalid-dependency-input');
  });

  it('locates a malformed configured package phase', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('concept StoreGame { requires package "vite" }');
    resolution.dependenciesAre({ modules: [], packages: [
      { alias: 'vite', phases: ['compile' as PackagePhase] },
    ] });
    resolution.resolveDeclarations();
    resolution.expectInputProblemWithin(['packages', 0, 'phases']);
  });
});

describe('a consumer distinguishes resolved facts from pending work', () => {
  it('resolves an unambiguous helper declared after its use', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`examples {
 scenario "prepare" {
  when perform()
  then true
 }
 action perform() returns Nothing
}`);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['perform'], { name: 'perform', kind: 'action' });
  });

  it('defers a receiver-dependent member without inventing its target', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`type Cart {}
function save(cart: Cart) { ensures cart.save() == true }`);
    resolution.resolveDeclarations();
    resolution.expectBound(['Cart'], { name: 'Cart', kind: 'record-type-declaration' });
    resolution.expectDeferred(['save'], 'receiver-type');
  });

  it('leaves contextual result meaning to the contract checker', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('function total() returns Number { ensures result >= 0 }');
    resolution.resolveDeclarations();
    resolution.expectBound(['Number'], { name: 'Number', kind: 'builtin-type' });
    resolution.expectDeferred(['result'], 'contextual-result');
  });

  it('does not bind an outer name when ordered capture scope may replace it', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`examples {
 fixture value: Number = 1
 setup prepare(input: Number) returns Number
 action create() returns Number
 scenario "ordered values" {
  given earlier = prepare(value)
  when value = create()
  then value == 1
 }
}`);
    resolution.resolveDeclarations();
    resolution.expectDeferred(['value'], 'ordered-scope', 0);
    resolution.expectDeferred(['value'], 'ordered-scope', 1);
    resolution.expectBound(['prepare'], { name: 'prepare', kind: 'setup' });
  });

  it('reports inclusion as a composition requirement rather than searching a file', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`include "./types.expec"
function save(value: ImportedType)`);
    resolution.resolveDeclarations();
    resolution.expectProblem('composition-required', { line: 1, column: 1 });
    resolution.expectDeferred(['ImportedType'], 'composition');
    resolution.expectInputsUnchanged();
  });

  it('reports extension as a composition requirement', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('extend StoreGame { capability save() }');
    resolution.resolveDeclarations();
    resolution.expectProblem('composition-required');
    resolution.expectDeferred(['StoreGame'], 'composition');
  });

  it('reports external examples as a composition requirement', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`concept StoreGame {}
examples for StoreGame from "./saving.examples.expec"`);
    resolution.resolveDeclarations();
    resolution.expectProblem('composition-required');
    resolution.expectDeclaration('StoreGame', 'concept');
    resolution.expectInputsUnchanged();
  });

  it('resolves the subject of same-document examples', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`concept StoreGame {}
examples for StoreGame { action save() returns Nothing }`);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['StoreGame'], { name: 'StoreGame', kind: 'concept' });
  });
});

describe('a consumer reads a fresh, checked resolution report', () => {
  it('observes removed dependency input on the same resolver instance', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart from "shopping"
function save(cart: Cart)`);
    resolution.externalModuleIs('shopping', [{ kind: 'record-type', name: 'Cart', fields: [] }]);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['Cart'], { name: 'Cart', origin: { kind: 'external', module: 'shopping' } }, 1);
    const facts = resolution.rememberFacts();

    resolution.resolveDeclarations();
    resolution.expectFactsEqual(facts);
    resolution.expectInputsUnchanged();

    resolution.dependenciesAre({ modules: [], packages: [] });
    resolution.resolveDeclarations();
    resolution.expectProblem('unavailable-module');
    resolution.expectInvalid(['Cart'], 'unavailable-module');
  });

  it('supports independent declaration iteration and checked queries', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`type Cart {}
function save(cart: Cart)`);
    resolution.resolveDeclarations();
    resolution.expectRootDeclarations(['Cart', 'save']);
    resolution.expectDeclarationsReplay();
    resolution.expectBound(['Cart'], { name: 'Cart', kind: 'record-type-declaration' });
    resolution.expectCheckedQueries();
    resolution.expectInputsUnchanged();
  });
});



describe('resolution respects component and lexical boundaries', () => {
  it('binds a fixed parameter reference without deferring it as an ordered local', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`type Cart {}
function save(cart: Cart) { ensures cart.save() == true }`);
    resolution.resolveDeclarations();
    resolution.expectBound(['cart'], { name: 'cart', kind: 'parameter' });
    resolution.expectDeferred(['save'], 'receiver-type');
  });

  it('prevents an import alias from replacing builtin Text', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart as Text from "shopping"
function save(value: Text)`);
    resolution.externalModuleIs('shopping', [{ kind: 'record-type', name: 'Cart', fields: [] }]);
    resolution.resolveDeclarations();
    resolution.expectProblem('duplicate-declaration', undefined, 1);
    resolution.expectBuiltinHasNoSource('Text');
  });

  it('makes a local type visible inside descendants of its owner', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`concept StoreGame {
 local type SessionState { label: Text }
 local concept Screen {
  capability show(state: SessionState)
 }
}`);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['SessionState'], { name: 'SessionState', kind: 'record-type-declaration' });
    resolution.expectDeclaration('SessionState', 'record-type-declaration', 'StoreGame');
  });

  it('reports an absent transitive type without erasing its containing record', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use ValidationResult from "results"');
    resolution.externalModuleIs('results', [{ kind: 'record-type', name: 'ValidationResult', fields: [
      { kind: 'field', name: 'message', type: { kind: 'named', module: 'messages', path: ['Message'] } },
    ] }]);
    resolution.externalModuleIs('messages', [{ kind: 'record-type', name: 'OtherMessage', fields: [] }]);
    resolution.resolveDeclarations();
    resolution.expectExternalProblem('unresolved-reference', 'results', [0, 'fields', 0, 'type']);
    resolution.expectInvalidIn('results', ['Message'], 'unresolved-reference');
    resolution.expectBound(['ValidationResult'], { name: 'ValidationResult', kind: 'record-type-declaration' });
  });
  it('does not introduce construction parameters into capability contracts', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`concept StoreGame {
 construction(configuration: Text)
 capability start() { requires configuration == "live" }
}`);
    resolution.resolveDeclarations();
    resolution.expectInvalid(['configuration'], 'unresolved-reference');
  });

  it('keeps helpers in separate ownerless examples blocks isolated', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`examples { action onlyHere() returns Nothing }
examples {
 scenario "unavailable helper" {
  when onlyHere()
  then true
 }
}`);
    resolution.resolveDeclarations();
    resolution.expectInvalid(['onlyHere'], 'unresolved-reference');
  });

  it('defers message participant and operation selection while retaining their declared types', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`interface Storage { capability persist(snapshot: Text) returns Nothing }
component Screen {}
interaction "save"() {
 participant screen: Screen
 participant storage: Storage
 message screen -> storage.persist("snapshot")
}`);
    resolution.resolveDeclarations();
    resolution.expectBound(['Screen'], { name: 'Screen', kind: 'component' });
    resolution.expectBound(['Storage'], { name: 'Storage', kind: 'interface' });
    resolution.expectDeferred(['screen'], 'interaction');
    resolution.expectDeferred(['storage'], 'interaction');
    resolution.expectDeferred(['persist'], 'interaction');
  });
});






describe('source and external contracts have the same inspection surface', () => {
  it('reads an external contract with the same consumer and follows the same reference links', () => {
    const resolution = new DeclarationResolution();
    resolution.externalModuleIs('shopping', [
      { kind: 'record-type', name: 'Cart', fields: [
        { kind: 'field', name: 'title', type: { kind: 'builtin', name: 'Text' } },
      ] },
      { kind: 'function', name: 'save', parameters: [
        { name: 'cart', type: { kind: 'named', path: ['Cart'] } },
      ], result: { kind: 'builtin', name: 'Nothing' } },
    ]);
    resolution.entryIs('store', 'store.expec', `use Cart as Basket from "shopping"
function save(cart: Basket) returns Nothing`);
    resolution.expectRecord('shopping', 'Cart', { title: 'Text' }, false);
    resolution.expectFunction('shopping', 'save', { cart: 'Cart' }, 'Nothing', 'unavailable', false);
    resolution.expectParameterType('store', 'save', 'cart', { written: ['Basket'], resolution: 'not-analyzed' }, false);

    resolution.resolveDeclarations();

    resolution.expectNoProblems();
    resolution.expectRecord('shopping', 'Cart', { title: 'Text' });
    resolution.expectFunction('shopping', 'save', { cart: 'Cart' }, 'Nothing', 'unavailable');
    resolution.expectParameterType('store', 'save', 'cart', { written: ['Basket'], target: { module: 'shopping', name: 'Cart' } });
    resolution.expectReferenceTargetsDeclaration('store', ['Basket'], 'shopping', 'record-type-declaration', 'Cart');
    resolution.expectParameterType('shopping', 'save', 'cart', { written: ['Cart'], target: { module: 'shopping', name: 'Cart' } });
    resolution.expectFieldType('shopping', 'Cart', 'title', { written: ['Text'], target: { name: 'Text' } });
    resolution.expectBoundIn('shopping', ['Nothing'], { name: 'Nothing', origin: { kind: 'builtin', name: 'Nothing' } });
    resolution.expectOrigin('shopping', 'record-type-declaration', 'Cart', { kind: 'external', module: 'shopping', path: [0] });
    resolution.expectReferenceOrigin('shopping', ['Text'], { kind: 'external', module: 'shopping', path: [0, 'fields', 0, 'type'] });
    resolution.expectParameterType('store', 'save', 'cart', { written: ['Basket'], resolution: 'not-analyzed' }, false);
    resolution.expectInputsUnchanged();
    resolution.expectCompleteReferenceOutcomes();
  });

  it('keeps source Cart available while identifying its missing nested field type', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart as Basket from "shopping"
function save(cart: Basket)`);
    resolution.sourceModuleIs('shopping', 'type Cart { items: List<MissingItem> }');
    resolution.resolveDeclarations();
    resolution.expectBound(['Basket'], { name: 'Cart', kind: 'record-type-declaration' });
    resolution.expectRecord('shopping', 'Cart', { items: 'List<MissingItem>' });
    resolution.expectBoundIn('shopping', ['List'], { name: 'List', kind: 'builtin-type' });
    resolution.expectInvalidIn('shopping', ['MissingItem'], 'unresolved-reference');
    resolution.expectReferenceOrigin('shopping', ['MissingItem'], { kind: 'source', range: { sourceId: 'shopping.expec', start: { line: 1, column: 25 } } });
    resolution.expectProblem('unresolved-reference', { line: 1, column: 25 });
  });

  it('keeps external Cart available while identifying its missing nested field type', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart as Basket from "shopping"
function save(cart: Basket)`);
    resolution.externalModuleIs('shopping', [{ kind: 'record-type', name: 'Cart', fields: [
      { kind: 'field', name: 'items', type: { kind: 'builtin', name: 'List', arguments: [
        { kind: 'named', path: ['MissingItem'] },
      ] } },
    ] }]);
    resolution.resolveDeclarations();
    resolution.expectBound(['Basket'], { name: 'Cart', kind: 'record-type-declaration' });
    resolution.expectRecord('shopping', 'Cart', { items: 'List<MissingItem>' });
    resolution.expectBoundIn('shopping', ['List'], { name: 'List', kind: 'builtin-type' });
    resolution.expectInvalidIn('shopping', ['MissingItem'], 'unresolved-reference');
    resolution.expectExternalProblem('unresolved-reference', 'shopping', [0, 'fields', 0, 'type', 'arguments', 0]);
  });

  it('connects imports to original module nodes instead of creating alias declarations', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart as Basket from "shopping"
use Cart as SavedBasket from "shopping"
function save(first: Basket, second: SavedBasket)`);
    resolution.sourceModuleIs('shopping', 'type Cart {}');
    resolution.resolveDeclarations();
    resolution.expectSameTargets(['Basket'], ['SavedBasket']);
    resolution.expectReferenceTargetsDeclaration('entry', ['Cart'], 'shopping', 'record-type-declaration', 'Cart');
    resolution.expectReferenceTargetsDeclaration('entry', ['Basket'], 'shopping', 'record-type-declaration', 'Cart');
    resolution.expectReferenceTargetsDeclaration('entry', ['SavedBasket'], 'shopping', 'record-type-declaration', 'Cart');
  });

  it('does not make a source modules own imports ambient in its consumer', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart from "shopping"
function save(cart: Cart, item: Item)`);
    resolution.sourceModuleIs('shopping', `use Item from "inventory"
type Cart { item: Item }`);
    resolution.sourceModuleIs('inventory', 'type Item { title: Text }');
    resolution.resolveDeclarations();
    resolution.expectFieldType('shopping', 'Cart', 'item', { written: ['Item'], target: { module: 'inventory', name: 'Item' } });
    resolution.expectInvalid(['Item'], 'unresolved-reference');
    resolution.expectBound(['Cart'], { name: 'Cart' }, 1);
  });

  it('follows an external module reference into source without making that name ambient', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart from "shopping"
function save(cart: Cart, item: Item)`);
    resolution.externalModuleIs('shopping', [{ kind: 'record-type', name: 'Cart', fields: [
      { kind: 'field', name: 'item', type: { kind: 'named', module: 'inventory', path: ['Item'] } },
    ] }]);
    resolution.sourceModuleIs('inventory', 'type Item { title: Text }');
    resolution.resolveDeclarations();
    resolution.expectFieldType('shopping', 'Cart', 'item', { written: ['Item'], target: { module: 'inventory', name: 'Item' } });
    resolution.expectInvalid(['Item'], 'unresolved-reference');
    resolution.expectBound(['Cart'], { name: 'Cart' }, 1);
  });

  it('does not analyze unused supplied modules or lose their independent inspections', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('type StoreGame {}');
    resolution.sourceModuleIs('unused', 'type Unused { item: MissingItem }');
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectUnreachedModule('unused', 'Unused');
    resolution.expectOriginalReferencesUnanalyzed('unused');
  });

  it('analyzes unused declarations inside a reached module', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use Cart from "shopping"');
    resolution.sourceModuleIs('shopping', `type Cart {}
function unused(value: MissingItem)`);
    resolution.resolveDeclarations();
    resolution.expectBound(['Cart'], { name: 'Cart' });
    resolution.expectInvalidIn('shopping', ['MissingItem'], 'unresolved-reference');
  });
});

describe('enrichment belongs to the returned view', () => {
  it('preserves an input iterator and its unanalysed reference observations', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart as Basket from "shopping"
function save(cart: Basket) returns Nothing`);
    resolution.sourceModuleIs('shopping', 'type Cart { title: Text }');
    resolution.expectPreservedIteratorWhileResolving('entry');
    resolution.expectBound(['Basket'], { name: 'Cart', origin: { kind: 'source', module: 'shopping' } });
    resolution.expectOriginalReferencesUnanalyzed('entry');
    resolution.expectOriginalReferencesUnanalyzed('shopping');
  });

  it('keeps the earlier resolved snapshot when a new module changes a field type', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use Cart from "shopping"');
    resolution.externalModuleIs('shopping', [{ kind: 'record-type', name: 'Cart', fields: [
      { kind: 'field', name: 'title', type: { kind: 'builtin', name: 'Text' } },
    ] }]);
    resolution.resolveDeclarations();
    resolution.rememberBinding('shopping', ['Text']);

    resolution.replaceExternalModule('shopping', [{ kind: 'record-type', name: 'Cart', fields: [
      { kind: 'field', name: 'title', type: { kind: 'named', path: ['MissingItem'] } },
    ] }]);
    resolution.resolveDeclarations();
    resolution.expectInvalidIn('shopping', ['MissingItem'], 'unresolved-reference');
    resolution.expectRememberedBinding('Text');
    resolution.expectBound(['Cart'], { name: 'Cart' });

    resolution.removeModules();
    resolution.resolveDeclarations();
    resolution.expectInvalid(['Cart'], 'unavailable-module');
    resolution.expectRememberedBinding('Text');
  });

  it('completes fixed references while keeping deferred and invalid references distinct', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`type Cart {}
function save(cart: Cart) { ensures cart.save() == true }
function broken(value: MissingItem)`);
    resolution.expectOriginalReferencesUnanalyzed('entry');
    resolution.resolveDeclarations();
    resolution.expectBound(['Cart'], { name: 'Cart', kind: 'record-type-declaration' });
    resolution.expectBound(['cart'], { name: 'cart', kind: 'parameter' });
    resolution.expectDeferred(['save'], 'receiver-type');
    resolution.expectInvalid(['MissingItem'], 'unresolved-reference');
    resolution.expectCompleteReferenceOutcomes();
    resolution.expectOriginalReferencesUnanalyzed('entry');
  });
});

describe('inspection retains known details and honest absence', () => {
  it('keeps an authored source default expression and absent callable body', () => {
    const resolution = new DeclarationResolution();
    resolution.entryIs('source', 'source.expec', 'function save(title: Text = "Dune")');
    resolution.resolveDeclarations();
    resolution.expectDefault('source', 'save', 'title', true, 'Dune');
    resolution.expectFunction('source', 'save', { title: 'Text' }, undefined, 'absent');
  });

  it('retains an external default presence without inventing its expression', () => {
    const resolution = new DeclarationResolution();
    resolution.externalEntryIs('external', [{ kind: 'function', name: 'save', parameters: [
      { name: 'title', type: { kind: 'builtin', name: 'Text' }, hasDefault: true },
      { name: 'author', type: { kind: 'builtin', name: 'Text' }, hasDefault: false },
    ] }]);
    resolution.resolveDeclarations();
    resolution.expectDefault('external', 'save', 'title', true);
    resolution.expectDefault('external', 'save', 'author', false);
    resolution.expectFunction('external', 'save', { title: 'Text', author: 'Text' }, undefined, 'unavailable');
  });

  it('distinguishes an unspecified external result from explicit Nothing', () => {
    const resolution = new DeclarationResolution();
    resolution.externalEntryIs('external', [
      { kind: 'function', name: 'unspecified', parameters: [] },
      { kind: 'function', name: 'noResult', parameters: [], result: { kind: 'builtin', name: 'Nothing' } },
    ]);
    resolution.resolveDeclarations();
    resolution.expectFunction('external', 'unspecified', {}, undefined, 'unavailable');
    resolution.expectFunction('external', 'noResult', {}, 'Nothing', 'unavailable');
    resolution.expectBound(['Nothing'], { name: 'Nothing', kind: 'builtin-type' });
  });

  it('requires a record shape before accepting an external inspection', () => {
    const resolution = new DeclarationResolution();
    resolution.expectRejectedExternal('shopping', [{ kind: 'record-type', name: 'Cart' }], [0, 'fields']);
  });

  it('accepts a known empty record distinctly from an opaque declaration', () => {
    const resolution = new DeclarationResolution();
    resolution.externalEntryIs('shopping', [
      { kind: 'record-type', name: 'EmptyCart', fields: [] },
      { kind: 'opaque-type', name: 'OpaqueCart' },
    ]);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectRecord('shopping', 'EmptyCart', {});
    resolution.expectDeclaration('OpaqueCart', 'opaque-type-declaration');
  });
});

describe('common reference nodes preserve external lookup rules', () => {
  it('connects recursive record types without recursive declaration expansion', () => {
    const resolution = new DeclarationResolution();
    resolution.externalEntryIs('trees', [{ kind: 'record-type', name: 'Tree', fields: [
      { kind: 'field', name: 'children', type: { kind: 'builtin', name: 'List', arguments: [
        { kind: 'named', path: ['Tree'] },
      ] } },
    ] }]);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectRecord('trees', 'Tree', { children: 'List<Tree>' });
    resolution.expectBound(['List'], { name: 'List', kind: 'builtin-type' });
    resolution.expectReferenceTargetsDeclaration('trees', ['Tree'], 'trees', 'record-type-declaration', 'Tree');
    resolution.expectCompleteReferenceOutcomes();
  });

  it('keeps external generic parameter identities local to their declaring types', () => {
    const resolution = new DeclarationResolution();
    resolution.externalEntryIs('generics', [
      { kind: 'record-type', name: 'Pair', typeParameters: ['T'], fields: [
        { kind: 'field', name: 'first', type: { kind: 'parameter', name: 'T' } },
      ] },
      { kind: 'record-type', name: 'Page', typeParameters: ['T'], fields: [
        { kind: 'field', name: 'item', type: { kind: 'parameter', name: 'T' } },
      ] },
    ]);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectTypeParametersStayDistinct('generics', 'Pair', 'Page', 'T');
  });

  it('does not satisfy an explicit type parameter reference with an ordinary type', () => {
    const resolution = new DeclarationResolution();
    resolution.externalEntryIs('generics', [
      { kind: 'record-type', name: 'T', fields: [] },
      { kind: 'record-type', name: 'Page', fields: [
        { kind: 'field', name: 'item', type: { kind: 'parameter', name: 'T' } },
      ] },
    ]);
    resolution.resolveDeclarations();
    resolution.expectInvalid(['T'], 'wrong-reference-kind');
  });

  it('does not redirect an explicit builtin reference to a duplicate user declaration', () => {
    const resolution = new DeclarationResolution();
    resolution.externalEntryIs('shopping', [
      { kind: 'record-type', name: 'Text', fields: [] },
      { kind: 'record-type', name: 'Cart', fields: [
        { kind: 'field', name: 'title', type: { kind: 'builtin', name: 'Text' } },
      ] },
    ]);
    resolution.resolveDeclarations();
    resolution.expectProblem('duplicate-declaration', undefined, 1);
    resolution.expectBound(['Text'], { name: 'Text', kind: 'builtin-type', origin: { kind: 'builtin', name: 'Text' } });
  });

  it('requires exact external public capability names', () => {
    const resolution = new DeclarationResolution();
    resolution.externalEntryIs('shopping', [{ kind: 'concept', name: 'StoreGame', public: ['saveGame'], members: [
      { kind: 'capability', name: 'save', parameters: [] },
    ] }]);
    resolution.resolveDeclarations();
    resolution.expectInvalid(['saveGame'], 'unresolved-reference');
    resolution.expectDeclaration('save', 'capability', 'StoreGame');
  });

  it('requires a source capability to be public before another module imports it', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use StoreGame.save from "shopping"');
    resolution.sourceModuleIs('shopping', 'concept StoreGame { capability save() }');
    resolution.resolveDeclarations();
    resolution.expectInvalid(['StoreGame', 'save'], 'inaccessible-reference');
  });

  it('imports a public external capability through its actual owner', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use StoreGame.save from "shopping"');
    resolution.externalModuleIs('shopping', [{ kind: 'concept', name: 'StoreGame', public: ['save'], members: [
      { kind: 'capability', name: 'save', parameters: [] },
    ] }]);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['StoreGame', 'save'], { name: 'save', kind: 'capability' });
    resolution.expectBoundIn('shopping', ['save'], { name: 'save', kind: 'capability' });
  });

  it('binds mutually referring source modules without resolving a type expansion', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use First from "first"');
    resolution.sourceModuleIs('first', `use Second from "second"
type First { next: Second }`);
    resolution.sourceModuleIs('second', `use First from "first"
type Second { previous: First }`);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectFieldType('first', 'First', 'next', { written: ['Second'], target: { module: 'second', name: 'Second' } });
    resolution.expectFieldType('second', 'Second', 'previous', { written: ['First'], target: { module: 'first', name: 'First' } });
    resolution.expectCompleteReferenceOutcomes();
  });
});
