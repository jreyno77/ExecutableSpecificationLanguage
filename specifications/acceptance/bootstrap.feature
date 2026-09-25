@draft @unbound
Feature: Develop .expec using its own contracts and examples
  As a language maintainer
  I want the compiler's specification to participate in its development
  So that we test the usefulness of the language on the system we are building

  @US-001 @US-002 @US-008 @EX-019
  Scenario: The seed compiler validates the declared self-description
    Given the agreed seed grammar supports the draft compiler self-description
    And the sources are compiler.expec and output.expec from specifications/draft
    And the manifest explicitly supplies the draft core dependency
    When the seed compiler validates the self-description
    Then ExpecCompiler.validate resolves Specification and ValidationResult
    And ExpecCompiler.build resolves Specification, BuildManifest, and BuildResult
    And SpecOutput declares create, insert, update, read, search, and delete
    And its options and ProjectContext are construction inputs rather than per-operation arguments
    And read, search, and delete reference the declared opaque SpecIdentifier type
    And every remaining reference resolves to a declared local or imported type
    And no implementation is claimed merely because those contracts are valid

  @US-003 @US-006 @US-008 @EX-020
  Scenario: A self-specification change updates the compiler while preserving the seed
    Given the seed compiler can generate into a connected fixture project
    And the fixture contains handwritten parser, resolver, and test-driver implementations
    And the fixture ExpecCompiler is explicitly associated with its specification concept
    And the fixture manifest selects TypeScript output
    When I add the inspect contract from EX-014 to the compiler's self-description and build
    Then the fixture compiler gains the declared inspect scaffold
    And the handwritten parser, resolver, and test-driver code remains unchanged
    And the independent acceptance examples can be run against the updated compiler
    And expected outcomes are taken from the reviewed examples rather than generated from the compiler's answers
    And this demonstrates specification-driven development without claiming full self-hosting
