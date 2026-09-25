@draft @unbound
Feature: Apply specification output to the configured software project
  As a project maintainer
  I want the manifest to choose the destination and targets
  So that a build updates the actual project I maintain

  Background:
    Given the valid validation-contract example and its explicit core dependency
    And an isolated workspace for this example

  @US-003 @EX-006
  Scenario: Generate into the project connected by the manifest
    Given the workspace contains existing projects named compiler-a and compiler-b
    And each project contains a handwritten README with different contents
    And the manifest connects compiler-b and selects TypeScript
    And ExpecCompiler has no existing implementation in compiler-b
    When I build the specification
    Then compiler-b contains a TypeScript declaration for ExpecCompiler
    And its validate capability takes Specification and returns ValidationResult
    And the required declared types are present or explicitly imported
    And a new validate implementation throws a not-implemented error
    And compiler-b keeps its handwritten README unchanged
    And every file in compiler-a remains unchanged
    And the generated ExpecCompiler source is part of compiler-b itself

  @US-004 @EX-007
  Scenario: Initialize a project after the author accepts
    Given the manifest has no connected project
    When I request a build
    Then I am asked whether to initialize a project before any project is created
    When I accept and choose a new destination named compiler-c with target TypeScript
    Then compiler-c is initialized at that destination
    And the manifest records the connection and target
    And the build writes the specified compiler structure into compiler-c

  @US-004 @EX-008
  Scenario: Declining initialization creates no project
    Given the manifest has no connected project
    When I request a build
    And I decline the initialization question
    Then no project is created
    And no project source files are written
    And no project connection is recorded in the manifest

  @US-007 @EX-009
  Scenario: A diagram and code express the same contract
    Given the manifest connects an existing project
    And it selects TypeScript and UML output
    When I build the specification
    Then the code exposes ExpecCompiler.validate with input Specification and result ValidationResult
    And the diagram shows ExpecCompiler, Specification, and ValidationResult
    And the diagram shows validate with those same input and result types
    And the diagram is an artifact of the connected project

  @US-002 @US-003 @EX-010 @proposed-policy
  Scenario: An invalid specification does not apply a replacement build
    Given the connected project already contains a previously generated compiler and handwritten changes
    And I reference validateProject publicly while only validate is declared
    When I request a build
    Then the build reports the unresolved validateProject reference
    And the build is not reported as successful
    And every existing connected-project file retains its contents
    And no replacement generated source files are added
