import { describe, it } from 'vitest';
import { CheckedQueries } from '../../dsl/compiler/checked-queries.js';

describe('asking which declared operation a checked call selects', () => {
  it('lets test and documentation consumers select the same imported operation', () => {
    const language = new CheckedQueries();
    language.source('examples', `use Shop.addBook as add from "shop"
examples { scenario "add a book" {
  when add("Dune")
  then true
} }`);
    language.module('shop', `concept Shop {
  public addBook
  capability addBook(title: Text) returns Nothing
}`);
    language.compile();

    language.collectOperationForTests('add("Dune")');
    language.collectOperationForDocumentation('add("Dune")');

    language.expectBothConsumersToSelect('shop:Shop.addBook');
    language.expectAuthoredCallee('add("Dune")', 'add');
    language.expectAuthoredArguments('add("Dune")', ['"Dune"']);
    language.expectCallOrigin('add("Dune")', { module: 'examples', sourceId: 'examples.expec' });
  });

  it('retains each nested call independently', () => {
    const language = new CheckedQueries();
    language.source('game', `function normalize(title: Text) returns Text
function add(title: Text) returns Nothing
examples { scenario "normalized title" {
  when add(normalize("Dune"))
  then true
} }`);
    language.compile();

    language.expectSelectedOperation('add(normalize("Dune"))', 'game:add');
    language.expectSelectedOperation('normalize("Dune")', 'game:normalize');
    language.expectAuthoredArguments('add(normalize("Dune"))', ['normalize("Dune")']);
  });

  it('accepts grouping without losing the selected inner operation', () => {
    const language = new CheckedQueries();
    language.source('game', `function save() returns Nothing
examples { example "save": ((save)()) => satisfies "The save survives restart" }`);
    language.compile();

    language.expectSelectedOperation('((save)())', 'game:save');
    language.expectProseExpectation('save', 'The save survives restart');
    language.expectDeclaredBody('game:save', 'absent');
  });

  it('keeps omitted defaults in the declaration rather than synthesizing arguments', () => {
    const language = new CheckedQueries();
    language.source('game', `function add(title: Text, quantity: Number = 1) returns Nothing
examples { scenario "one copy" {
  when add("Dune")
  then true
} }`);
    language.compile();

    language.expectSelectedOperation('add("Dune")', 'game:add');
    language.expectAuthoredArguments('add("Dune")', ['"Dune"']);
    language.expectParameterDefault('game:add', 'quantity', '1');
  });

  it('selects an accepted effect even when the declaration does not promise a result', () => {
    const language = new CheckedQueries();
    language.source('game', `function save()
examples { scenario "save" {
  when save()
  then true
} }`);
    language.compile();

    language.expectSelectedOperation('save()', 'game:save');
    language.expectDeclaredResult('game:save', 'unspecified');
    language.expectStepCapture('save', 0, undefined);
  });

  it('retains calls in both sides of a short example', () => {
    const language = new CheckedQueries();
    language.source('game', `function actual() returns Number
function expected() returns Number
examples { example "same count": actual() => expected() }`);
    language.compile();

    language.expectSelectedOperation('actual()', 'game:actual');
    language.expectSelectedOperation('expected()', 'game:expected');
  });

  it('retains a call that produces a receiver for another call', () => {
    const language = new CheckedQueries();
    language.source('game', `concept Basket {
  public add
  capability add(title: Text) returns Nothing
}
function open() returns Basket
examples { scenario "computed receiver" {
  when open().add("Dune")
  then true
} }`);
    language.compile();

    language.expectSelectedOperation('open()', 'game:open');
    language.expectSelectedOperation('open().add("Dune")', 'game:Basket.add');
  });
});

describe('reading captured values at the correct scenario step', () => {
  it('retains capture identity and type before and after each producing step', () => {
    const language = new CheckedQueries();
    language.source('game', `concept Basket {
  public add
  capability add(title: Text) returns Number
}
examples {
  setup open() returns Basket
  check hasQuantity(actual: Number, expected: Number)
  scenario "add a book" {
    given basket = open()
    when count = basket.add("Dune")
    then hasQuantity(count, 1)
  }
}`);
    language.compile();

    language.expectAvailableCaptures('add a book', 0, []);
    language.expectStepCapture('add a book', 0, { name: 'basket', type: 'Basket' });
    language.expectAvailableCaptures('add a book', 1, [{ name: 'basket', type: 'Basket' }]);
    language.expectStepCapture('add a book', 1, { name: 'count', type: 'Number' });
    language.expectAvailableCaptures('add a book', 2, [
      { name: 'basket', type: 'Basket' }, { name: 'count', type: 'Number' },
    ]);
    language.expectStepCapture('add a book', 2, undefined);
    language.expectCaptureHandleIsAuthoredName('add a book', 0);
    language.expectSelectedOperation('basket.add("Dune")', 'game:Basket.add');
    language.expectSelectedOperation('hasQuantity(count, 1)', 'game:examples[0].hasQuantity');
    language.expectOriginalReceiverBindingStillDeferred('basket.add("Dune")');
  });

  it('keeps fixtures available through their own checked declarations, not capture lists', () => {
    const language = new CheckedQueries();
    language.source('game', `examples {
  fixture title: Text = "Dune"
  action add(title: Text) returns Nothing
  scenario "fixture title" {
    when add(title)
    then true
  }
}`);
    language.compile();

    language.expectAvailableCaptures('fixture title', 0, []);
    language.expectStepCapture('fixture title', 0, undefined);
    language.expectSelectedOperation('add(title)', 'game:examples[0].add');
    language.expectArgumentReferenceTargetsFixture('add(title)', 'title');
    language.expectFixtureType('title', 'Text');
  });

  it('isolates equal capture names in separate scenarios even when queried in reverse order', () => {
    const language = new CheckedQueries();
    language.source('game', `examples {
  action number() returns Number
  action title() returns Text
  scenario "number" {
    when result = number()
    then result == 1
  }
  scenario "title" {
    when result = title()
    then result == "Dune"
  }
}`);
    language.compile();

    language.expectAvailableCaptures('title', 1, [{ name: 'result', type: 'Text' }]);
    language.expectAvailableCaptures('number', 1, [{ name: 'result', type: 'Number' }]);
    language.expectAvailableCaptures('title', 0, []);
    language.expectAvailableCaptures('number', 0, []);
    language.expectDistinctCaptureHandles('number', 0, 'title', 0);
  });

  it('does not make a future capture available to an earlier step', () => {
    const language = new CheckedQueries();
    language.source('game', `examples {
  setup useBasket(basket: Text) returns Nothing
  action open() returns Text
  scenario "too early" {
    given useBasket(basket)
    when basket = open()
    then true
  }
}`);
    language.compile();

    language.expectProblemAt('unavailable-value', 'basket', 'useBasket(basket)');
    language.expectNoSpecification();
  });

  it('does not use a hidden fixture to supply a capture its own initializer', () => {
    const language = new CheckedQueries();
    language.source('game', `examples {
  fixture count: Number = 1
  action next(previous: Number) returns Number
  scenario "self use" {
    when count = next(count)
    then true
  }
}`);
    language.compile();

    language.expectProblemAt('unavailable-value', 'count', 'next(count)');
    language.expectNoSpecification();
  });

  it('does not publish duplicate capture answers', () => {
    const language = new CheckedQueries();
    language.source('game', `examples {
  action number() returns Number
  scenario "duplicate" {
    when count = number()
    when count = number()
    then true
  }
}`);
    language.compile();

    language.expectProblemAtOccurrence('duplicate-capture', 'count', 1);
    language.expectNoSpecification();
  });

  it('does not publish a typed capture from a producer used in the wrong role', () => {
    const language = new CheckedQueries();
    language.source('game', `examples {
  observation count() returns Number
  scenario "wrong producer" {
    when actual = count()
    then actual == 1
  }
}`);
    language.compile();

    language.expectProblemAt('invalid-step-role', 'count()', 'when actual = count()');
    language.expectNoSpecification();
  });

  it('keeps a missing captured result type explicit', () => {
    const language = new CheckedQueries();
    language.source('game', `examples {
  action save()
  scenario "missing result" {
    when saved = save()
    then true
  }
}`);
    language.compile();

    language.expectRequirementAt('declared-result', 'save()');
    language.expectNoSpecification();
  });
});

describe('retaining calls across the existing checked language contexts', () => {
  it('retains calls in parameter and field defaults without evaluating either default', () => {
    const language = new CheckedQueries();
    language.source('game', `function initial() returns Number
function next(value: Number) returns Number
function save(first: Number, second: Number = next(first)) returns Nothing
type Counter { count: Number = initial() }`);
    language.compile();

    language.expectSelectedOperation('next(first)', 'game:next');
    language.expectSelectedOperation('initial()', 'game:initial');
    language.expectParameterDefault('game:save', 'second', 'next(first)');
    language.expectDeclaredBody('game:initial', 'absent');
  });

  it('retains calls checked with parameters and the contextual contract result', () => {
    const language = new CheckedQueries();
    language.source('game', `function positive(value: Number) returns Boolean
function increase(amount: Number) returns Number {
  requires positive(amount)
  ensures positive(result)
}`);
    language.compile();

    language.expectSelectedOperation('positive(amount)', 'game:positive');
    language.expectSelectedOperation('positive(result)', 'game:positive');
    language.expectOriginalResultBindingStillDeferred('positive(result)');
  });

  it('retains a nested call in a declared message using an earlier reply value', () => {
    const language = new CheckedQueries();
    language.source('game', `concept Shop {
  public count, consume
  capability count() returns Number
  capability consume(value: Number) returns Nothing
}
function double(value: Number) returns Number
interaction "send count"() {
  participant shopper: Shop
  participant store: Shop
  message shopper -> store.count() as count
  message shopper -> store.consume(double(count))
}`);
    language.compile();

    language.expectSelectedOperation('double(count)', 'game:double');
    language.expectSelectedMessageOperation('send count', 1, 'game:Shop.consume');
    language.expectNoScenarioStepForMessage('send count', 1);
  });

  it('retains nested calls in collection and record arguments', () => {
    const language = new CheckedQueries();
    language.source('game', `type Book { title: Text }
function title() returns Text
function count() returns Number
function save(book: Book, copies: List<Number>) returns Nothing
examples { scenario "nested values" {
  when save({ title: title() }, [count()])
  then true
} }`);
    language.compile();

    language.expectSelectedOperation('title()', 'game:title');
    language.expectSelectedOperation('count()', 'game:count');
    language.expectSelectedOperation('save({ title: title() }, [count()])', 'game:save');
  });

  it('uses actual composed ownership and preserves the extension declaration identity', () => {
    const language = new CheckedQueries();
    language.source('caller', `use Store.save as persist from "store"
examples { scenario "save" {
  when persist("snapshot")
  then true
} }`);
    language.module('store', 'include "saving"\nconcept Store {}');
    language.module('saving', `use Store from "store"
extend Store {
  public save
  capability save(snapshot: Text) returns Nothing
}`);
    language.compileComposed();

    language.expectSelectedOperation('persist("snapshot")', 'saving:save');
    language.expectSelectedOperationOwner('persist("snapshot")', 'store:Store');
    language.expectSelectedOperationOrigin('persist("snapshot")', { module: 'saving', sourceId: 'saving.expec' });
  });

  it('keeps an unspecified authored return pending before exposing call queries', () => {
    const language = new CheckedQueries();
    language.source('game', `examples {
  action save() { return 1 }
  scenario "save" {
    when save()
    then true
  }
}`);
    language.compile();

    language.expectRequirement('declared-result');
    language.expectNoSpecification();
  });
});

describe('query identity, isolation and error boundaries', () => {
  it('keeps earlier answers after the same compiler compiles another input', () => {
    const language = new CheckedQueries();
    language.source('game', `function count() returns Number
examples { scenario "count" {
  when result = count()
  then result == 1
} }`);
    language.compile();
    language.rememberSpecificationAndAnswers('count()', 'count', 1);

    language.source('game', `function count() returns Text
examples { scenario "count" {
  when result = count()
  then result == "Dune"
} }`);
    language.compileUsingSameCompiler();

    language.expectAvailableCaptures('count', 1, [{ name: 'result', type: 'Text' }]);
    language.expectRememberedAnswersUnchanged();
    language.expectRememberedCaptureType('result', 'Number');
    language.expectFreshCurrentHandles();
  });

  it('does not let a consumer mutate capture facts seen by another consumer', () => {
    const language = new CheckedQueries();
    language.source('game', `examples {
  action count() returns Number
  scenario "count" {
    when result = count()
    then result == 1
  }
}`);
    language.compile();
    language.rememberStepAnswer('count', 1);
    language.tryToMutateReturnedCaptures('count', 1);

    language.expectAvailableCaptures('count', 1, [{ name: 'result', type: 'Number' }]);
    language.expectRememberedStepAnswerUnchanged();
    language.expectStepCapture('count', 0, { name: 'result', type: 'Number' });
  });

  it('distinguishes wrong query kinds from source diagnostics', () => {
    const language = new CheckedQueries();
    language.source('game', 'opaque type Token\nexamples { example "number": (8) => 8 }');
    language.compile();

    language.expectCallQueryErrorForDeclaration('Token', 'unexpected-kind');
    language.expectCallQueryErrorForExpression('(8)', 'unexpected-kind');
    language.expectStepQueryErrorForExample('number', 'unexpected-kind');
    language.expectNoCompilerProblems();
  });

  it('rejects call and step handles from another successful compilation', () => {
    const language = new CheckedQueries();
    language.source('game', `function save() returns Nothing
examples { scenario "save" {
  when save()
  then true
} }`);
    language.compile();
    language.rememberSpecificationAndHandles();
    language.compileFresh();

    language.expectCallQueryErrorForRememberedHandle('save()', 'foreign-node');
    language.expectStepQueryErrorForRememberedHandle('save', 0, 'foreign-node');
    language.expectRememberedSelectedOperation('save()', 'game:save');
  });
});
