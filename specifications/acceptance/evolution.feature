@draft @unbound
Feature: Keep executable intent readable while the implementation evolves
  As an implementer
  I want readable tests and preserved implementation work
  So that changing the specification remains useful throughout development

  @US-005 @EX-011
  Scenario: A literal example distinguishes a correct result from an incorrect one
    Given a declared Calculator.multiply capability takes two numbers and returns a number
    And all of its types are explicitly supplied by the example environment
    And an example specifies inputs 8 and 8 with expected result 64
    And the example is bound to the real multiply implementation
    When I generate and run the example against an implementation that returns 64 for those inputs
    Then that example passes
    When I run the same example against an implementation that returns 63 for those inputs
    Then that example fails
    And the failure reports expected 64 and observed 63

  @US-005 @EX-012 @proposed-policy
  Scenario: Prose without an execution binding stays visibly incomplete
    Given ExpecCompiler.validate has the expectation "Unknown references produce useful diagnostics"
    And no execution binding or observable assertion has been supplied for that sentence
    When I generate its specification tests
    Then the expectation remains readable in a traceable scenario scaffold
    And the missing binding or assertion is reported as an implementation obligation
    And that scenario is not reported as verified or passing

  @US-005 @US-008 @EX-013
  Scenario: An unimplemented or always-successful validator cannot satisfy an error example
    Given an executable binding for EX-003 invokes the real ExpecCompiler.validate capability
    And its observation checks for failed validation and an unresolved validateProject diagnostic
    When I run it against a validate implementation that throws a not-implemented error
    Then EX-003 is not reported as passing
    When I run it against a validate implementation that always returns valid with no diagnostics
    Then EX-003 fails because its observed result contradicts the expected error
    And merely generating the scenario does not count as satisfying it

  @US-006 @EX-014
  Scenario: Add a capability while retaining the compiler's implementation
    Given the connected project contains a handwritten ExpecCompiler.validate body
      """typescript
      this.validationCount += 1;
      return this.resolver.validate(specification);
      """
    And that class also contains handwritten validationCount state and an assertConfigured helper
    And the project contains an unrelated handwritten utility file
    And the existing ExpecCompiler class is explicitly associated with its specification concept
    And I add the declared capability inspect taking Specification and returning ValidationResult
    And I expose inspect publicly with all referenced types available
    When I build the revised specification
    Then the connected ExpecCompiler class contains the inspect signature
    And its new inspect implementation throws a not-implemented error
    And the original validate body is byte-for-byte unchanged
    And the handwritten state, helper, and unrelated utility file are unchanged

  @US-006 @EX-015 @proposed-policy
  Scenario: An established rename preserves the implementation
    Given a valid earlier contract exposes validate and declares validate
    And the connected class has a handwritten validate body
    And a valid revised contract exposes check and declares check instead
    And an explicit rename mapping identifies check as the former validate capability
    When I build the revised specification
    Then the corresponding method is named check
    And it retains the handwritten body from validate
    And this rename handling does not excuse unresolved names in either specification

  @US-006 @EX-016 @proposed-policy
  Scenario: A removal that would erase handwritten work is reported
    Given the connected ExpecCompiler has a handwritten inspect implementation
    And inspect is explicitly associated with its specification capability
    And I remove inspect from the specification
    And no retention or migration instruction resolves its handwritten implementation
    When I plan the revised build
    Then the plan reports a conflict for removing inspect
    And its handwritten implementation remains available in the connected source
    And removal is not reported as successfully applied

  @US-005 @US-006 @EX-017 @proposed-policy
  Scenario: A changed saving requirement does not silently rewrite or reverify the old implementation
    Given the connected StoreGame contains the supplied original implementation
    And its save body writes the snapshot to localStorage
    And the revised specification declares all referenced names and the required persistence dependency
    And the current saving scenario has a recorded passing result
    When I change the save expectation to persistence in a Supabase database and rebuild
    Then the save body remains unchanged
    And the revised scenario expresses the new persistence expectation
    And the new expectation remains an outstanding obligation until implemented and checked
    And the earlier passing result is not presented as verification of the revised expectation

  @US-006 @EX-018
  Scenario: Repeating an unchanged build leaves the project unchanged
    Given a valid specification has been successfully applied to a connected project
    And the specification, manifest, generator inputs, and project have not changed
    When I build again
    Then no source files are added, removed, moved, or rewritten
    And the build reports no further project changes
