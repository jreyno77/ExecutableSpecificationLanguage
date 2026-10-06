import { describe, it } from 'vitest';
import { ExpressionChecking } from '../../dsl/compiler/expression-checking.js';

describe('a consumer checks expressions and declared contracts', () => {
  it('reads the declared result of a call with an omitted defaulted argument', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`function add(count: Number = 1) returns Number
examples { fixture sum: Number = add() }`);
    expressions.typeOf('sum');
    expressions.expectType('Number');
    expressions.checkValue('sum');
    expressions.expectValid();
    expressions.checkCall('sum');
    expressions.expectValid();
  });

  it('reports an incompatible argument at the supplied value', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`function add(count: Number = 1) returns Number
examples { fixture sum: Number = add("one") }`);
    expressions.checkCall('sum');
    expressions.expectProblem('incompatible-type', '"one"');
  });

  it('checks an invalid default separately from calls which omit or replace it', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`function add(count: Number = "one") returns Number
examples {
 fixture omitted: Number = add()
 fixture supplied: Number = add(2)
}`);
    expressions.checkDefault('add', 'count');
    expressions.expectProblem('incompatible-type', '"one"');
    expressions.checkCall('omitted');
    expressions.expectValid();
    expressions.checkCall('supplied');
    expressions.expectValid();
  });
  it('rejects an extra positional argument', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`function add(count: Number) returns Number
examples { fixture sum: Number = add(1, 2) }`);
    expressions.checkCall('sum');
    expressions.expectProblem('invalid-arity');
  });

  it('requires each omitted positional argument to have a default', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`function add(count: Number) returns Number
examples { fixture sum: Number = add() }`);
    expressions.checkCall('sum');
    expressions.expectProblem('invalid-arity');
  });

  it('admits an unavailable external default when calling but defers checking its body', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`use add from "math"
examples { fixture sum: Number = add() }`);
    expressions.externalModule('math', [{ kind: 'function', name: 'add', parameters: [
      { name: 'count', type: { kind: 'builtin', name: 'Number' }, hasDefault: true },
    ], result: { kind: 'builtin', name: 'Number' } }]);
    expressions.checkCall('sum');
    expressions.expectValid();
    expressions.checkDefault('add', 'count');
    expressions.expectNoProblems();
    expressions.expectDeferred('default-body');
  });

  it('allows a record to omit optional and defaulted fields', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type Settings {
 count: Number
 brightness: Number = 80
 label: Text?
}
examples { fixture settings: Settings = Settings { count: 2 } }`);
    expressions.checkValue('settings');
    expressions.expectValid();
    expressions.typeOf('settings');
    expressions.expectType('Settings');
    expressions.checkDefault('Settings', 'brightness');
    expressions.expectValid();
    expressions.expectRecordEntries('settings', ['count']);
  });

  it('reports a missing required record field', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type Settings { count: Number }
examples { fixture settings: Settings = Settings {} }`);
    expressions.checkValue('settings');
    expressions.expectProblem('invalid-record');
  });

  it('reports an unknown record field', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type Settings { count: Number }
examples { fixture settings: Settings = Settings { count: 2, extra: 3 } }`);
    expressions.checkValue('settings');
    expressions.expectProblem('invalid-record');
  });

  it('reports a repeated record field', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type Settings { count: Number }
examples { fixture settings: Settings = Settings { count: 2, count: 3 } }`);
    expressions.checkValue('settings');
    expressions.expectProblem('invalid-record');
  });

  it('reports the incompatible value supplied to a record field', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type Settings { count: Number }
examples { fixture settings: Settings = Settings { count: "two" } }`);
    expressions.checkValue('settings');
    expressions.expectProblem('incompatible-type', '"two"');
  });

  it('uses the expected record type for an anonymous record', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type Settings { count: Number }
examples { fixture settings: Settings = { count: 2 } }`);
    expressions.checkValue('settings');
    expressions.expectValid();
    expressions.typeOf('settings');
    expressions.expectNoProblems();
    expressions.expectDeferred('expected-type');
  });

  it('requires a unique fitting record alternative for an anonymous record', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type Settings { count: Number }
type Basket { count: Number }
examples { fixture selected: Settings | Basket = { count: 2 } }`);
    expressions.checkValue('selected');
    expressions.expectProblem('ambiguous-record');
  });

  it('selects the fitting record alternative when its fields distinguish it', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type Settings { count: Number }
type Label { title: Text }
examples { fixture selected: Settings | Label = { count: 2 } }`);
    expressions.checkValue('selected');
    expressions.expectValid();
  });

  it('uses the written nominal type to distinguish identical record alternatives', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type Settings { count: Number }
type Basket { count: Number }
examples { fixture selected: Settings | Basket = Settings { count: 2 } }`);
    expressions.checkValue('selected');
    expressions.expectValid();
    expressions.typeOf('selected');
    expressions.expectType('Settings');
  });

  it('does not substitute a different nominal record with the same fields', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type Settings { count: Number }
type Basket { count: Number }
examples { fixture selected: Settings = Basket { count: 2 } }`);
    expressions.checkValue('selected');
    expressions.expectProblem('incompatible-type');
  });

  it('accepts transparent aliases without erasing the record identity', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type Settings { count: Number }
type Preferences = Settings
examples { fixture selected: Preferences = Settings { count: 2 } }`);
    expressions.checkValue('selected');
    expressions.expectValid();
  });

  it('uses an expected list element type even for an empty list', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`examples {
 fixture empty: List<Number> = []
 fixture counts: List<Number> = [1, 2]
}`);
    expressions.checkValue('empty');
    expressions.expectValid();
    expressions.checkValue('counts');
    expressions.expectValid();
    expressions.typeOf('counts');
    expressions.expectType('List<Number>');
  });

  it('infers a heterogeneous list from all element types', () => {
    const expressions = new ExpressionChecking();
    expressions.source('examples { fixture mixed: List<Number | Text> = [1, "two"] }');
    expressions.typeOf('mixed');
    expressions.expectType('List<Number | Text>');
    expressions.checkValue('mixed');
    expressions.expectValid();
  });

  it('keeps an empty list unresolved until an expected type is provided', () => {
    const expressions = new ExpressionChecking();
    expressions.source('examples { fixture empty: List<Number> = [] }');
    expressions.typeOf('empty');
    expressions.expectNoProblems();
    expressions.expectDeferred('expected-type');
  });

  it('reports the list element incompatible with its expected type', () => {
    const expressions = new ExpressionChecking();
    expressions.source('examples { fixture counts: List<Number> = [1, "two"] }');
    expressions.checkValue('counts');
    expressions.expectProblem('incompatible-type', '"two"');
  });

  it('checks tuple values in their declared order', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`examples {
 fixture pair: [Number, Text] = [1, "two"]
 fixture reversed: [Number, Text] = ["two", 1]
}`);
    expressions.checkValue('pair');
    expressions.expectValid();
    expressions.checkValue('reversed');
    expressions.expectProblem('incompatible-type', '"two"');
    expressions.expectProblem('incompatible-type', '1');
  });

  it('requires the exact tuple length', () => {
    const expressions = new ExpressionChecking();
    expressions.source('examples { fixture pair: [Number, Text] = [1] }');
    expressions.checkValue('pair');
    expressions.expectProblem('incompatible-type');
  });

  it('does not convert an available tuple into a list', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`examples {
 fixture pair: [Number, Number] = [1, 2]
 fixture counts: List<Number> = pair
}`);
    expressions.available('pair');
    expressions.checkValue('counts');
    expressions.expectProblem('incompatible-type', 'pair');
  });

  it('requires every possible source union alternative to fit the destination', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`examples {
 fixture choice: Number | Text = 1
 fixture count: Number = choice
}`);
    expressions.available('choice');
    expressions.checkValue('count');
    expressions.expectProblem('incompatible-type', 'choice');
  });

  it('keeps generic applications invariant', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type Box<T> { value: T }
examples {
 fixture numeric: Box<Number> = Box<Number> { value: 1 }
 fixture broad: Box<Number | Text> = numeric
}`);
    expressions.available('numeric');
    expressions.checkValue('broad');
    expressions.expectProblem('incompatible-type', 'numeric');
  });

  it('does not silently unwrap an optional value', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`examples {
 fixture maybe: Number? = 1
 fixture count: Number = maybe
}`);
    expressions.available('maybe');
    expressions.checkValue('count');
    expressions.expectProblem('incompatible-type', 'maybe');
  });

  it('distinguishes Number, Text and Boolean values', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`examples {
 fixture count: Number = true
 fixture title: Text = 1
 fixture flag: Boolean = "true"
}`);
    expressions.checkValue('count');
    expressions.expectProblem('incompatible-type', 'true');
    expressions.checkValue('title');
    expressions.expectProblem('incompatible-type', '1');
    expressions.checkValue('flag');
    expressions.expectProblem('incompatible-type', '"true"');
  });

  it('checks arithmetic, ordering and Boolean operators without evaluating values', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`examples {
 fixture number: Number = -(2 + 3) * 4 / 2 % 3
 fixture flag: Boolean = 2 < 3 and not false or true
}`);
    expressions.typeOf('number');
    expressions.expectType('Number');
    expressions.typeOf('flag');
    expressions.expectType('Boolean');
    expressions.checkCondition('flag');
    expressions.expectValid();
    expressions.checkExpectation('flag');
    expressions.expectValid();
  });

  it('rejects Text arithmetic and Number Boolean operands', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`examples {
 fixture sum: Number = "two" + 1
 fixture flag: Boolean = 1 and true
}`);
    expressions.typeOf('sum');
    expressions.expectProblem('invalid-operator');
    expressions.typeOf('flag');
    expressions.expectProblem('invalid-operator');
  });

  it('requires Boolean conditions and expectations', () => {
    const expressions = new ExpressionChecking();
    expressions.source('examples { fixture count: Number = 1 }');
    expressions.checkCondition('count');
    expressions.expectProblem('invalid-purpose');
    expressions.checkExpectation('count');
    expressions.expectProblem('invalid-purpose');
  });

  it('allows an explicit Nothing call only as a call', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`function stop() returns Nothing
examples { fixture stopped: Number = stop() }`);
    expressions.checkCall('stopped');
    expressions.expectValid();
    expressions.typeOf('stopped');
    expressions.expectProblem('invalid-purpose');
    expressions.checkCondition('stopped');
    expressions.expectProblem('invalid-purpose');
  });

  it('does not require a result declaration for a call used only as a call', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`function save()
examples { fixture saved: Number = save() }`);
    expressions.checkCall('saved');
    expressions.expectValid();
    expressions.typeOf('saved');
    expressions.expectNoProblems();
    expressions.expectDeferred('declared-result');
    expressions.checkCondition('saved');
    expressions.expectNoProblems();
    expressions.expectDeferred('declared-result');
  });

  it('accepts a check invocation as an expectation without turning it into Boolean', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`examples {
 check positive(count: Number) { assert count > 0 }
 fixture checked: Boolean = positive(1)
}`);
    expressions.checkExpectation('checked');
    expressions.expectValid();
    expressions.typeOf('checked');
    expressions.expectProblem('invalid-purpose');
    expressions.checkCondition('checked');
    expressions.expectProblem('invalid-purpose');
    expressions.checkCall('checked');
    expressions.expectProblem('invalid-purpose');
  });

  it('rejects a bare value or callable name as a call', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`function count() returns Number
examples {
 fixture literal: Number = 1
 fixture callable: Number = count
}`);
    expressions.checkCall('literal');
    expressions.expectProblem('invalid-purpose');
    expressions.checkCall('callable');
    expressions.expectProblem('invalid-purpose');
  });

  it('checks parameter and contextual result conditions while retaining authored promises', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`function multiply(a: Number, b: Number) returns Number {
 requires a >= 0 and b >= 0
 ensures result >= 0
 promises "returns their product"
}`);
    expressions.checkContract('multiply');
    expressions.expectValid();
    expressions.expectPromises(['returns their product']);
  });

  it('rejects a non-Boolean contract condition', () => {
    const expressions = new ExpressionChecking();
    expressions.source('function count() returns Number { ensures 1 }');
    expressions.checkContract('count');
    expressions.expectProblem('invalid-purpose', '1');
  });

  it('has no contextual result in a precondition', () => {
    const expressions = new ExpressionChecking();
    expressions.source('function count() returns Number { requires result > 0 }');
    expressions.checkContract('count');
    expressions.expectProblem('unavailable-value', 'result');
  });

  it('has no contextual result when the output aliases Nothing', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type NoResult = Nothing
function stop() returns NoResult { ensures result == result }`);
    expressions.checkContract('stop');
    expressions.expectProblem('unavailable-value', 'result');
  });

  it('defers an ensures result until the callable output is declared', () => {
    const expressions = new ExpressionChecking();
    expressions.source('function count() { ensures result > 0 }');
    expressions.checkContract('count');
    expressions.expectNoProblems();
    expressions.expectDeferred('declared-result');
  });

  it('uses an ordinary parameter named result in a precondition', () => {
    const expressions = new ExpressionChecking();
    expressions.source('function count(result: Number) returns Number { requires result > 0 }');
    expressions.checkContract('count');
    expressions.expectValid();
  });

  it('reports a parameter that conflicts with the contextual ensures result', () => {
    const expressions = new ExpressionChecking();
    expressions.source('function count(result: Number) returns Number { ensures result > 0 }');
    expressions.checkContract('count');
    expressions.expectProblem('result-conflict', 'result: Number');
  });

  it('distinguishes a bodyless source contract from an unavailable external contract', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`use remote from "service"
function localCount() returns Number`);
    expressions.externalModule('service', [{ kind: 'function', name: 'remote', parameters: [], result: { kind: 'builtin', name: 'Number' } }]);
    expressions.checkContract('localCount');
    expressions.expectValid();
    expressions.checkContract('remote');
    expressions.expectNoProblems();
    expressions.expectDeferred('contract-body');
  });
  it('allows a parameter default to read an earlier parameter', () => {
    const expressions = new ExpressionChecking();
    expressions.source('function resize(width: Number, height: Number = width) returns Number');
    expressions.checkDefault('resize', 'height');
    expressions.expectValid();
  });

  it('does not make the current or a later parameter available to its default', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`function self(count: Number = count) returns Number
function forward(width: Number = height, height: Number = 2) returns Number`);
    expressions.checkDefault('self', 'count');
    expressions.expectProblem('unavailable-value', 'count');
    expressions.checkDefault('forward', 'width');
    expressions.expectProblem('unavailable-value', 'height');
  });

  it('allows an earlier ordinary parameter named result in a default', () => {
    const expressions = new ExpressionChecking();
    expressions.source('function copy(result: Number, count: Number = result) returns Number');
    expressions.checkDefault('copy', 'count');
    expressions.expectValid();
  });

  it('does not introduce contextual result in a default', () => {
    const expressions = new ExpressionChecking();
    expressions.source('function count(value: Number = result) returns Number');
    expressions.checkDefault('count', 'value');
    expressions.expectProblem('unavailable-value', 'result');
  });

  it('allows an explicitly available fixture in a helper parameter default', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`examples {
 fixture initial: Number = 2
 observation count(value: Number = initial) returns Number
}`);
    expressions.available('initial');
    expressions.checkDefault('count', 'value');
    expressions.expectValid();
    expressions.available();
    expressions.checkDefault('count', 'value');
    expressions.expectProblem('unavailable-value', 'initial');
  });

  it('does not assume a record instance makes sibling fields visible in defaults', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type Settings {
 count: Number = 1
 duplicate: Number = count
}`);
    expressions.checkDefault('Settings', 'duplicate');
    expressions.expectProblem('unavailable-value', 'count');
  });

  it('uses the supplied availability for each independent expression query', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`examples {
 fixture count: Number = 2
 fixture selected: Number = count
}`);
    expressions.typeOf('selected');
    expressions.expectProblem('unavailable-value', 'count');
    expressions.available('count');
    expressions.typeOf('selected');
    expressions.expectType('Number');
    expressions.available();
    expressions.typeOf('selected');
    expressions.expectProblem('unavailable-value', 'count');
  });

  it('substitutes a generic receiver type when selecting a field', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type Box<T> { value: T }
examples {
 fixture box: Box<Number> = Box<Number> { value: 2 }
 fixture selected: Number = box.value
}`);
    expressions.available('box');
    expressions.typeOf('selected');
    expressions.expectType('Number');
  });

  it('reports a field absent from a known receiver', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type Box<T> { value: T }
examples {
 fixture box: Box<Number> = Box<Number> { value: 2 }
 fixture selected: Number = box.missing
}`);
    expressions.available('box');
    expressions.typeOf('selected');
    expressions.expectProblem('invalid-member', 'missing');
  });

  it('requires a nonoptional receiver for field access', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type Box<T> { value: T }
examples {
 fixture box: Box<Number>? = Box<Number> { value: 2 }
 fixture selected: Number = box.value
}`);
    expressions.available('box');
    expressions.typeOf('selected');
    expressions.expectProblem('invalid-member');
  });

  it('does not invent fields on an opaque receiver', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`opaque type Secret
function load() returns Secret
examples {
 fixture secret: Secret = load()
 fixture selected: Text = secret.title
}`);
    expressions.available('secret');
    expressions.typeOf('selected');
    expressions.expectProblem('invalid-member', 'title');
  });

  it('respects private fields in supplied external records', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`use Settings, load from "settings"
examples {
 fixture settings: Settings = load()
 fixture selected: Text = settings.title
}`);
    expressions.externalModule('settings', [
      { kind: 'record-type', name: 'Settings', fields: [
        { kind: 'field', name: 'title', local: true, type: { kind: 'builtin', name: 'Text' } },
      ] },
      { kind: 'function', name: 'load', parameters: [], result: { kind: 'named', path: ['Settings'] } },
    ]);
    expressions.available('settings');
    expressions.typeOf('selected');
    expressions.expectProblem('invalid-member', 'title');
  });

  it('selects a public capability through a namespace and a known instance', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`concept Counter {
 public count
 capability count() returns Number
}
function create() returns Counter
examples {
 fixture counter: Counter = create()
 fixture namespaceCall: Number = Counter.count()
 fixture instanceCall: Number = counter.count()
}`);
    expressions.available('counter');
    expressions.typeOf('namespaceCall');
    expressions.expectType('Number');
    expressions.typeOf('instanceCall');
    expressions.expectType('Number');
  });

  it('checks record equality statically without computing true or false', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type Settings { count: Number }
examples { fixture equal: Boolean = Settings { count: 2 } == Settings { count: 3 } }`);
    expressions.typeOf('equal');
    expressions.expectType('Boolean');
    expressions.checkExpectation('equal');
    expressions.expectValid();
  });

  it('supports structural equality across recursive record fields and lists', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`type Tree { children: List<Tree> }
examples { fixture equal: Boolean = Tree { children: [] } == Tree { children: [] } }`);
    expressions.typeOf('equal');
    expressions.expectType('Boolean');
  });

  it('compares available optional and union values only when their alternatives are comparable', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`examples {
 fixture first: (Number | Text)? = 1
 fixture second: (Number | Text)? = "two"
 fixture equal: Boolean = first == second
}`);
    expressions.available('first', 'second');
    expressions.typeOf('equal');
    expressions.expectType('Boolean');
  });

  it('requires equality operands to be assignment compatible in at least one direction', () => {
    const expressions = new ExpressionChecking();
    expressions.source('examples { fixture equal: Boolean = 1 == "1" }');
    expressions.typeOf('equal');
    expressions.expectProblem('invalid-operator');
  });

  it('does not provide equality for opaque values', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`opaque type Secret
function load() returns Secret
examples { fixture equal: Boolean = load() == load() }`);
    expressions.typeOf('equal');
    expressions.expectProblem('invalid-operator');
  });

  it('does not provide equality for concept instances', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`concept Counter {}
function create() returns Counter
examples { fixture equal: Boolean = create() == create() }`);
    expressions.typeOf('equal');
    expressions.expectProblem('invalid-operator');
  });

  it('matches exact numeric literals across equivalent decimal spellings and a unary sign', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`examples {
 fixture decimal: 1 = 1.0
 fixture exponent: 1 = 1e0
 fixture negative: -1 = (-1)
}`);
    expressions.checkValue('decimal');
    expressions.expectValid();
    expressions.checkValue('exponent');
    expressions.expectValid();
    expressions.checkValue('negative');
    expressions.expectValid();
  });

  it('does not constant fold arithmetic into a singleton literal type', () => {
    const expressions = new ExpressionChecking();
    expressions.source('examples { fixture negative: -1 = 0 - 1 }');
    expressions.checkValue('negative');
    expressions.expectProblem('incompatible-type', '0 - 1');
  });

  it('keeps adjacent large integer literals distinct without host number rounding', () => {
    const expressions = new ExpressionChecking();
    expressions.source('examples { fixture precise: 9007199254740992 = 9007199254740993 }');
    expressions.checkValue('precise');
    expressions.expectProblem('incompatible-type', '9007199254740993');
  });

  it('retains the original missing-reference cause beside an independent missing result declaration', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`function unknown()
function combine(a: Number, b: Number) returns Number
examples {
 fixture total: Number = combine(missing, unknown())
 fixture independent: Number = 2
}`);
    expressions.typeOf('total');
    expressions.expectOriginalProblem('unresolved-reference');
    expressions.expectDeferred('declared-result');
    expressions.typeOf('independent');
    expressions.expectType('Number');
  });

  it('retains the original source composition prerequisite for an unavailable value', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`include "./values.expec"
examples { fixture selected: Number = imported }`);
    expressions.typeOf('selected');
    expressions.expectNoProblems();
    expressions.expectOriginalRequirement('composition');
  });

  it('keeps signature errors in contract checking even when no clause uses the parameter', () => {
    const expressions = new ExpressionChecking();
    expressions.source('function broken(count: Number = 1, required: Number) returns Number { ensures true }');
    expressions.checkContract('broken');
    expressions.expectOriginalProblem('required-after-default');
  });

  it('keeps unresolved parameter types in contract checking even without a body', () => {
    const expressions = new ExpressionChecking();
    expressions.source('function broken(value: Missing) returns Number');
    expressions.checkContract('broken');
    expressions.expectOriginalProblem('unresolved-reference');
  });

  it('keeps a possible deferred record alternative from becoming a unique choice', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`include "./types.expec"
type Settings { count: Number }
type Pending { count: ImportedType }
examples { fixture selected: Settings | Pending = { count: 2 } }`);
    expressions.checkValue('selected');
    expressions.expectNoProblems();
    expressions.expectOriginalRequirement('composition');
  });
  it('uses a fixture declaration supplied by the value scope without checking its initializer', () => {
    const expressions = new ExpressionChecking();
    expressions.source(`examples {
 fixture declared: Number = "invalid initializer"
 fixture selected: Number = declared
}`);
    expressions.available('declared');
    expressions.typeOf('selected');
    expressions.expectType('Number');
    expressions.expectScopeReference('declared');
    expressions.checkValue('declared');
    expressions.expectProblem('incompatible-type', '"invalid initializer"');
  });
});
