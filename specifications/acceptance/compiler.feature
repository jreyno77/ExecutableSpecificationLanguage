@draft @coverage-in-progress @CORE-18
Feature: Compile authored specifications into validated meaning
  As a specification author and an output implementer
  I want available declarations and compatible contracts preserved in a resolved specification
  So that unavailable or inconsistent promises cannot be presented as valid project input

  These independently authored specifications have selected executable Vitest bindings.
  The coverage inventory records bound, partial, and unbound cases without claiming full implementation.
  The driver calls the real Compiler.compile(CompilationInput) boundary.
  It supplies source text and a typed dependency snapshot, not a prepared compiler result.
  Observations inspect actual results against the independently authored facts below.
  Rejection means diagnostics and no accepted ResolvedSpecification.
  Acceptance may retain implementation and execution obligations; it never means a test passed.

  Background:
    Given the compiler uses the real candidate-0.1 source reader and semantic validator
    And Text, Number, Boolean, List, and Nothing are supplied by the built-in catalog
    And source fixtures are relative to "specifications/compiler/fixtures"
    And each fixture is one SourceDocument with its fixture path as its source identifier
    And the dependency catalog is empty unless a scenario supplies entries

  @US-001 @US-002 @US-003 @CV-001
  Scenario: Compile the declared Store Game contracts without requiring their implementation
    Given source "valid/store-game.expec"
    And the dependency catalog contains package vite for build and package supabase for runtime
    When I compile the supplied input
    Then compilation is accepted
    And StoreGame exposes startup, saveGame, delete, newGame, and shutDown in their written order
    And startup takes configurations of the declared SystemConfig type and returns Nothing
    And saveGame takes snapshot of the declared PlayerStateSnapshot type and returns Nothing
    And newGame returns that same PlayerStateSnapshot declaration
    And PlayerStateSnapshot.characterPosition resolves to Pair<Number> and shoppingCart resolves to ShoppingCart
    And both the constructor and startup refer to the same SystemConfig declaration
    And the package uses retain vite's build phase and supabase's runtime phase
    And the result records unfinished capability implementations and unverified package installation as obligations
    And no claim is made that Store Game starts or saves a snapshot

  @US-001 @US-002 @CV-002
  Scenario: Resolve built-in types without authored imports or fabricated source declarations
    Given source "valid/builtins.expec"
    When I compile the supplied input
    Then compilation is accepted
    And Message.body, Message.count, and Message.visible resolve to built-in Text, Number, and Boolean
    And Message.labels resolves to built-in List with the single argument Text
    And show has the explicitly written no-result type Nothing
    And those type bindings identify built-in origins rather than invented source declarations
    And the source has no import inserted for those types

  @US-002 @CV-003
  Scenario: Reject an unavailable custom type even though the source is grammatical
    Given source "invalid/unknown-type.expec"
    When I compile the supplied input
    Then compilation is rejected
    And an unresolved-reference diagnostic identifies PlayerStateSnapshot at line 3 column 29
    And the diagnostic belongs to the supplied source document
    And neither the parameter name nor an earlier grammar-reading result supplies the missing declaration
    And there is no accepted resolved specification

  @US-002 @CV-004
  Scenario: Reject a public name whose capability was never declared
    Given source "invalid/public-mismatch.expec"
    When I compile the supplied input
    Then compilation is rejected
    And an unresolved-reference diagnostic identifies saveGame at line 2 column 10
    And the available save declaration remains a different capability
    And no guessed rename or invented saveGame declaration repairs the contract
    And there is no accepted resolved specification
    When I compile "invalid/public-type-reference.expec" as a new supplied source
    Then compilation is rejected with wrong-reference-kind because the available saveGame is a type rather than a capability
    And there is no accepted resolved specification

  @US-002 @proposed-policy @CV-005
  Scenario Outline: Reject conflicting introductions into the same scope
    Given source "<fixture>"
    And the standard results export catalog is supplied when that source imports results
    When I compile the supplied input
    Then compilation is rejected
    And a duplicate-declaration diagnostic identifies "<name>"
    And its explanation distinguishes the conflicting introductions
    And its provenance identifies the new source declaration and the earlier source, imported, or built-in origin
    And there is no accepted resolved specification

    Examples:
      | fixture                              | name             |
      | invalid/duplicate-type.expec          | Item             |
      | invalid/duplicate-field.expec         | count            |
      | invalid/duplicate-parameter.expec     | value            |
      | invalid/shadow-builtin.expec          | Text             |
      | invalid/import-local-collision.expec | ValidationResult |

  @US-002 @US-009 @proposed-policy @CV-006
  Scenario: Require an unambiguous choice between same-named dependency exports
    Given the standard payments and shipping export catalogs
    And source "invalid/ambiguous-import.expec"
    When I compile the supplied input
    Then compilation is rejected with an ambiguous-reference diagnostic for Receipt
    And the diagnostic identifies both supplied export origins rather than selecting one
    When I compile "valid/aliased-imports.expec" with the same dependency catalog
    Then compilation is accepted
    And PaymentReceipt resolves to the Receipt exported by payments
    And ShippingReceipt resolves to the different Receipt exported by shipping
    And the record function's two parameter types retain those distinct declaration identities

  @US-001 @US-002 @proposed-policy @CV-007
  Scenario: Keep local types inside their owner and out of an exposed public signature
    Given source "valid/local-type.expec"
    When I compile the supplied input
    Then compilation is accepted
    And StoreGame.inspect resolves its input to StoreGame's local SessionState type
    When I compile "invalid/local-type-escape.expec" as a new supplied source
    Then compilation is rejected with an inaccessible-reference diagnostic for StoreGame.SessionState
    When I compile "invalid/public-local-type.expec" as a new supplied source
    Then compilation is rejected with an inaccessible-public-type diagnostic for the exposed SessionState parameter
    And none of these inputs silently makes SessionState a top-level export

  @US-002 @US-003 @US-009 @CV-008
  Scenario: Resolve only complete exports and package entries explicitly supplied in the input
    Given source "valid/catalog-import.expec"
    And the standard results export catalog supplies the record ValidationResult with accepted of type Boolean and messages of type List<Text>
    When I compile the supplied input
    Then compilation is accepted
    And validate's return type binds to that supplied ValidationResult export
    And no duplicate local ValidationResult declaration is required
    When I compile the same source with a supplied results export whose messages field points to a type identifier absent from the catalog
    Then compilation is rejected with an invalid-dependency-catalog diagnostic identifying that incomplete field contract
    And the compiler does not fabricate the absent type metadata
    When I compile the same source without the results module in the supplied catalog
    Then compilation is rejected because the requested dependency is unavailable
    And the compiler does not search for a file or fetch the module
    When I compile "valid/store-game.expec" with vite for build but no supabase package entry
    Then compilation is rejected with an unavailable-package diagnostic for supabase
    And a package's configured presence is never reported as proof that it is installed

  @US-001 @US-002 @proposed-policy @CV-009
  Scenario: Resolve generic arguments without leaking type parameters into surrounding scope
    Given source "valid/generics.expec"
    When I compile the supplied input
    Then compilation is accepted
    And Positions resolves to List of Pair of Number
    And Snapshots resolves to Page whose argument is Positions
    And Pair's T and Page's T belong to their respective declarations
    When I compile "invalid/generic-arity.expec" as a new supplied source
    Then compilation is rejected because Pair requires one type argument but receives two
    When I compile "invalid/list-arity.expec" as a new supplied source
    Then compilation is rejected because built-in List requires one type argument but receives two
    When I compile "invalid/type-parameter-escape.expec" as a new supplied source
    Then compilation is rejected because T is unavailable in identity's signature

  @US-001 @US-002 @proposed-policy @CV-010
  Scenario: Distinguish an alias expansion cycle from a recursive record definition
    Given source "valid/aliases-and-recursion.expec"
    When I compile the supplied input
    Then compilation is accepted
    And Count aliases Number and Label aliases Text
    And TreeNode.children contains the same TreeNode record type through List
    And TreeNode.next is an optional reference to that record
    When I compile "invalid/alias-cycle.expec" as a new supplied source
    Then compilation is rejected because First and Second form an ungrounded alias expansion cycle
    And the diagnostic identifies that alias chain rather than rejecting every recursive type reference

  @US-001 @US-002 @proposed-policy @CV-011
  Scenario Outline: Validate authored records and defaults against their declared types
    Given I compile "valid/records-and-defaults.expec"
    Then compilation is accepted
    And Settings accepts its declared defaults and omission of its optional label
    And its named and numbered fixtures fit the Text-or-Number label alternatives
    And no null literal is invented for the omitted label
    Given source "<fixture>"
    When I compile the supplied input
    Then compilation is rejected
    And a diagnostic identifies "<problem>" at the relevant source expression or declaration
    And there is no accepted resolved specification

    Examples:
      | fixture                               | problem                                                |
      | invalid/field-default.expec           | Text cannot initialize Number brightness               |
      | invalid/missing-field.expec           | Cart.count is required and has no default              |
      | invalid/extra-field.expec             | Cart has no label field                                |
      | invalid/nominal-record.expec          | a Basket value does not become a Cart by matching fields |
      | invalid/field-default-reference.expec | a field default cannot use sibling field base          |
      | invalid/fixture-cycle.expec           | first and second form a fixture-value dependency cycle |

  @US-001 @US-002 @US-005 @proposed-policy @CV-012
  Scenario Outline: Check call arguments, declared defaults, and typed helper returns
    Given I compile "valid/calls-and-returns.expec" and "valid/default-dataflow.expec" as independent inputs
    Then both compilations are accepted
    And add() uses its declared count default and doubled() has a Number result
    And prepare's defaults resolve a fixture and an earlier parameter in order
    Given source "<fixture>"
    When I compile the supplied input
    Then compilation is rejected
    And a diagnostic identifies "<problem>" at the offending call, default, or return
    And there is no accepted resolved specification

    Examples:
      | fixture                               | problem                                              |
      | invalid/argument-type.expec           | Text cannot be passed to add's Number parameter      |
      | invalid/argument-count.expec          | add receives two arguments but declares one          |
      | invalid/helper-return.expec           | quantity returns Text despite declaring Number       |
      | invalid/union-argument.expec          | not every Text-or-Number branch is assignable to Number |
      | invalid/parameter-default-order.expec | title's default refers to the later fallback parameter |
      | invalid/expected-result-type.expec   | multiply's Number result is incompatible with the expected Text |

  @US-001 @US-002 @proposed-policy @CV-013
  Scenario Outline: Validate contract conditions and the context-bound result name
    Given I compile "valid/contracts.expec"
    Then compilation is accepted
    And both the requires and ensures expressions have Boolean type
    And the ensures result reference has multiply's declared Number result type
    And the descriptive promise remains separate from both conditions
    Given source "<fixture>"
    When I compile the supplied input
    Then compilation is rejected
    And a diagnostic identifies "<problem>" at the relevant clause or declaration
    And there is no accepted resolved specification

    Examples:
      | fixture                                 | problem                                           |
      | invalid/nonboolean-contract.expec       | requires has Number type instead of Boolean       |
      | invalid/result-in-precondition.expec    | result is unavailable in a precondition           |
      | invalid/result-without-return.expec     | result needs an explicitly declared return type   |
      | invalid/result-name-conflict.expec      | the parameter result conflicts with contract result |

  @US-002 @US-005 @proposed-policy @CV-014
  Scenario Outline: Validate domain operations and checks without inferring their behavior from names
    Given I compile "valid/shopping.expec"
    Then compilation is accepted
    And each scenario operation resolves to its declared Shopping helper
    And expectBookQuantity compares the Number observation actual with the Number parameter expected
    Given source "<fixture>"
    When I compile the supplied input
    Then compilation is rejected
    And a diagnostic identifies "<problem>"
    And there is no accepted resolved specification

    Examples:
      | fixture                            | problem                                          |
      | invalid/unknown-helper.expec       | bookQuantitty is undeclared                      |
      | invalid/scenario-role.expec        | an observation cannot serve as a when action     |
      | invalid/nonboolean-assertion.expec | assert needs a Boolean condition                  |
      | invalid/nonboolean-then.expec      | then needs a Boolean condition or declared check |
      | invalid/empty-check.expec          | the supplied check body has no assertion         |
      | invalid/check-used-as-value.expec  | a check call is not a Number result              |

  @US-002 @US-005 @proposed-policy @CV-015
  Scenario Outline: Bind local values and captures only where their values are available
    Given I compile "valid/captures.expec"
    Then compilation is accepted
    And the scenario's basket has the Basket type returned by stockedBasket
    And its addCopies and quantity calls refer to that same scenario capture
    And stockedBasket's local basket is distinct from the scenario's basket
    Given source "<fixture>"
    When I compile the supplied input
    Then compilation is rejected
    And a diagnostic identifies "<problem>"
    And there is no accepted resolved specification

    Examples:
      | fixture                                  | problem                                             |
      | invalid/capture-before-use.expec          | later is used before its scenario capture           |
      | invalid/duplicate-capture.expec           | value is captured twice in the same scenario        |
      | invalid/no-result-capture.expec           | a Nothing result cannot supply a captured value     |
      | invalid/unspecified-result-capture.expec  | calculate's unspecified result cannot supply a value |

  @US-001 @US-005 @CV-016
  Scenario: Accept incomplete contracts while preserving every unfinished obligation
    Given source "valid/obligations.expec"
    When I compile the supplied input
    Then compilation is accepted
    And save's omitted return type remains unspecified rather than becoming Nothing
    And save carries result-type-unspecified and implementation-needed obligations
    And the bodyless action and observation carry implementation-needed obligations
    And the bodyless expectSaved check carries a check-implementation-needed obligation
    And the durable-storage promise and restart expectation each retain a prose-needs-check obligation
    And the scenario carries execution-not-performed
    And the result does not report any expectation as passing or implemented

  @US-002 @CV-017
  Scenario: Report independent errors with the supplied source's exact provenance
    Given source "invalid/two-missing-types.expec"
    When I compile the supplied input
    Then compilation is rejected
    And the diagnostic set includes both unresolved references
      | name          | line | column |
      | MissingFirst  | 2    | 23     |
      | MissingSecond | 3    | 24     |
    And each primary range carries source identifier "invalid/two-missing-types.expec"
    And ranges refer to the original text including its first comment line
    And I can identify each problem without relying on an exact diagnostic sentence or a parser's internal node layout
    And there is no accepted resolved specification

  @US-002 @CV-018
  Scenario: Stop malformed source from producing a manufactured resolved model
    Given source "invalid/syntax-error.expec"
    When I compile the supplied input
    Then compilation is rejected
    And a syntax diagnostic identifies the missing field colon at Number on line 2 column 12
    And its source identifier is "invalid/syntax-error.expec"
    And no resolved Snapshot contract is returned as accepted output
    And this syntax failure is not replaced by an invented missing-type diagnosis

  @US-002 @US-009 @proposed-policy @CV-019
  Scenario Outline: Report source composition that belongs to a later task
    Given source "<fixture>"
    When I compile the supplied input
    Then compilation is rejected with a composition-required diagnostic for "<form>"
    And there is no accepted resolved specification
    And the compiler neither loads another file nor silently ignores the form

    Examples:
      | fixture                          | form                       |
      | deferred/include.expec           | include                    |
      | deferred/extend.expec            | extend                     |
      | deferred/external-examples.expec | external example attachment |

  @US-002 @US-008 @CV-020
  Scenario: Repeated calls use exactly the supplied source and dependency snapshot
    Given source "invalid/public-mismatch.expec"
    When I compile the same input twice with the same compiler instance
    Then both results reject saveGame with the same diagnostic categories and source ranges
    When I change only the public reference from saveGame to save in a new SourceDocument and compile it
    Then compilation is accepted with a public reference bound to save
    When I compile "valid/catalog-import.expec" with the standard results export catalog twice
    Then both results retain the same resolved meanings, binding targets, source provenance, and obligations
    When I remove that module from a new dependency snapshot and compile the same source with the same compiler instance
    Then compilation is rejected for the unavailable results import
    And a cached accepted model does not hide either supplied input change

  @US-001 @US-005 @US-007 @US-010 @CV-021
  Scenario: Supply output consumers with validated meaning and the original authored intent
    Given source "valid/shopping.expec"
    When I compile the supplied input
    Then compilation is accepted
    And the resolved specification retains Shopping as a concept and its four domain-operation roles
    And the scenario retains two setup steps, one action, and one check in their written order
    And its arguments remain the literal string Dune and the independently authored expected Number 1
    And each operation reference binds to the declared helper with its checked parameter types
    And the check's comparison retains its observed actual and expected operands separately
    And these contracts, expressions, and references retain their source locations
    And the result carries the grammar version and source description needed to inspect those facts
    And no TypeScript, UML, implementation body, or running test is substituted for that resolved meaning
    When I compile "valid/literal-examples.expec" as a new supplied source
    Then compilation is accepted
    And "eight times eight" retains multiply's arguments 8 and 8 separately from the authored expected Number 64
    And "a literal title" retains the expected Text value Dune
    And "a descriptive result" retains prose as an unfinished checking obligation rather than an expected literal
    And the scenario's ordinary title function call supplies a Text capture used by its later Boolean check
    And each example remains execution-not-performed

  @US-002 @US-003 @US-011 @CV-022
  Scenario: Compilation observes supplied input without discovering or changing a software project
    Given source "invalid/unknown-type.expec"
    And a nearby unsupplied file or connected-project symbol happens to define PlayerStateSnapshot
    And I record the supplied source, catalog, and isolated project file contents
    When I compile the supplied input
    Then compilation still rejects the unavailable PlayerStateSnapshot reference
    And the compiler does not scan files, fetch packages, initialize a project, execute a helper, or invoke an output
    And the source, dependency snapshot, and recorded project contents remain unchanged
    And no files are created or deleted

  @US-002 @US-005 @US-008 @CV-023
  Scenario: The acceptance driver catches a compiler that reports success for every input
    Given the driver for CV-004 invokes Compiler.compile and independently requires rejection of the unavailable saveGame capability
    When I run that acceptance check against a deliberately incorrect compiler that always reports an accepted result
    Then the check fails because the observed outcome contradicts its authored rejection expectation
    When I run it against a compiler entry point that throws a not-implemented error
    Then the check is failed or explicitly unfinished and never counted as passing
    And a driver that merely returns the fixture's expected answer is not an implementation of this acceptance binding

  @US-002 @US-005 @US-008 @CV-024
  Scenario: Run the real grammar and compiler acceptance path from a clean checkout
    Given a clean checkout with the documented compiler development prerequisites
    And the versioned ANTLR grammar, generation command, runtime dependency, and acceptance entry point are available
    When I follow the documented build and acceptance commands without preexisting generated parser files
    Then the ANTLR tool generates the reader's parser from the maintained grammar
    And the real acceptance driver submits fixture source text to Compiler.compile, which uses the real SyntaxReader.read
    And valid/builtins.expec is accepted while invalid/public-mismatch.expec and invalid/syntax-error.expec are rejected for their respective reasons
    And unresolved step definitions, missing tooling, unimplemented methods, or skipped cases are not reported as passing
    And this specification alone does not claim those prerequisites, commands, parser files, or bindings exist today

  @US-001 @US-002 @US-007 @proposed-policy @CV-025
  Scenario Outline: Resolve ordered communications against the participants' public contracts
    Given I compile "valid/interactions.expec"
    Then compilation is accepted
    And storage resolves to the declared Storage participant and persist to its public capability
    And the first message's snapshot argument has the Snapshot type
    And its captured receipt has persist's declared Receipt type
    And the second message passes that earlier receipt to Screen's public showSaved capability
    And the messages remain ordered without claiming they were executed
    Given source "<fixture>"
    When I compile the supplied input
    Then compilation is rejected
    And a diagnostic identifies "<problem>"
    And there is no accepted resolved specification

    Examples:
      | fixture                               | problem                                               |
      | invalid/interaction-operation.expec   | Storage has no persisst capability                    |
      | invalid/interaction-private.expec     | persist is not public on the recipient                |
      | invalid/interaction-argument.expec    | Number cannot be passed to persist's Text parameter   |
      | invalid/interaction-participant.expec | storage is not a declared participant                 |
      | invalid/interaction-reply-order.expec | receipt is used before its message result is captured |
