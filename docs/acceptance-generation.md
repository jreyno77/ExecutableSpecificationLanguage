# Generating readable acceptance tests and their supporting DSL

Status: design examples only. This records the user's clarification of the desired output and proposes how deterministic compilation could produce it. No compiler, executable binding, or final grammar is implemented.

## Confirmed output level

The user identified this as the desired level of generated acceptance-test code:

```javascript
test("a shopper can add an available book", async () => {
  await shopping.bookIsAvailable("Dune");
  await shopping.startWithEmptyBasket();

  await shopping.addBook("Dune");

  await shopping.expectBookQuantity("Dune", 1);
});
```

The language should offer shorthand for expressing such examples, whether through input/output cases, scenarios, or other readable constructs. Builds should also flesh out the reusable domain language beneath the tests as far as the specification supports. Creating a Gherkin file alone does not meet this output goal. The repository's current `.feature` files are discovery/acceptance artifacts for developing .expec, not a required source format or the sole intended output.

This clarifies the acceptance-testing part of the language. It does not replace the broader requirements for concepts, project contracts, multiple targets, or preservation of existing source.

## Proposed semantic roles

| Role | Example | Meaning needed by the compiler |
| --- | --- | --- |
| Action or setup operation | `bookIsAvailable(title)`, `addBook(title)` | A declared operation, typed parameters, and any specified execution/composition rules. |
| Observation | `bookQuantity(title)` | A declared way to obtain an actual result from the system being tested. |
| Expectation | `expectBookQuantity(title, expected)` | A check relating that actual observation to an independently specified expected value. |
| Scenario/example | Available book, empty basket, add, expect one copy | Ordered setup, actions, and checks with concrete values. |
| Binding | An operation implemented by a selected driver | How a declared operation reaches the actual system. |

These are roles the model needs to distinguish, not a decision that all five require separate top-level keywords. The operations can remain capabilities of ordinary concepts. All names and types must resolve under the existing declaration rule.

## A concrete syntax sketch

The following is illustrative shorthand rather than an adopted grammar. Assume the manifest makes a real core dependency with declared Text and Integer types available. Each action and observation below is explicitly declared on the Shopping concept; merely using its name in a scenario would not declare it.

```text
concept Shopping
  action bookIsAvailable(title: Text)
  action startWithEmptyBasket()
  action addBook(title: Text)
  observation bookQuantity(title: Text): Integer

  expectation expectBookQuantity(title: Text, expected: Integer)
    checks bookQuantity(title) equals expected

scenario "a shopper can add an available book" using shopping: Shopping
  given bookIsAvailable("Dune")
    and startWithEmptyBasket()
  when addBook("Dune")
  then expectBookQuantity("Dune", 1)
```

This gives the compiler enough structure to emit the test above, typed domain-operation contracts, and a comparison helper. For a JavaScript/TypeScript target, the helper body could be:

```javascript
async expectBookQuantity(title, expected) {
  const actual = await this.bookQuantity(title);
  assert.equal(actual, expected);
}
```

The target backend supplies the assertion-library import and asynchronous calling convention. Scenario setup creates a fresh Shopping context connected to the configured driver. Those are explicit backend/binding rules to design, not behavior inferred from the word Shopping.

The expectation's name is declared, so the compiler does not have to guess that a quantity comparison should be named `expectBookQuantity`. A separate shorthand could generate such a name according to a defined rule later.

If `bookQuantity` is declared but has no implementation or binding, a scaffold can contain:

```javascript
async bookQuantity(title) {
  throw new Error("Not implemented: Shopping.bookQuantity");
}
```

The assertion helper is implemented; its observation still needs implementation. Executing it must not produce a false pass. If `bookQuantity` is undeclared instead, the source specification fails validation and is not treated as a request to invent a helper.

## How far deterministic generation can go

| Information supplied | Deterministic output possible |
| --- | --- |
| Scenario names, ordered declared operations, and typed arguments | Complete readable test bodies, calls, imports, and target test registration. |
| Capability signatures | Domain-language interfaces, method signatures, driver contracts, and explicit unimplemented methods. |
| An observation and equality/other supported predicate | Working assertion helpers that compare actual and expected results. |
| Declared defaults and compositions of known operations | Working setup helpers and reusable action sequences. |
| Explicit parameter, result, identity, and context mappings | Working wrappers and context plumbing without guessed data flow. |
| A supported transport binding with routes, schemas, authentication references, and failure behavior | Working driver code for that binding, to the extent those semantics are specified or supplied by a dependency. |
| Only prose such as "the book is available" | A preserved expectation and a visible implementation obligation; no invented mechanism for making it true. |

There is no fixed boundary that limits the language to stubs. A sufficiently detailed specification, together with defined compiler operations and reusable dependencies, can generate a complete working DSL and drivers. Each added executable construct needs precise semantics and an appropriate target implementation.

For example, `bookIsAvailable("Dune")` could arrange a catalog entry, select a predefined fixture, or check an already existing entry. Its name alone does not choose between these behaviors. Likewise, adding a book does not define how to look up its identity, establish the current basket, handle retries, or observe the result. These details can be declared once and reused or supplied through an existing implementation.

The domain helper must observe the application when it checks quantity. Maintaining a test-side count of addBook calls and asserting against that count would test the helper's own bookkeeping rather than the shop.

## Input/output cases and scenarios

Both forms are useful. A pure operation can use a compact input/output case:

```text
example multiply(8, 8) => 64
```

With a declared multiply operation, types, and execution binding, that is enough to generate an equality test. It is not enough to infer a general multiplication implementation; a function that always returns 64 would satisfy this one example too.

Stateful behavior needs context. Adding one book to an empty basket and adding it to a basket that already holds two copies have different expected quantities. Scenarios supply the relevant preconditions, action sequence, and observations. A shorthand that derives scenarios from contracts must preserve those distinctions.

## Completion and preservation

The build should distinguish invalid references, declared but unimplemented operations, implemented checks, and verified behavior. These are different states. A generated test may be structurally complete yet unable to run successfully until its driver exists.

Deterministic generation means repeatable generation for the same specification, dependency/generator versions, configuration, and relevant connected-project state. It does not guarantee deterministic application behavior, network responses, or test execution. Fixture isolation and timing semantics still need intentional design.

Generated DSL, assertion, and driver structure follows the same preservation requirement as application scaffolding. When an author fills in an operation or driver body, a later build must preserve it and report incompatible specification changes. AI may help author missing implementations or propose bindings, but it is not required to interpret the source during a deterministic build.

The next design examples should prove the concrete boundary: a declared scenario generates the four readable shopping calls; a declared equality check generates a real assertion; an undeclared operation fails validation; and a declared but unimplemented observation cannot make the test pass.
