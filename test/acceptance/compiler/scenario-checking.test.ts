import { describe, it } from 'vitest';
import { ScenarioExamples } from '../../dsl/compiler/scenario-checking.js';

describe('checking examples and scenarios', () => {
  it("checks the shopper scenario without changing its authored steps", () => {
    const examples = new ScenarioExamples();
    examples.source(`concept Shopping {
    examples {
      setup bookIsAvailable(title: Text) returns Nothing
      setup startWithEmptyBasket() returns Nothing
      action addBook(title: Text) returns Nothing
      check expectBookQuantity(title: Text, expected: Number)
      scenario "add an available book" {
        given bookIsAvailable("Dune")
        given startWithEmptyBasket()
        when addBook("Dune")
        then expectBookQuantity("Dune", 1)
      }
    }
  }`);

    examples.checkScenario("add an available book");

    examples.expectStaticallyValid();
    examples.expectSteps([
      'given bookIsAvailable("Dune")',
      "given startWithEmptyBasket()",
      'when addBook("Dune")',
      'then expectBookQuantity("Dune", 1)',
    ]);
    examples.expectOperation(3, "addBook");
    examples.expectArgument(4, 2, "1");
    examples.expectInspectionUnchanged();
  });

  it("rejects an observation used as the action", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    observation bookQuantity() returns Number
    scenario "wrong action" {
      when bookQuantity()
      then true
    }
  }`);

    examples.checkScenario("wrong action");

    examples.expectProblem("invalid-step-role", "bookQuantity()");
  });

  it("rejects an action used for preparation", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    action addBook() returns Nothing
    scenario "wrong preparation" {
      given addBook()
      when addBook()
      then true
    }
  }`);

    examples.checkScenario("wrong preparation");

    examples.expectProblemAtStep(1, "invalid-step-role", "addBook()");
  });

  it("rejects a noncall action while reading the source", () => {
    const examples = new ScenarioExamples();
    examples.attemptSource(`examples {
    scenario "not an action" {
      when 8
      then true
    }
  }`);

    examples.expectSourceRejected("8");
  });

  it("retains an unresolved operation at its use", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    action addBook(title: Text) returns Nothing
    scenario "misspelled action" {
      when addBok("Dune")
      then true
    }
  }`);

    examples.checkScenario("misspelled action");

    examples.expectOriginalProblem("unresolved-reference", "addBok");
  });

  it("rejects a numeric observation used directly as an expectation", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    action addBook() returns Nothing
    observation quantity() returns Number
    scenario "not a condition" {
      when addBook()
      then quantity()
    }
  }`);

    examples.checkScenario("not a condition");

    examples.expectProblem("invalid-purpose", "quantity()");
  });

  it("accepts an observation compared with an authored quantity", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    action addBook() returns Nothing
    observation quantity() returns Number
    scenario "one book" {
      when addBook()
      then quantity() == 1
    }
  }`);

    examples.checkScenario("one book");

    examples.expectStaticallyValid();
    examples.expectSteps(["when addBook()", "then quantity() == 1"]);
  });

  it("reports a wrong operation role even when an argument is invalid", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    observation quantity(seed: Number) returns Number
    scenario "two invalid uses" {
      when quantity("many")
      then true
    }
  }`);

    examples.checkScenario("two invalid uses");

    examples.expectProblem("invalid-step-role", 'quantity("many")');
    examples.expectProblem("incompatible-type", '"many"');
  });

  it("uses a captured basket in later typed calls", () => {
    const examples = new ScenarioExamples();
    examples.source(`type Basket { id: Text }
  examples {
    setup emptyBasket() returns Basket
    action addCopies(basket: Basket, count: Number) returns Nothing
    observation quantity(basket: Basket) returns Number
    scenario "add one copy" {
      given basket = emptyBasket()
      when addCopies(basket, 1)
      then quantity(basket) == 1
    }
  }`);

    examples.checkScenario("add one copy");

    examples.expectStaticallyValid();
    examples.expectCaptureAtStep(1, "basket");
    examples.expectSteps([
      "given basket = emptyBasket()",
      "when addCopies(basket, 1)",
      "then quantity(basket) == 1",
    ]);
  });

  it("checks the type of a captured value at its later use", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    action quantity() returns Number
    action nameBook(title: Text) returns Nothing
    scenario "wrong captured type" {
      when count = quantity()
      when nameBook(count)
      then true
    }
  }`);

    examples.checkScenario("wrong captured type");

    examples.expectProblemAtStep(2, "incompatible-type", "count");
  });

  it("does not borrow an outer fixture before its capture is introduced", () => {
    const examples = new ScenarioExamples();
    examples.source(`type Basket { id: Text }
  examples {
    fixture basket: Basket = { id: "outer" }
    action openBasket() returns Basket
    action addCopies(basket: Basket, count: Number) returns Nothing
    scenario "use before capture" {
      when addCopies(basket, 1)
      when basket = openBasket()
      then true
    }
  }`);

    examples.checkScenario("use before capture");

    examples.expectProblemAtStep(1, "unavailable-value", "basket");
  });

  it("rejects a duplicate capture", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    action quantity() returns Number
    scenario "duplicate capture" {
      when count = quantity()
      when count = quantity()
      then count == 1
    }
  }`);

    examples.checkScenario("duplicate capture");

    examples.expectDuplicateCapture("count", { firstStep: 1, repeatedStep: 2 });
  });

  it("does not share captures between scenarios", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    action quantity() returns Number
    action useCount(count: Number) returns Nothing
    scenario "first" {
      when count = quantity()
      then count == 1
    }
    scenario "second" {
      when useCount(count)
      then true
    }
  }`);

    examples.checkScenario("first");
    examples.expectStaticallyValid();
    examples.checkScenario("second");

    examples.expectOriginalProblem("unresolved-reference", "count", { step: 1 });
  });

  it("rejects a capture from an operation with no result", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    action save() returns Nothing
    scenario "capture nothing" {
      when saved = save()
      then true
    }
  }`);

    examples.checkScenario("capture nothing");

    examples.expectProblem("invalid-purpose", "save()");
  });

  it("keeps an unspecified captured result incomplete", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    action load()
    scenario "unknown output" {
      when loaded = load()
      then true
    }
  }`);

    examples.checkScenario("unknown output");

    examples.expectDeferred("declared-result", "load()");
    examples.expectNoProblems();
  });

  it("keeps the failed producer's cause at later capture uses", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    action quantity(seed: Number) returns Number
    action useCount(count: Number) returns Nothing
    scenario "broken capture" {
      when count = quantity("many")
      when useCount(count)
      then true
    }
  }`);

    examples.checkScenario("broken capture");

    examples.expectProblem("incompatible-type", '"many"');
    examples.expectCauseReachesStep('"many"', 2);
  });

  it("rejects a captured value used as a callable", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    action quantity() returns Number
    scenario "a value is not an operation" {
      when count = quantity()
      when count()
      then true
    }
  }`);

    examples.checkScenario("a value is not an operation");

    examples.expectProblemAtStep(2, "invalid-purpose", "count");
    examples.expectNoDeferred();
  });

  it("allows a fixture named result in a scenario", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    fixture result: Number = 1
    action addCopies(count: Number) returns Nothing
    scenario "ordinary fixture name" {
      when addCopies(result)
      then result == 1
    }
  }`);

    examples.checkScenario("ordinary fixture name");

    examples.expectStaticallyValid();
  });

  it("allows a capture named result", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    action quantity() returns Number
    scenario "ordinary capture name" {
      when result = quantity()
      then result == 1
    }
  }`);

    examples.checkScenario("ordinary capture name");

    examples.expectStaticallyValid();
    examples.expectCaptureAtStep(1, "result");
  });

  it("does not trust an invalid fixture annotation", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    fixture count: Number = "many"
    action addCopies(count: Number) returns Nothing
    scenario "broken input data" {
      when addCopies(count)
      then true
    }
  }`);

    examples.checkScenario("broken input data");

    examples.expectFixtureCause("count", "incompatible-type", '"many"');
  });

  it("keeps the expected quantity separate from the actual call", () => {
    const examples = new ScenarioExamples();
    examples.source(`function multiply(a: Number, b: Number) returns Number
  examples {
    example "eight times eight": multiply(8, 8) => 64
  }`);

    examples.checkExample("eight times eight");

    examples.expectStaticallyValid();
    examples.expectActual("multiply(8, 8)");
    examples.expectExpectedValue("64");
    examples.expectDistinctActualAndExpectedOrigins();
  });

  it("reports an expected value of the wrong type", () => {
    const examples = new ScenarioExamples();
    examples.source(`function multiply(a: Number, b: Number) returns Number
  examples {
    example "wrong expected type": multiply(8, 8) => "sixty-four"
  }`);

    examples.checkExample("wrong expected type");

    examples.expectProblem("incompatible-type", '"sixty-four"');
  });

  it("treats an ordinary quoted expectation as Text", () => {
    const examples = new ScenarioExamples();
    examples.source(`function title() returns Text
  examples {
    example "book title": title() => "Dune"
  }`);

    examples.checkExample("book title");

    examples.expectStaticallyValid();
    examples.expectExpectedValue('"Dune"');
    examples.expectNoProseExpectation();
  });

  it("uses the actual value type for an anonymous expected record", () => {
    const examples = new ScenarioExamples();
    examples.source(`type Book { title: Text }
  function book() returns Book
  examples {
    example "book data": book() => { title: "Dune" }
  }`);

    examples.checkExample("book data");

    examples.expectStaticallyValid();
    examples.expectExpectedValue('{ title: "Dune" }');
  });

  it("does not invent a type for an untyped empty actual list", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    example "unknown element type": [] => []
  }`);

    examples.checkExample("unknown element type");

    examples.expectDeferredAtActual("expected-type");
    examples.expectNoProblems();
  });

  it("allows an ordinary fixture named result in a short example", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    fixture result: Number = 64
    example "ordinary fixture": result => 64
  }`);

    examples.checkExample("ordinary fixture");

    examples.expectStaticallyValid();
    examples.expectActual("result");
    examples.expectExpectedValue("64");
  });

  it("preserves prose as an unfinished verification need", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    action save() returns Nothing
    scenario "persistent save" {
      when save()
      then satisfies "The saved game survives a restart"
    }
  }`);

    examples.checkScenario("persistent save");

    examples.expectStaticallyValid();
    examples.expectProseExpectation("The saved game survives a restart");
  });

  it("allows an effectful short example with explicit prose", () => {
    const examples = new ScenarioExamples();
    examples.source(`function save() returns Nothing
  examples {
    example "persistent save": save() => satisfies "The saved game survives a restart"
  }`);

    examples.checkExample("persistent save");

    examples.expectStaticallyValid();
    examples.expectActual("save()");
    examples.expectProseExpectation("The saved game survives a restart");
  });

  it("allows an omitted argument declared with a default", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    action addCopies(count: Number = 1) returns Nothing
    scenario "default quantity" {
      when addCopies()
      then true
    }
  }`);

    examples.checkScenario("default quantity");

    examples.expectStaticallyValid();
  });

  it("rejects an explicit wrong argument even when a default exists", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    action addCopies(count: Number = 1) returns Nothing
    scenario "wrong quantity" {
      when addCopies("many")
      then true
    }
  }`);

    examples.checkScenario("wrong quantity");

    examples.expectProblem("incompatible-type", '"many"');
  });

  it("uses the shared member-call rules for a captured receiver", () => {
    const examples = new ScenarioExamples();
    examples.source(`concept Basket {
    public add
    capability add(count: Number) returns Nothing
  }
  examples {
    setup emptyBasket() returns Basket
    scenario "add through a basket" {
      given basket = emptyBasket()
      when basket.add(1)
      then true
    }
  }`);

    examples.checkScenario("add through a basket");

    examples.expectStaticallyValid();
  });

  it("keeps the same capability identity in inline and attached examples", () => {
    const examples = new ScenarioExamples();
    examples.source(`concept Store {
    capability save() returns Nothing
    examples {
      scenario "inline" {
        when save()
        then true
      }
    }
  }
  examples for Store {
    scenario "attached" {
      when save()
      then true
    }
  }`);

    examples.checkScenario("inline");
    examples.expectStaticallyValid();
    examples.rememberOperation(1, "save");

    examples.checkScenario("attached");

    examples.expectStaticallyValid();
    examples.expectSameOperation(1, "save");
  });

  it("does not borrow an operation from another examples block", () => {
    const examples = new ScenarioExamples();
    examples.source(`concept Store {}
  examples for Store {
    action save() returns Nothing
  }
  examples for Store {
    scenario "outside the declaration block" {
      when save()
      then true
    }
  }`);

    examples.checkScenario("outside the declaration block");

    examples.expectOriginalProblem("unresolved-reference", "save", { step: 1 });
  });

  it("does not replace missing subject context with an outer operation", () => {
    const examples = new ScenarioExamples();
    examples.module("store.expec", `concept Store {
    capability save() returns Nothing
  }`);
    examples.source(`use Store from "store.expec"
  function save() returns Nothing
  examples for Store {
    scenario "needs subject composition" {
      when save()
      then true
    }
  }`);

    examples.checkScenario("needs subject composition");

    examples.expectDeferred("composition", "save");
    examples.expectNoProblems();
  });

  it("retains an invalid argument alongside missing composition", () => {
    const examples = new ScenarioExamples();
    examples.source(`include "./shared.expec"
  examples {
    action addCopies(first: Number, second: Number) returns Nothing
    scenario "two independent findings" {
      when addCopies(sharedCount, "many")
      then true
    }
  }`);

    examples.checkScenario("two independent findings");

    examples.expectProblem("incompatible-type", '"many"');
    examples.expectDeferred("composition", "sharedCount");
  });

  it("keeps earlier reports and source unchanged across checks", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples {
    action addCopies(count: Number) returns Nothing
    scenario "valid" {
      when addCopies(1)
      then true
    }
    scenario "invalid" {
      when addCopies("many")
      then true
    }
  }`);

    examples.checkScenario("invalid");
    examples.expectProblem("incompatible-type", '"many"');
    examples.rememberReport("invalid");
    examples.checkScenario("valid");
    examples.expectStaticallyValid();
    examples.checkScenario("invalid");

    examples.expectSameReportAs("invalid");
    examples.expectRememberedReportUnchanged("invalid");
    examples.expectInspectionUnchanged();
  });

  it("rejects a declaration supplied as a scenario", () => {
    const examples = new ScenarioExamples();
    examples.source(`function save() returns Nothing
  examples {
    scenario "save" {
      when save()
      then true
    }
  }`);

    examples.attemptToCheckFunction("save");

    examples.expectQueryError("unexpected-kind");
  });

  it("rejects a handle from another source snapshot", () => {
    const examples = new ScenarioExamples();
    examples.source(`examples { example "one": 1 => 1 }`);

    const other = new ScenarioExamples();
    other.source('examples { example "one": 1 => 1 }');
    examples.attemptToCheckForeignExample(other, "one");

    examples.expectQueryError("foreign-node");
  });
});
