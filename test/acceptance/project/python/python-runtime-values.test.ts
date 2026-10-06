import { afterEach, describe, it } from 'vitest';
import { PythonRuntimeValues } from '../../../dsl/project/python/python-runtime-values.js';

afterEach(() => PythonRuntimeValues.dispose());
describe('Python acceptance observes actual returned values and independent application state', { timeout: 240_000 }, () => {
  it('returns the actual operation result rather than reconstructing it from basket quantity', async () => {
    const p = await PythonRuntimeValues.create();
    p.source(`type Receipt { copies: Number }
examples {
  setup available(title: Text) returns Nothing
  action add(title: Text) returns Receipt
  observation receiptCopies(receipt: Receipt) returns Number
  observation quantity(title: Text) returns Number
  check expectReceipt(receipt: Receipt, expected: Number) {
    let actual = receiptCopies(receipt)
    assert actual == expected
  }
  scenario "the returned receipt differs from basket quantity" {
    given available("Dune")
    when receipt = add("Dune")
    then expectReceipt(receipt, 7)
    then quantity("Dune") == 1
  }
}`);
    await p.generateReceiptContract(); await p.generateTests(); await p.returnReceipt(7);
    await p.run();
    p.expectPassed(1); p.expectCapturedResult({ copies: 7 }); p.expectBasketQuantity('Dune', 1);
  });

  it('accepts an exact integer count but rejects Boolean as Number', async () => {
    const p = await PythonRuntimeValues.create();
    p.source('examples { observation current() returns Number\nexample "one copy": current() => 1 }');
    await p.generateTests();
    await p.observeNumber('1'); await p.run(); p.expectPassed(1);
    await p.observeNumber('True'); await p.run(); p.expectInvalidNumber('bool');
  });

  it('rejects inexact large integers and nonfinite numeric observations without invoking hooks', async () => {
    const p = await PythonRuntimeValues.create();
    p.source('examples { observation current() returns Number\nexample "one copy": current() => 1 }');
    await p.generateTests();
    await p.observeNumber('9007199254740993'); await p.run(); p.expectInvalidNumber('int'); p.expectNoConversionHooksCalled();
    await p.observeNumber('float("nan")'); await p.run(); p.expectInvalidNumber('float'); p.expectNoConversionHooksCalled();
    await p.observeNumber('float("inf")'); await p.run(); p.expectInvalidNumber('float'); p.expectNoConversionHooksCalled();
    await p.observeNumber('HookedNumber(1)'); await p.proveConversionHookIsExecutable();
    await p.run(); p.expectInvalidNumber('HookedNumber'); p.expectNoConversionHooksCalled();
  });

  it('rejects a hostile integer and overflowing observation without native conversion failures', async () => {
    const p = await PythonRuntimeValues.create();
    p.source('examples { observation current() returns Number\nexample "one copy": current() => 1 }');
    await p.generateTests();
    await p.observeNumber('HookedInteger(1)'); await p.proveConversionHookIsExecutable('HookedInteger');
    await p.run(); p.expectInvalidNumber('HookedInteger'); p.expectNoConversionHooksCalled();
    await p.observeNumber('10 ** 10000'); await p.run();
    p.expectInvalidNumber('int'); p.expectNoConversionHooksCalled(); p.expectNoNativeOverflow();
  });

  it('creates two live drivers with separate baskets and starts the second scenario empty', async () => {
    const p = await PythonRuntimeValues.create();
    p.source(`examples {
  setup available(title: Text) returns Nothing
  action add(title: Text) returns Nothing
  observation quantity(title: Text) returns Number
  scenario "first shopper" {
    given available("Dune")
    when add("Dune")
    then quantity("Dune") == 1
  }
  scenario "second shopper" {
    given available("Dune")
    when add("Dune")
    then quantity("Dune") == 1
  }
}`);
    await p.generateTests(); await p.useIndependentBaskets(); await p.run();
    p.expectPassed(2); p.expectDistinctLiveDrivers(2); p.expectSecondStartingQuantity('Dune', 0);
  });
});
