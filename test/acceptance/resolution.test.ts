import { describe, it } from 'vitest';
import type { PackagePhase } from '../../src/index.js';
import { DeclarationResolution } from '../support/declaration-resolution.js';

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
    resolution.expectBound(['PlayerStateSnapshot'], { name: 'PlayerStateSnapshot', kind: 'record-type', origin: { kind: 'source' } });
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
    resolution.moduleExportsRecord('shopping', 'Cart');
    resolution.moduleExportsRecord('shipping', 'Cart');
    resolution.resolveDeclarations();
    resolution.expectInvalid(['Cart'], 'unresolved-reference');
  });

  it('reports ambiguity between two explicitly selected exports', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart from "shopping"
use Cart from "shipping"
function save(cart: Cart)`);
    resolution.moduleExportsRecord('shopping', 'Cart');
    resolution.moduleExportsRecord('shipping', 'Cart');
    resolution.resolveDeclarations();
    resolution.expectInvalid(['Cart'], 'ambiguous-reference', 2);
    resolution.expectProblem('ambiguous-reference', undefined, 2);
  });

  it('preserves different module identities through explicit aliases', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart as Basket from "shopping"
use Cart as Shipment from "shipping"
function save(basket: Basket, shipment: Shipment)`);
    resolution.moduleExportsRecord('shopping', 'Cart');
    resolution.moduleExportsRecord('shipping', 'Cart');
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['Basket'], { name: 'Cart', origin: { kind: 'external', module: 'shopping', declaration: 'Cart' } });
    resolution.expectBound(['Shipment'], { name: 'Cart', origin: { kind: 'external', module: 'shipping', declaration: 'Cart' } });
    resolution.expectDifferentTargets(['Basket'], ['Shipment']);
  });

  it('keeps two aliases for one export attached to the same declaration', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart as Basket from "shopping"
use Cart as Trolley from "shopping"
function save(first: Basket, second: Trolley)`);
    resolution.moduleExportsRecord('shopping', 'Cart');
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectSameTargets(['Basket'], ['Trolley']);
  });

  it('rejects a repeated introduction instead of silently merging it', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart from "shopping"
use Cart from "shopping"
function save(cart: Cart)`);
    resolution.moduleExportsRecord('shopping', 'Cart');
    resolution.resolveDeclarations();
    resolution.expectProblem('duplicate-declaration', undefined, 1);
  });

  it('reports an imported name colliding with a local declaration', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart from "shopping"
type Cart { count: Number }`);
    resolution.moduleExportsRecord('shopping', 'Cart');
    resolution.resolveDeclarations();
    resolution.expectProblem('duplicate-declaration', undefined, 1);
  });

  it('keeps a quoted dotted export distinct from a qualified export path', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use \`Sales.Cart\` as Dotted from "shopping"
use Sales.Cart as Qualified from "shopping"
function save(first: Dotted, second: Qualified)`);
    resolution.dependenciesAre({ packages: [], modules: [{
      locator: 'shopping',
      declarations: [
        { id: 'dotted', name: 'Sales.Cart', kind: 'record-type', links: [] },
        { id: 'qualified', name: 'Cart', kind: 'record-type', links: [] },
      ],
      exports: [{ path: ['Sales.Cart'], declaration: 'dotted' }, { path: ['Sales', 'Cart'], declaration: 'qualified' }],
    }] });
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['Dotted'], { name: 'Sales.Cart', origin: { kind: 'external', declaration: 'dotted' } });
    resolution.expectBound(['Qualified'], { name: 'Cart', origin: { kind: 'external', declaration: 'qualified' } });
    resolution.expectDifferentTargets(['Dotted'], ['Qualified']);
  });

  it('does not select a declaration that its module never exported', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use Cart from "shopping"
function save(cart: Cart)`);
    resolution.dependenciesAre({ packages: [], modules: [{
      locator: 'shopping', declarations: [{ id: 'cart', name: 'Cart', kind: 'record-type', links: [] }], exports: [],
    }] });
    resolution.resolveDeclarations();
    resolution.expectInvalid(['Cart'], 'unresolved-reference');
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
    resolution.expectBound(['SessionState'], { name: 'SessionState', kind: 'record-type' });
    resolution.expectInvalid(['StoreGame', 'SessionState'], 'inaccessible-reference');
    resolution.expectDeclaration('SessionState', 'record-type', 'StoreGame');
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
    resolution.expectBound(['Cart'], { name: 'Cart', kind: 'record-type' });
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

describe('a caller supplies closed declaration metadata', () => {
  it('imports an externally described record with all required declaration links', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use ValidationResult from "results"
function validate(source: Text) returns ValidationResult`);
    resolution.dependenciesAre({ packages: [], modules: [{
      locator: 'results',
      declarations: [{ id: 'result', name: 'ValidationResult', kind: 'record-type', links: [
        { label: 'accepted.type', target: { kind: 'builtin', name: 'Boolean' } },
        { label: 'messages.container', target: { kind: 'builtin', name: 'List' } },
        { label: 'messages.element', target: { kind: 'builtin', name: 'Text' } },
      ] }],
      exports: [{ path: ['ValidationResult'], declaration: 'result' }],
    }] });
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['ValidationResult'], { name: 'ValidationResult', origin: { kind: 'external', module: 'results', declaration: 'result' } }, 1);
    resolution.expectInputsUnchanged();
  });

  it('reports an export selecting a nonexistent declaration', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use ValidationResult from "results"');
    resolution.dependenciesAre({ packages: [], modules: [{
      locator: 'results', declarations: [], exports: [{ path: ['ValidationResult'], declaration: 'missing' }],
    }] });
    resolution.resolveDeclarations();
    resolution.expectCatalogProblemWithin(['modules', 0, 'exports', 0]);
  });

  it('rejects a record whose required field link points to absent metadata', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use ValidationResult from "results"');
    resolution.dependenciesAre({ packages: [], modules: [{
      locator: 'results',
      declarations: [{ id: 'result', name: 'ValidationResult', kind: 'record-type', links: [
        { label: 'messages.type', target: { kind: 'local', declaration: 'missing-message-type' } },
      ] }],
      exports: [{ path: ['ValidationResult'], declaration: 'result' }],
    }] });
    resolution.resolveDeclarations();
    resolution.expectCatalogProblemWithin(['modules', 0, 'declarations', 0, 'links', 0]);
    resolution.expectInvalid(['ValidationResult'], 'invalid-dependency-catalog');
  });

  it('resolves transitive required imports from the supplied snapshot', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use ValidationResult from "results"
function validate() returns ValidationResult`);
    resolution.dependenciesAre({ packages: [], modules: [
      { locator: 'results', declarations: [{ id: 'result', name: 'ValidationResult', kind: 'record-type', links: [
        { label: 'messages.element', target: { kind: 'import', module: 'messages', path: ['Message'] } },
      ] }], exports: [{ path: ['ValidationResult'], declaration: 'result' }] },
      { locator: 'messages', declarations: [{ id: 'message', name: 'Message', kind: 'record-type', links: [] }],
        exports: [{ path: ['Message'], declaration: 'message' }] },
    ] });
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['ValidationResult'], { name: 'ValidationResult', origin: { kind: 'external', module: 'results' } }, 1);
    resolution.expectDeclaration('Message', 'record-type');
  });

  it('keeps an independent valid import when another export has an unavailable transitive dependency', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use ValidationResult from "results"
use Cart from "shopping"
function save(cart: Cart)`);
    resolution.dependenciesAre({ packages: [], modules: [
      { locator: 'results', declarations: [{ id: 'result', name: 'ValidationResult', kind: 'record-type', links: [
        { label: 'messages.element', target: { kind: 'import', module: 'messages', path: ['Message'] } },
      ] }], exports: [{ path: ['ValidationResult'], declaration: 'result' }] },
      { locator: 'shopping', declarations: [{ id: 'cart', name: 'Cart', kind: 'record-type', links: [] }],
        exports: [{ path: ['Cart'], declaration: 'cart' }] },
    ] });
    resolution.resolveDeclarations();
    resolution.expectProblem('unavailable-module');
    resolution.expectDependencyCause('unavailable-module', ['modules', 0, 'declarations', 0, 'links', 0, 'target']);
    resolution.expectInvalid(['ValidationResult'], 'invalid-dependency-catalog');
    resolution.expectBound(['Cart'], { name: 'Cart', origin: { kind: 'external', module: 'shopping' } }, 1);
  });

  it('allows mutually referring record declarations without treating the cycle as an alias error', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use First from "records"
function save(value: First)`);
    resolution.dependenciesAre({ packages: [], modules: [{
      locator: 'records',
      declarations: [
        { id: 'first', name: 'First', kind: 'record-type', links: [{ label: 'next', target: { kind: 'local', declaration: 'second' } }] },
        { id: 'second', name: 'Second', kind: 'record-type', links: [{ label: 'previous', target: { kind: 'local', declaration: 'first' } }] },
      ],
      exports: [{ path: ['First'], declaration: 'first' }],
    }] });
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['First'], { name: 'First', kind: 'record-type' }, 1);
    resolution.expectDeclaration('Second', 'record-type');
  });

  it('rejects duplicate module locators instead of choosing a first match', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use Cart from "shopping"');
    resolution.moduleExportsRecord('shopping', 'Cart');
    resolution.moduleExportsRecord('shopping', 'Cart');
    resolution.resolveDeclarations();
    resolution.expectProblem('invalid-dependency-catalog');
  });

  it('rejects duplicate export paths within one supplied module', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use Cart from "shopping"');
    resolution.dependenciesAre({ packages: [], modules: [{
      locator: 'shopping', declarations: [{ id: 'cart', name: 'Cart', kind: 'record-type', links: [] }],
      exports: [{ path: ['Cart'], declaration: 'cart' }, { path: ['Cart'], declaration: 'cart' }],
    }] });
    resolution.resolveDeclarations();
    resolution.expectProblem('invalid-dependency-catalog');
  });

  it('rejects duplicate supplied declaration identities', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use Cart from "shopping"');
    resolution.dependenciesAre({ packages: [], modules: [{
      locator: 'shopping',
      declarations: [
        { id: 'cart', name: 'Cart', kind: 'record-type', links: [] },
        { id: 'cart', name: 'OtherCart', kind: 'record-type', links: [] },
      ],
      exports: [{ path: ['Cart'], declaration: 'cart' }],
    }] });
    resolution.resolveDeclarations();
    resolution.expectProblem('invalid-dependency-catalog');
  });

  it('does not let an export bypass a supplied local declaration boundary', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use SessionState from "store"');
    resolution.dependenciesAre({ packages: [], modules: [{
      locator: 'store',
      declarations: [
        { id: 'store', name: 'StoreGame', kind: 'concept', links: [] },
        { id: 'session', name: 'SessionState', kind: 'record-type', owner: 'store', local: true, links: [] },
      ],
      exports: [{ path: ['SessionState'], declaration: 'session' }],
    }] });
    resolution.resolveDeclarations();
    resolution.expectProblem('invalid-dependency-catalog');
  });
});

describe('an author declares dependencies without implicitly introducing them', () => {
  it('binds an explicit dependency to its existing declaration', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`type Storage {}
concept StoreGame { depends on Storage }`);
    resolution.resolveDeclarations();
    resolution.expectNoProblems();
    resolution.expectBound(['Storage'], { name: 'Storage', kind: 'record-type' });
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
    resolution.expectProblem('invalid-dependency-catalog');
  });

  it('locates a malformed configured package phase', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('concept StoreGame { requires package "vite" }');
    resolution.dependenciesAre({ modules: [], packages: [
      { alias: 'vite', phases: ['compile' as PackagePhase] },
    ] });
    resolution.resolveDeclarations();
    resolution.expectCatalogProblemWithin(['packages', 0, 'phases']);
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
    resolution.expectBound(['Cart'], { name: 'Cart', kind: 'record-type' });
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
    resolution.moduleExportsRecord('shopping', 'Cart');
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
    resolution.expectDeclarationNamesStartWith(['Cart', 'save', 'cart']);
    resolution.expectDeclarationsReplay();
    resolution.expectBound(['Cart'], { name: 'Cart', kind: 'record-type' });
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
    resolution.moduleExportsRecord('shopping', 'Cart');
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
    resolution.expectBound(['SessionState'], { name: 'SessionState', kind: 'record-type' });
    resolution.expectDeclaration('SessionState', 'record-type', 'StoreGame');
  });

  it('rejects a required transitive export absent from an otherwise supplied module', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs('use ValidationResult from "results"');
    resolution.dependenciesAre({ packages: [], modules: [
      { locator: 'results', declarations: [{ id: 'result', name: 'ValidationResult', kind: 'record-type', links: [
        { label: 'messages.element', target: { kind: 'import', module: 'messages', path: ['Message'] } },
      ] }], exports: [{ path: ['ValidationResult'], declaration: 'result' }] },
      { locator: 'messages', declarations: [{ id: 'message', name: 'Message', kind: 'record-type', links: [] }],
        exports: [] },
    ] });
    resolution.resolveDeclarations();
    resolution.expectCatalogProblemWithin(['modules', 0, 'declarations', 0, 'links', 0]);
    resolution.expectDependencyCause('unresolved-reference', ['modules', 0, 'declarations', 0, 'links', 0, 'target']);
    resolution.expectInvalid(['ValidationResult'], 'invalid-dependency-catalog');
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


