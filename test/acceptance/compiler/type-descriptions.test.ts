import { describe, it } from 'vitest';
import { TypeDescriptions } from '../../dsl/compiler/type-descriptions.js';

describe('a checker and contract viewer describe resolved types', () => {
  it('describes a pair using its supplied element type', () => {
    const types = new TypeDescriptions();
    types.source(`type Pair<T> = [T, T]
type NumberPair = Pair<Number>`);
    types.describe('NumberPair');
    types.expectTupleElements(['Number', 'Number']);
    types.expectNoProblems();
  });

  it('keeps each open generic parameter attached to its declaring type', () => {
    const types = new TypeDescriptions();
    types.source(`type Pair<T> = [T, T]
type Box<T> { value: T }`);
    types.describe('Pair');
    types.expectTupleElements(['T', 'T']);
    types.expectOpenParameters('Pair', 'Box');
    types.expectNoProblems();
  });

  it('substitutes generic arguments into fields through nested aliases', () => {
    const types = new TypeDescriptions();
    types.source(`type Box<T> { value: List<T> }
type NumberBox = Box<Number>
type Selected = NumberBox`);
    types.describe('Selected');
    types.expectFields(['value']);
    types.expectFieldType('value', 'List<Number>');
    types.expectNoProblems();
  });

  it('reports an unused alias application with too many arguments', () => {
    const types = new TypeDescriptions();
    types.source(`type Pair<T> = [T, T]
type Broken = Pair<Number, Text>`);
    types.analyze();
    types.expectProblem('wrong-type-argument-count', 'Pair<Number, Text>');
    types.describe('Broken');
    types.expectAliasProblem('wrong-type-argument-count', 'Pair<Number, Text>');
  });

  it('checks argument counts on builtin applications', () => {
    const types = new TypeDescriptions();
    types.source('type Broken = List<Number, Text>');
    types.analyze();
    types.expectProblem('wrong-type-argument-count', 'List<Number, Text>');
  });

  it('allows a finite nested application of the same transparent alias', () => {
    const types = new TypeDescriptions();
    types.source(`type Id<T> = T
type Selected = Id<Id<Number>>`);
    types.describe('Selected');
    types.expectType('Number');
    types.expectNoProblems();
  });

  it('retains separate nominal identities for records with the same fields', () => {
    const types = new TypeDescriptions();
    types.source(`type ShoppingCart { count: Number }
type Basket { count: Number }`);
    types.describe('ShoppingCart');
    types.expectDistinctDeclarations('ShoppingCart', 'Basket');
    types.expectFieldType('count', 'Number');
    types.describe('Basket');
    types.expectFieldType('count', 'Number');
  });

  it('retains an alias identity while exposing its target fields', () => {
    const types = new TypeDescriptions();
    types.source(`type ShoppingCart { count: Number }
type CartAlias = ShoppingCart`);
    types.describe('CartAlias');
    types.expectAlias('CartAlias', 'ShoppingCart');
    types.expectFieldType('count', 'Number');
  });

  it('describes recursive records without expanding the whole field graph', () => {
    const types = new TypeDescriptions();
    types.source('type Tree { children: List<Tree> }');
    types.describe('Tree');
    types.expectFieldType('children', 'List<Tree>');
    types.followField('children');
    types.followArgument(0);
    types.expectSelectedDeclaration('Tree');
    types.expectNoProblems();
  });

  it('reports a transparent alias cycle with the participating locations', () => {
    const types = new TypeDescriptions();
    types.source(`type A = B
type B = A`);
    types.analyze();
    types.expectProblem('circular-alias');
    types.describe('A');
    types.expectCircularAliasAtLines([1, 2]);
  });

  it('allows a transparent alias to reach a recursive nominal declaration', () => {
    const types = new TypeDescriptions();
    types.source(`type Branch = Tree
type Tree { children: List<Branch> }`);
    types.describe('Branch');
    types.expectFieldType('children', 'List<Tree>');
    types.expectNoProblems();
  });

  it('rejects a transparent alias cycle even when its arguments keep growing', () => {
    const types = new TypeDescriptions();
    types.source('type Loop<T> = Loop<List<T>>');
    types.analyze();
    types.expectProblem('circular-alias');
  });

  it('answers finite successive queries of a growing recursive generic', () => {
    const types = new TypeDescriptions();
    types.source('type Grow<T> { next: Grow<List<T>> }');
    types.describe('Grow');
    types.expectFieldType('next', 'Grow<List<T>>');
    types.followField('next');
    types.expectFieldType('next', 'Grow<List<List<T>>>');
    types.followField('next');
    types.expectSelectedDeclaration('Grow');
    types.expectNoProblems();
    types.expectUnchangedAfterQueries();
  });

  it('preserves construction and callable input identities in authored order', () => {
    const types = new TypeDescriptions();
    types.source(`type SystemConfig {}
type PlayerStateSnapshot {}
type Cart {}
concept StoreGame {
 construction(config: SystemConfig)
 capability transfer(origin: Cart, destination: Cart)
 capability save(snapshot: PlayerStateSnapshot)
}`);
    types.describeCallables();
    types.expectConstruction('StoreGame', ['config: SystemConfig']);
    types.expectParameters('transfer', ['origin: Cart', 'destination: Cart']);
    types.expectParameters('save', ['snapshot: PlayerStateSnapshot']);
    types.expectNoProblems();
  });

  it('reports a required input after a default while retaining both slots', () => {
    const types = new TypeDescriptions();
    types.source('function transfer(origin: Text = "home", destination: Text)');
    types.describeCallables();
    types.expectParameters('transfer', ['origin: Text', 'destination: Text']);
    types.expectCallableProblem('transfer', 'required-after-default');
    types.expectProblem('required-after-default', 'destination: Text');
  });

  it('distinguishes absent construction from explicitly empty construction', () => {
    const types = new TypeDescriptions();
    types.source(`concept Absent {}
concept Empty { construction() }`);
    types.analyze();
    types.expectConstruction('Absent', undefined);
    types.expectConstruction('Empty', []);
    types.expectNoProblems();
  });

  it('retains the resolution cause when construction is duplicated', () => {
    const types = new TypeDescriptions();
    types.source(`concept StoreGame {
 construction()
 construction()
}`);
    types.analyze();
    types.expectConstructionProblem('StoreGame', 'duplicate-declaration');
  });

  it('distinguishes omitted, explicit empty, value and invalid results', () => {
    const types = new TypeDescriptions();
    types.source(`function save()
function stop() returns Nothing
function count() returns Number
function broken() returns Missing`);
    types.describeCallables();
    types.expectResult('save', { kind: 'unspecified' });
    types.expectResult('stop', { kind: 'none' });
    types.expectResult('count', { kind: 'value', type: 'Number' });
    types.expectResultProblem('broken', 'unresolved-reference', 'Missing');
  });

  it('allows a Nothing alias as the complete callable result', () => {
    const types = new TypeDescriptions();
    types.source(`type NoResult = Nothing
function stop() returns NoResult`);
    types.describeCallables();
    types.expectResult('stop', { kind: 'none' });
    types.expectNoProblems();
  });

  it('rejects Nothing hidden behind an alias in a field', () => {
    const types = new TypeDescriptions();
    types.source(`type NoResult = Nothing
type Cart { item: NoResult }`);
    types.describe('Cart');
    types.expectFieldProblem('item', 'invalid-nothing-use', 'NoResult');
  });

  it('rejects Nothing inside generic, tuple, union and optional types', () => {
    const types = new TypeDescriptions();
    types.source(`type Cart {
 list: List<Nothing>
 pair: [Number, Nothing]
 choice: Text | Nothing
 maybe: Nothing?
}`);
    types.describe('Cart');
    types.expectFields(['list', 'pair', 'choice', 'maybe']);
    types.expectFieldProblem('list', 'invalid-nothing-use', 'Nothing');
    types.expectFieldProblem('pair', 'invalid-nothing-use', 'Nothing');
    types.expectFieldProblem('choice', 'invalid-nothing-use', 'Nothing');
    types.expectFieldProblem('maybe', 'invalid-nothing-use', 'Nothing');
  });

  it('rejects a public capability that exposes a local type', () => {
    const types = new TypeDescriptions();
    types.source(`concept StoreGame {
 local type SessionState {}
 public save
 capability save(snapshot: SessionState)
}`);
    types.describeCallables();
    types.expectCallableProblem('save', 'private-type-exposure');
    types.expectParameters('save', ['snapshot: SessionState']);
    types.expectProblem('private-type-exposure', 'SessionState', 'type SessionState {}');
  });

  it('finds public exposure through an alias and a generic argument', () => {
    const types = new TypeDescriptions();
    types.source(`concept StoreGame {
 local type SessionState {}
 local type Sessions = List<SessionState>
 public save
 capability save(snapshots: Sessions)
}`);
    types.describeCallables();
    types.expectCallableProblem('save', 'private-type-exposure');
    types.expectParameters('save', ['snapshots: List<SessionState>']);
  });

  it('permits the same local type in a nonpublic capability', () => {
    const types = new TypeDescriptions();
    types.source(`concept StoreGame {
 local type SessionState {}
 capability save(snapshot: List<SessionState>)
}`);
    types.describeCallables();
    types.expectParameters('save', ['snapshot: List<SessionState>']);
    types.expectNoProblems();
  });

  it('describes a source record and a reached external record through the same queries', () => {
    const types = new TypeDescriptions();
    types.source(`use ExternalCart from "shopping"
type Cart { title: Text }`);
    types.externalModule('shopping', [{ kind: 'record-type', name: 'ExternalCart', fields: [
      { kind: 'field', name: 'title', type: { kind: 'builtin', name: 'Text' } },
    ] }]);
    types.describe('Cart');
    types.expectFieldType('title', 'Text');
    types.describe('ExternalCart');
    types.expectFieldType('title', 'Text');
    types.expectNoProblems();
  });

  it('retains external default presence without inventing an expression or body', () => {
    const types = new TypeDescriptions();
    types.external([{ kind: 'function', name: 'save', parameters: [
      { name: 'title', type: { kind: 'builtin', name: 'Text' }, hasDefault: true },
    ], result: { kind: 'builtin', name: 'Nothing' } }]);
    types.describeCallables();
    types.expectParameters('save', ['title: Text']);
    types.expectExternalDefault('save', 'title');
    types.expectBody('save', 'unavailable');
    types.expectResult('save', { kind: 'none' });
    types.expectNoProblems();
  });

  it('distinguishes an empty record from an opaque declaration', () => {
    const types = new TypeDescriptions();
    types.source(`type Empty {}
opaque type Secret`);
    types.describe('Empty');
    types.expectFields([]);
    types.describe('Secret');
    types.expectOpaque();
  });

  it('keeps a valid field visible beside an unresolved field', () => {
    const types = new TypeDescriptions();
    types.source(`type Cart {
 title: Text
 item: Missing
}`);
    types.describe('Cart');
    types.expectSelectedDeclaration('Cart');
    types.expectFields(['title', 'item']);
    types.expectFieldType('title', 'Text');
    types.expectFieldProblem('item', 'unresolved-reference', 'Missing');
    types.expectNoTypeProblems();
  });

  it('keeps an unresolved field location after an astral declaration name', () => {
    const types = new TypeDescriptions();
    types.source('type `📚` { item: Missing }');
    types.describe('📚');
    types.expectFieldProblem('item', 'unresolved-reference', 'Missing');
    types.expectNoTypeProblems();
  });

  it('keeps valid parameters and the result beside an invalid parameter', () => {
    const types = new TypeDescriptions();
    types.source('function save(title: Text, item: Missing) returns Number');
    types.describeCallables();
    types.expectParameterType('save', 'title', 'Text');
    types.expectParameterProblem('save', 'item', 'unresolved-reference', 'Missing');
    types.expectResult('save', { kind: 'value', type: 'Number' });
  });

  it('does not defer a declared signature because the body needs receiver analysis', () => {
    const types = new TypeDescriptions();
    types.source(`type Cart {}
function save(cart: Cart) returns Number { ensures cart.count() == 1 }`);
    types.describeCallables();
    types.expectParameters('save', ['cart: Cart']);
    types.expectResult('save', { kind: 'value', type: 'Number' });
    types.expectOnlyBodyDeferred();
  });

  it('retains a composition prerequisite on an unavailable type', () => {
    const types = new TypeDescriptions();
    types.source(`include "./types.expec"
type Selected = ImportedType`);
    types.describe('Selected');
    types.expectAliasDeferred('composition');
    types.expectNoTypeProblems();
  });

  it('retains invalid and deferred prerequisites on the same compound type', () => {
    const types = new TypeDescriptions();
    types.source(`include "./types.expec"
function Wrong()
type Mixed = [Wrong, ImportedType]`);
    types.describe('Mixed');
    types.expectMixedAliasFailure('wrong-reference-kind', 'composition');
  });

  it('enumerates unused, nested and imported declarations in inspection order', () => {
    const types = new TypeDescriptions();
    types.source(`use Remote from "remote"
use External from "external"
type Unused {}
concept Store {
 capability save()
 local concept Inner { capability load() }
}`);
    types.module('remote', `type Remote {}
function remotely()`);
    types.externalModule('external', [{ kind: 'opaque-type', name: 'External' }]);
    types.analyze();
    types.expectDeclarations(['Unused', 'Store', 'Inner', 'External', 'Remote'], ['save', 'load', 'remotely']);
    types.expectNoProblems();
  });

  it('finds errors in unused declarations before a caller requests a type', () => {
    const types = new TypeDescriptions();
    types.source(`type Fine {}
type Unused = List<Number, Text>`);
    types.analyze();
    types.expectProblem('wrong-type-argument-count', 'List<Number, Text>');
    types.describe('Fine');
    types.expectFields([]);
    types.expectUnchangedAfterQueries();
  });

  it('ignores invalid declarations in an unreached supplied module', () => {
    const types = new TypeDescriptions();
    types.source('type Cart { title: Text }');
    types.module('unused', 'type Broken = List<Number, Text>');
    types.analyze();
    types.expectDeclarations(['Cart'], []);
    types.expectNoProblems();
  });

  it('preserves tuple order, union alternatives and optionality', () => {
    const types = new TypeDescriptions();
    types.source('type Selected = [Text | Number, Boolean?, Number]');
    types.describe('Selected');
    types.expectTupleElements(['Text | Number', 'Boolean?', 'Number']);
    types.expectNoProblems();
  });

  it('preserves literal spelling, sign and source provenance', () => {
    const types = new TypeDescriptions();
    types.source('type Selected = [1, 1.0, -2.50, "hello", true]');
    types.describe('Selected');
    types.expectLiteralOrigins(['1', '1.0', '-2.50', '"hello"', 'true']);
    types.expectNoProblems();
  });

  it('supports independent viewer and checker queries without changing input or findings', () => {
    const types = new TypeDescriptions();
    types.source(`type Box<T> { value: T }
type NumberBox = Box<Number>
function read(box: NumberBox) returns Number`);
    types.describe('NumberBox');
    types.expectFieldType('value', 'Number');
    types.expectParameters('read', ['box: Box<Number>']);
    types.expectResult('read', { kind: 'value', type: 'Number' });
    types.expectUnchangedAfterQueries();
    types.expectFieldType('value', 'Number');
    types.expectNoProblems();
  });

  it('gives each analysis its own type handles while retaining original declaration identities', () => {
    const types = new TypeDescriptions();
    types.source('type Cart { title: Text }');
    types.describe('Cart');
    types.expectIndependentCatalog();
    types.expectFieldType('title', 'Text');
    types.expectUnchangedAfterQueries();
  });
});
