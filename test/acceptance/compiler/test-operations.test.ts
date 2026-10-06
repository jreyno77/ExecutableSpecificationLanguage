import { describe, it } from 'vitest';
import { OperationExamples } from '../../dsl/compiler/test-operations.js';

describe('reusable test operations remain readable contracts', () => {
  it('keeps bodyless runtime operations available without inventing implementations', () => {
    const language = new OperationExamples();
    language.source('examples { setup available(title: Text)\naction add(title: Text)\nobservation quantity(title: Text) returns Number\ncheck expectQuantity(actual: Number, expected: Number) }');
    language.checkAllOperations();
    language.expectAcceptedOperations(['available', 'add', 'quantity', 'expectQuantity']);
    language.expectBodiesAbsent(['available', 'add', 'quantity', 'expectQuantity']);
    language.expectNoRuntimeOrProjectEffects();
  });

  it('preserves a runtime observation and the independently authored expected quantity', () => {
    const language = new OperationExamples();
    language.source(`examples {
  observation quantity(title: Text) returns Number
  check expectQuantity(title: Text, expected: Number) {
    let actual = quantity(title)
    assert actual == expected
  }
  scenario "Dune quantity" {
    when add("Dune")
    then expectQuantity("Dune", 1)
  }
  action add(title: Text)
}`);
    language.compile();
    language.expectCompiled();
    language.expectCallTarget('quantity(title)', 'quantity');
    language.expectCallTarget('expectQuantity("Dune", 1)', 'expectQuantity');
    language.expectAuthoredArguments('expectQuantity("Dune", 1)', ['"Dune"', '1']);
    language.expectStatements('expectQuantity', ['let actual = quantity(title)', 'assert actual == expected']);
    language.expectNoRuntimeOrProjectEffects();
  });

  it('checks an ordered composition without executing its effects', () => {
    const language = new OperationExamples();
    language.source(`function normalize(title: Text) returns Text
function persist(title: Text) returns Nothing
examples { action save(title: Text) returns Text {
  let normalized = normalize(title)
  do persist(normalized)
  return normalized
} }`);
    language.compile();
    language.expectCompiled();
    language.expectCallTarget('normalize(title)', 'normalize');
    language.expectCallTarget('persist(normalized)', 'persist');
    language.expectDeclaredResult('save', 'Text');
    language.expectNoRuntimeOrProjectEffects();
  });
});

describe('body scope is local and ordered', () => {
  it('rejects forward locals even when an outer fixture has that name', () => {
    const language = new OperationExamples();
    language.source(`examples {
  fixture count: Number = 1
  observation next() returns Number {
    let first = count
    let count = 2
    return first
  }
}`);
    language.checkOperation('next');
    language.expectProblemAt('unavailable-value', 'count', 'let first = count');
  });

  it('rejects self-reference rather than inventing the inferred local type', () => {
    const language = new OperationExamples();
    language.source('examples { observation number() returns Number {\nlet count = count\nreturn count\n} }');
    language.checkOperation('number');
    language.expectProblemAt('unavailable-value', 'count', 'let count = count');
    language.expectOriginalCauseRelatedTo('return count');
  });

  it('rejects a local that collides with a parameter', () => {
    const language = new OperationExamples();
    language.source('examples { observation number(count: Number) returns Number {\nlet count = 2\nreturn count\n} }');
    language.checkOperation('number');
    language.expectProblemAt('duplicate-local', 'count', 'let count = 2');
    language.expectRelatedParameter('number', 'count');
  });

  it('rejects duplicate locals at the second declaration', () => {
    const language = new OperationExamples();
    language.source('examples { observation number() returns Number {\nlet count = 1\nlet count = 2\nreturn count\n} }');
    language.checkOperation('number');
    language.expectProblemAt('duplicate-local', 'count', 'let count = 2');
    language.expectRelatedLocal('let count = 1');
  });

  it('preserves the cause of invalid fixture data used by a body', () => {
    const language = new OperationExamples();
    language.source('examples {\nfixture count: Number = "many"\nobservation number() returns Number { return count }\n}');
    language.checkOperation('number');
    language.expectProblemAt('incompatible-type', '"many"');
    language.expectOriginalCauseRelatedTo('return count');
  });

  it('treats result as an ordinary authored local', () => {
    const language = new OperationExamples();
    language.source('examples { observation number() returns Number {\nlet result = 1\nreturn result\n} }');
    language.compile();
    language.expectCompiled();
    language.expectStatements('number', ['let result = 1', 'return result']);
    language.expectNoSyntheticResultInBody();
  });

  it('uses the authored local type rather than a synthetic return value', () => {
    const language = new OperationExamples();
    language.source('examples { observation number() returns Number {\nlet result = "many"\nreturn result\n} }');
    language.checkOperation('number');
    language.expectProblemAt('incompatible-type', 'result', 'return result');
    language.expectNoSyntheticResultInBody();
  });

  it('does not supply a synthetic result before the body returns', () => {
    const language = new OperationExamples();
    language.source('function number() returns Number { ensures result >= 0 }\nexamples { observation stored() returns Number { return result } }');
    language.compile();
    language.expectProblemAt('unresolved-reference', 'result', 'return result');
    language.expectNoFindingIn('ensures result >= 0');
    language.expectNoSpecification();
  });
});

describe('returns and checks make their promises explicit', () => {
  it('checks an empty returned list using the declared element type', () => {
    const language = new OperationExamples();
    language.source('examples { observation titles() returns List<Text> { return [] } }');
    language.checkOperation('titles');
    language.expectAccepted();
    language.expectDeclaredResult('titles', 'List<Text>');
  });

  it('rejects a return that does not match its declared type', () => {
    const language = new OperationExamples();
    language.source('examples { observation number() returns Number { return "many" } }');
    language.checkOperation('number');
    language.expectProblemAt('incompatible-type', '"many"');
    language.expectNoProblem('missing-return');
  });

  it('rejects a value-producing body with no return', () => {
    const language = new OperationExamples();
    language.source('examples { observation number() returns Number { let value = 1 } }');
    language.checkOperation('number');
    language.expectDeclarationProblem('missing-return', 'number');
  });

  it('keeps an unspecified returned type pending rather than changing the signature', () => {
    const language = new OperationExamples();
    language.source('examples { observation number() { return 1 } }');
    language.checkOperation('number');
    language.expectRequirementAt('declared-result', 'return 1');
    language.expectDeclaredResult('number', 'unspecified');
  });

  it('rejects a returned value from a Nothing operation', () => {
    const language = new OperationExamples();
    language.source('examples { action save() returns Nothing { return 1 } }');
    language.checkOperation('save');
    language.expectProblemAt('invalid-return', 'return 1');
  });

  it('reports statements after a return and still retains an independent bad name', () => {
    const language = new OperationExamples();
    language.source('examples { observation number() returns Number {\nreturn 1\ndo missing()\n} }');
    language.checkOperation('number');
    language.expectProblemAt('unreachable-statement', 'do missing()');
    language.expectProblemAt('unresolved-reference', 'missing');
    language.expectNoProblem('missing-return');
  });

  it('does not make a local declared after return available to another statement', () => {
    const language = new OperationExamples();
    language.source('function consume(value: Number) returns Nothing\nexamples { observation number() returns Number {\nreturn 1\nlet after = 2\ndo consume(after)\n} }');
    language.checkOperation('number');
    language.expectProblemAt('unreachable-statement', 'let after = 2');
    language.expectProblemAt('unreachable-statement', 'do consume(after)');
    language.expectProblemAt('unavailable-value', 'after', 'do consume(after)');
    language.expectRelatedReturn('return 1');
    language.expectNoProblem('missing-return');
  });

  it('distinguishes an explicit empty action from a bodyless obligation', () => {
    const language = new OperationExamples();
    language.source('examples { action noWork() returns Nothing {}\naction implementMe() returns Nothing }');
    language.compile();
    language.expectCompiled();
    language.expectBody('noWork', 'available');
    language.expectBody('implementMe', 'absent');
  });

  it('rejects an empty check that would otherwise verify nothing', () => {
    const language = new OperationExamples();
    language.source('examples { check quantityIsCorrect() {} }');
    language.checkOperation('quantityIsCorrect');
    language.expectDeclarationProblem('missing-assertion', 'quantityIsCorrect');
  });

  it('rejects returning from a check instead of making an assertion', () => {
    const language = new OperationExamples();
    language.source('examples { check quantityIsCorrect() { return true } }');
    language.checkOperation('quantityIsCorrect');
    language.expectProblemAt('invalid-return', 'return true');
    language.expectDeclarationProblem('missing-assertion', 'quantityIsCorrect');
  });

  it('requires an assertion to be Boolean or a declared check', () => {
    const language = new OperationExamples();
    language.source('examples { check quantityIsCorrect() { assert 1 } }');
    language.checkOperation('quantityIsCorrect');
    language.expectProblemAt('invalid-purpose', '1');
  });

  it('composes one named check through an authored assertion', () => {
    const language = new OperationExamples();
    language.source('examples { check positive(value: Number)\ncheck valid(value: Number) { assert positive(value) } }');
    language.compile();
    language.expectCompiled();
    language.expectCallTarget('positive(value)', 'positive');
    language.expectBodiesAbsent(['positive']);
  });

  it('does not invoke a check as an effect', () => {
    const language = new OperationExamples();
    language.source('examples { check positive(value: Number)\naction act() { do positive(1) } }');
    language.checkOperation('act');
    language.expectProblemAt('invalid-purpose', 'positive(1)');
  });
});

describe('test operations compose through the real compiler', () => {
  it('checks a separately attached Dune scenario with its subject private type', () => {
    const language = new OperationExamples();
    language.source(`concept Shop {
  local type Stock {
    title: Text
    copies: Number
  }
}
examples for Shop from "./shopping.examples.expec"`, { sourceId: 'shop.expec', locator: 'shop.expec' });
    language.module('./shopping.examples.expec', `examples {
  fixture dune: Stock = { title: "Dune", copies: 1 }
  setup bookIsAvailable(book: Stock)
  setup emptyBasket()
  action addBook(title: Text)
  observation titleOf(book: Stock) returns Text { return book.title }
  observation quantity(title: Text) returns Number
  check expectQuantity(title: Text, expected: Number) {
    let actual = quantity(title)
    assert actual == expected
  }
  scenario "a shopper can add an available book" {
    given bookIsAvailable(dune)
    given emptyBasket()
    when addBook(titleOf(dune))
    then expectQuantity("Dune", 1)
  }
}`, { sourceId: 'shopping.examples.expec' });
    language.compile();
    language.expectCompiled();
    language.expectParameterType('titleOf', 'book', 'Shop.Stock');
    language.expectCallTarget('quantity(title)', 'quantity');
    language.expectCallTarget('titleOf(dune)', 'titleOf');
    language.expectAuthoredArguments('expectQuantity("Dune", 1)', ['"Dune"', '1']);
    language.expectDeclarationSource('expectQuantity', 'shopping.examples.expec');
  });

  it('keeps an attached body error at its original separate-file location', () => {
    const language = new OperationExamples();
    language.source('concept Shop { local type Stock { copies: Number } }\nexamples for Shop from "./shopping.examples.expec"',
      { sourceId: 'shop.expec', locator: 'shop.expec' });
    language.module('./shopping.examples.expec', 'examples { observation copies(book: Stock) returns Number { return "many" } }',
      { sourceId: 'shopping.examples.expec' });
    language.compile();
    language.expectProblemInFile('incompatible-type', '"many"', 'shopping.examples.expec');
    language.expectNoFindingInFile('shop.expec');
    language.expectNoSpecification();
  });

  it('retains calls in every statement position and in a local receiver', () => {
    const language = new OperationExamples();
    language.source(`concept Basket {
  public count
  capability count() returns Number
}
function basket() returns Basket
function next(value: Number) returns Number
function record(value: Number) returns Nothing
examples {
  observation nextCount() returns Number {
    let current = basket()
    let count = current.count()
    do record(next(count))
    return next(count + 1)
  }
  check positive() { assert nextCount() > 0 }
}`);
    language.compile();
    language.expectCompiled();
    language.expectCallTarget('basket()', 'basket');
    language.expectCallTarget('current.count()', 'Basket.count');
    language.expectCallTarget('record(next(count))', 'record');
    language.expectCallTarget('next(count)', 'next');
    language.expectCallTarget('next(count + 1)', 'next');
    language.expectCallTarget('nextCount()', 'nextCount');
    language.expectStatements('nextCount', [
      'let current = basket()', 'let count = current.count()',
      'do record(next(count))', 'return next(count + 1)',
    ]);
  });

  it('rejects an invalid authored operation even when nothing calls it', () => {
    const language = new OperationExamples();
    language.source('examples {\naction useful() returns Nothing {}\nobservation unused() returns Number { return "many" }\n}');
    language.compile();
    language.expectProblemAt('incompatible-type', '"many"');
    language.expectNoSpecification();
  });

  it('distinguishes checking one body from checking its callee body', () => {
    const language = new OperationExamples();
    language.source('examples {\nobservation broken() returns Number { return "many" }\nobservation caller() returns Number { return broken() }\n}');
    language.checkOperation('caller');
    language.expectAccepted();
    language.compile();
    language.expectProblemAt('incompatible-type', '"many"');
    language.expectNoSpecification();
  });

  it('leaves default-expression checking with the compiler phase that owns it', () => {
    const language = new OperationExamples();
    language.source('examples { action save(copies: Number = "many") returns Nothing {} }');
    language.checkOperation('save');
    language.expectAccepted();
    language.compile();
    language.expectProblemAt('incompatible-type', '"many"');
    language.expectNoSpecification();
  });

  it('can call an external signature without requesting its implementation body', () => {
    const language = new OperationExamples();
    language.externalFunction('shop', 'quantity', { inputs: { title: 'Text' }, result: 'Number' });
    language.source('use quantity from "shop"\nexamples { observation copies() returns Number { return quantity("Dune") } }');
    language.compile();
    language.expectCompiled();
    language.expectCallTarget('quantity("Dune")', 'quantity');
    language.expectBody('quantity', 'unavailable');
    language.expectNoRequirement('test-operation-body');
  });

});
