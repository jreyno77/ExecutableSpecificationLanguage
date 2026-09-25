@draft @unbound
Feature: Declare and validate the compiler's own contracts
  As a specification author
  I want references to resolve to available declarations
  So that incomplete or inconsistent contracts are caught before a project changes

  Background:
    Given the candidate source in "specifications/examples/validation-contract.expec"
    And the core dependency explicitly supplies Text, Boolean, and List
    And no other declarations are available

  @US-001 @US-002 @EX-001
  Scenario: Validate a fully declared compiler contract
    When I validate the specification
    Then validation succeeds
    And there are no unresolved-reference diagnostics
    And ExpecCompiler exposes validate with input Specification and result ValidationResult
    And the declared prose expectation remains associated with validate
    And success does not claim the validate implementation exists

  @US-002 @EX-002
  Scenario: Reject an undeclared input type
    Given I remove the Specification type declaration
    And validate still takes a specification of type Specification
    When I validate the specification
    Then validation fails
    And a diagnostic identifies the unresolved name Specification
    And that diagnostic locates its reference in the source file
    And the name is not inferred from its use as a parameter type

  @US-002 @EX-003
  Scenario: Reject an unavailable public capability
    Given I change the public capability reference from validate to validateProject
    And the only capability declaration is still validate
    When I validate the specification
    Then validation fails
    And a diagnostic identifies the unresolved name validateProject
    And that diagnostic locates the public capability reference
    And the compiler does not silently treat validate as validateProject

  @US-002 @EX-004 @proposed-policy
  Scenario: Resolve a declaration supplied by an explicit dependency
    Given I move the ValidationResult and Diagnostic declarations into a local dependency named results
    And the dependency explicitly supplies those declarations and their required core types
    And I make results.ValidationResult available under the name ValidationResult
    When I validate the specification
    Then the validate result type resolves to the ValidationResult declaration from results
    And validation succeeds
    And no duplicate local ValidationResult declaration is required

  @US-002 @EX-005 @proposed-policy
  Scenario: A nearby file does not implicitly provide a missing declaration
    Given I move the ValidationResult and Diagnostic declarations into a file named results.expec
    And that file is neither a project source nor an available dependency
    When I validate the specification
    Then validation fails
    And a diagnostic identifies the unresolved name ValidationResult
    And the compiler does not invent the type or search unrelated project files to guess it
