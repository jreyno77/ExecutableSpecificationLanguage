@draft @unbound
Feature: Generate readable coded acceptance tests and their domain language
  As a specification author
  I want shorthand examples to produce domain-level tests and reusable helpers
  So that declared behavior becomes useful code without guessed implementation semantics

  Background:
    Given a connected project with TypeScript test output selected
    And the Shopping concept declares bookIsAvailable, startWithEmptyBasket, and addBook
    And it declares bookQuantity as an observation taking a title and returning an integer
    And expectBookQuantity is declared to compare bookQuantity(title) with an expected integer
    And all referenced types and the target test-library bindings are available

  @US-005 @EX-021
  Scenario: A shorthand scenario produces readable domain calls
    Given a scenario named "a shopper can add an available book"
    And its setup makes Dune available and starts with an empty basket
    And its action adds Dune
    And its expectation checks that Dune has quantity 1
    When I generate its acceptance test
    Then its executable test body expresses these operations in order
      """javascript
      await shopping.bookIsAvailable("Dune");
      await shopping.startWithEmptyBasket();
      await shopping.addBook("Dune");
      await shopping.expectBookQuantity("Dune", 1);
      """
    And the generated fixture supplies a fresh Shopping context for the scenario
    And transport-specific URLs and selectors are absent from that test body

  @US-005 @EX-022
  Scenario: A declared comparison generates a check against observed state
    Given the scenario expects quantity 1 for Dune
    And the selected observation binding reads the running application's basket
    When I generate and run the expectation against a basket reporting quantity 0 for Dune
    Then the expectation fails with expected 1 and actual 0
    When I run the same expectation against a basket reporting quantity 1 for Dune
    Then the expectation passes
    And neither result is substituted with a count of test-side addBook calls

  @US-002 @US-005 @EX-023
  Scenario: An expectation cannot refer to an undeclared observation
    Given I change the expectation to reference bookQuantitty instead of bookQuantity
    And no bookQuantitty declaration is available
    When I build the specification
    Then compilation fails with an unresolved bookQuantitty reference
    And the compiler does not invent an observation or silently correct its spelling

  @US-005 @EX-024 @proposed-policy
  Scenario: An unfinished observation remains explicit beneath an implemented check
    Given bookQuantity is declared but has no implementation or execution binding
    When I generate the domain language
    Then expectBookQuantity contains a comparison of the observed and expected quantities
    And bookQuantity has a typed scaffold that throws a not-implemented error
    When I execute the generated expectation using that scaffold
    Then execution reports the missing bookQuantity implementation
    And the expectation is not reported as passing
