@draft @unbound
Feature: Compose specification files and extend configured outputs
  As a specification author and exporter author
  I want reusable declarations and examples to feed interchangeable outputs
  So that file organization and output format do not change the specification's meaning

  @US-005 @US-009 @EX-025
  Scenario: Extracting an inline example preserves its meaning
    Given shopping.expec declares Shopping and its bookIsAvailable, startWithEmptyBasket, addBook, and expectBookQuantity operations
    And all referenced types and the meaning of expectBookQuantity are declared
    And an inline example makes Dune available, starts an empty basket, adds Dune, and expects quantity 1
    And I record the resolved example and its generated domain test
    When I move only that example to shopping.examples.expec
    And I explicitly include that file and associate its example with the existing Shopping concept
    And I resolve and generate again with the same target options
    Then the example resolves to the same Shopping operation declarations
    And the generated domain test retains the same operation order, arguments, and expected quantity
    And Shopping and its operations have not been declared a second time
    And the example's source location now identifies shopping.examples.expec

  @US-002 @US-009 @EX-026
  Scenario: An unknown operation in an included example identifies its actual source
    Given shopping.expec declares Shopping and expectBookQuantity with all required types available
    And shopping.examples.expec is explicitly included and associated with Shopping
    And its example calls expectBookQuantitty for Dune with expected quantity 1
    And no expectBookQuantitty declaration is available in that example's scope
    When I validate the composed specification
    Then validation fails with an unresolved expectBookQuantitty reference
    And the diagnostic identifies shopping.examples.expec and the location of that call
    And it does not attribute the error only to the including shopping.expec file
    And including the example does not introduce an expectBookQuantitty declaration

  @US-002 @US-009 @EX-027
  Scenario: Two concept files reuse one shared type declaration
    Given shared-types.expec declares PlayerStateSnapshot and all its field types
    And game.expec declares StoreGame.save with an input of that imported PlayerStateSnapshot type
    And archive.expec declares SaveArchive.append with an input of the same imported PlayerStateSnapshot type
    And both files explicitly make the shared declaration available
    And all three files participate in the specification
    When I resolve the specification
    Then both input types refer to the declaration in shared-types.expec
    And the resolved model contains one PlayerStateSnapshot declaration
    And neither import creates a second independent type with the same name
    When I generate TypeScript using a mapping that emits one declaration per shared type
    Then the save and append signatures refer to the same emitted PlayerStateSnapshot type

  @US-007 @US-010 @EX-028
  Scenario: A new configured output consumes the shared model without changing the parser
    Given a valid validation contract and an acceptance example about rejecting an unknown type form a resolved specification
    And a live project-context service is connected to an existing compiler project
    And a TypeScript output is constructed with that service and options selecting src/generated
    And I register a Markdown output through the public extension API without modifying the language parser
    And the Markdown output is constructed with that service and options selecting docs/generated/contracts.md
    And the destinations contain no prior representation of this specification
    When I call create(spec) on each output with the same resolved specification
    Then TypeScript contracts appear under src/generated in the connected project
    And Markdown documentation appears at docs/generated/contracts.md in that project
    And both outputs represent validate with input Specification and result ValidationResult
    And the Markdown describes the reviewed unknown-type example from that same model
    And each operation uses its constructor-configured options and live project-context service
    And neither call requires target options or a project snapshot as additional arguments
