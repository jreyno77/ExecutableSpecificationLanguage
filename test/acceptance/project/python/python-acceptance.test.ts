import { afterEach, describe, it } from 'vitest';
import { PythonAcceptance } from '../../../dsl/project/python/python-acceptance.js';

afterEach(() => PythonAcceptance.dispose(), 30_000);
describe('readable Python acceptance tests that reach the application', { timeout: 240_000 }, () => {
  it('keeps negative remainders consistent with the authored arithmetic', async () => {
    const p = await PythonAcceptance.create();
    p.source(`examples {
      observation remainder(left: Number, right: Number) returns Number { return left % right }
      example "negative dividend": remainder(-5, 2) => -1
      example "negative divisor": remainder(5, -2) => 1
    }`);
    await p.generateTests(); await p.runTests(); p.expectPassed(2);
  });

  it('uses binary64 division and treats negative zero as zero', async () => {
    const p = await PythonAcceptance.create();
    p.source(`examples {
      observation divide(left: Number, right: Number) returns Number { return left / right }
      example "one divided by two": divide(1, 2) => 0.5
      example "negative zero": divide(-0, 2) => 0
    }`);
    await p.generateTests(); await p.runTests(); p.expectPassed(2);
  });

  it('keeps division by zero a failed executable expectation', async () => {
    const p = await PythonAcceptance.create();
    p.source(`examples {
      observation divide(left: Number, right: Number) returns Number { return left / right }
      example "division by zero": divide(1, 0) => 0
    }`);
    await p.generateTests(); await p.runTests(); p.expectArithmeticFailure('division');
  });

  it('updates an expected quantity while preserving the implemented driver and human edits', async () => {
    const shopping = await PythonAcceptance.create();
    shopping.aShopperCanAddAnAvailableBook('Dune', 1);
    await shopping.generateTests(); await shopping.implementBasket(1);
    await shopping.addReadableNativeEdits(); await shopping.rememberGeneratedFiles();
    shopping.reviseExpectedQuantity('Dune', 2);
    await shopping.updateTests();
    await shopping.expectRememberedImplementationUnchanged();
    await shopping.expectScenarioCommentRetained();
    await shopping.runTests(); shopping.expectWrongQuantity(1, 2);
  });
  it('rejects prior assertion drift even when the new specification would agree with it', async () => {
    const shopping = await PythonAcceptance.create();
    shopping.aShopperCanAddAnAvailableBook('Dune', 1);
    await shopping.generateTests(); await shopping.changeGeneratedQuantity(2);
    await shopping.rememberGeneratedFiles();
    shopping.reviseExpectedQuantity('Dune', 2);
    await shopping.tryUpdateTests(); shopping.expectUpdateProblem('generated-tests-changed');
    await shopping.expectRememberedFilesUnchanged();
  });
  it('a shopper can add an available Dune through the generated DSL and real driver', async () => {
    const shopping = await PythonAcceptance.create();
    shopping.aShopperCanAddAnAvailableBook('Dune', 1);
    await shopping.generateTests();
    await shopping.implementBasket(1);
    await shopping.runTests();
    shopping.expectPassed(1);
    shopping.expectReadableSteps(['shopping.bookIsAvailable("Dune")', 'shopping.startWithEmptyBasket()', 'shopping.addBook("Dune")', 'shopping.expectBookQuantity("Dune", 1.0)']);
  });
  it('fails when the real basket adds two copies instead of the specified one', async () => {
    const shopping = await PythonAcceptance.create();
    shopping.aShopperCanAddAnAvailableBook('Dune', 1);
    await shopping.generateTests();
    await shopping.implementBasket(2);
    await shopping.runTests();
    shopping.expectWrongQuantity(2, 1);
  });
  it('fails visibly while the generated driver is still unimplemented', async () => {
    const shopping = await PythonAcceptance.create();
    shopping.aShopperCanAddAnAvailableBook('Dune', 1);
    await shopping.generateTests();
    await shopping.runTests();
    shopping.expectUnimplemented('bookIsAvailable');
  });
  it('compares independent Book data while keeping an absent note distinct from None', async () => {
    const books = await PythonAcceptance.create();
    books.aBookRetainsItsDeclaredData();
    await books.generateBookContract();
    await books.generateTests();
    await books.observeBook('{"copies": 1, "title": "Dune"}');
    books.expectPassed(1);
    await books.observeBook('{"title": "Dune", "copies": 1, "note": None}');
    books.expectInvalidBook();
  });
  it('rejects two equally wrong observations when Number was declared', async () => {
    const numbers = await PythonAcceptance.create();
    numbers.numbersRetainTheirDeclaredMeaning();
    await numbers.generateTests();
    await numbers.observeTextAsNumbers();
    numbers.expectInvalidNumber();
  });
  it('starts each scenario with fresh explicit fixture data, including forward references', async () => {
    const books = await PythonAcceptance.create();
    books.source(`type Book { title: Text\ncopies: Number = 1 }
examples {
  fixture book: Book = { title: "Dune", copies: copies }
  fixture copies: Number = 2
  action take(book: Book) returns Number
  scenario "first reader" {
    when actual = take(book)
    then actual == 3
  }
  scenario "second reader" {
    when actual = take(book)
    then actual == 3
  }
}`);
    await books.generateBookContract();
    await books.generateTests();
    await books.implementTakingOneCopy();
    await books.runTests();
    books.expectPassed(2);
    await books.expectNativeTypesAgree();
  });
  it('compares tuple fixture positions without silently emitting a list', async () => {
    const positions = await PythonAcceptance.create();
    positions.source(`examples {
  fixture position: [Number, Number] = [1, 2]
  observation current() returns [Number, Number]
  example "current position": current() => position
}`);
    await positions.generateTests();
    await positions.observePosition('(1.0, 2.0)');
    positions.expectPassed(1);
    await positions.expectNativeTypesAgree();
    await positions.observePosition('(2.0, 1.0)');
    positions.expectComparisonFailed();
  });
  it('retains the authored prose and a visible verification obligation', async () => {
    const promise = await PythonAcceptance.create();
    promise.source('examples { example "persistent save": 8 * 8 => satisfies "the snapshot is persisted" }');
    await promise.generateTests();
    await promise.runTests();
    promise.expectVerificationRequired('the snapshot is persisted');
  });
  it('uses the observation type when comparing an inline tuple expectation', async () => {
    const positions = await PythonAcceptance.create();
    positions.source('examples { observation current() returns [Number, Number]\nexample "current position": current() => [1, 2] }');
    await positions.generateTests();
    await positions.observePosition('(1.0, 2.0)');
    positions.expectPassed(1);
    await positions.observePosition('(2.0, 1.0)');
    positions.expectComparisonFailed();
  });
  it('repeats generation without changing the implemented driver or readable tests', async () => {
    const shopping = await PythonAcceptance.create();
    shopping.aShopperCanAddAnAvailableBook('Dune', 1);
    await shopping.generateTests();
    await shopping.implementBasket(1);
    await shopping.rememberGeneratedFiles();
    await shopping.generateTests();
    shopping.expectNoEdits();
    await shopping.expectRememberedFilesUnchanged();
    await shopping.runTests(); shopping.expectPassed(1);
  });
  it('retains comments, equivalent import aliases and an unowned neighboring function', async () => {
    const shopping = await PythonAcceptance.create();
    shopping.aShopperCanAddAnAvailableBook('Dune', 1);
    await shopping.generateTests();
    await shopping.addReadableNativeEdits();
    await shopping.rememberGeneratedFiles();
    await shopping.generateTests(); shopping.expectNoEdits();
    await shopping.expectRememberedFilesUnchanged();
    await shopping.readScenario(); shopping.expectCompleteScenarioRead();
  });
  it('cannot certify coverage after an authored assertion was removed', async () => {
    const shopping = await PythonAcceptance.create();
    shopping.aShopperCanAddAnAvailableBook('Dune', 1);
    await shopping.generateTests();
    await shopping.removeExpectedQuantity();
    await shopping.readScenario();
    shopping.expectCoverageProblem('generated-tests-changed');
  });
});
