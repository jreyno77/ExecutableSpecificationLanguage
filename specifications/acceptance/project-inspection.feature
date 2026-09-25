@draft @unbound
Feature: Inspect current project representations and their relationships
  As a specification author
  I want to read complete concept implementations and search their actual uses
  So that I can compare the project I maintain with its declared specification

  Background:
    Given an isolated connected TypeScript project
    And the output is constructed with target options and a live project-context service
    And a SpecIdentifier identifies the StoreGame concept's target representation

  @US-010 @US-011 @EX-029
  Scenario Outline: Read every current part of a concept across supported file layouts
    Given StoreGame has a declaration, startup and save implementations, and a handwritten persistence helper
    And it also has handwritten private state and an implementation comment
    And those source parts are explicitly associated with StoreGame in <source layout>
    And tests/store-game.spec.ts is an associated acceptance-test artifact
    And every associated file is available to the project-context service
    When I call read with the StoreGame SpecIdentifier
    Then the result contains the current declaration, both implementation bodies, and persistence helper
    And the private state and implementation comment retain their full current content
    And it contains the current associated acceptance-test artifact
    And every returned part identifies its originating project file
    And no associated part is replaced by only a signature or the original generated template
    And the result accounts for every StoreGame part in this fixture

    Examples:
      | source layout                                                                  |
      | one file named src/store-game.ts                                                |
      | src/store-game.ts, src/store-game.lifecycle.ts, and src/store-game.persistence.ts |

  @US-010 @US-011 @EX-030
  Scenario: Search definitions and actual relationships beyond the authored specification
    Given StoreGame is defined in src/store-game.ts
    And its save implementation calls Storage.write and Logger.info
    And src/main-menu.ts imports StoreGame and calls its save capability
    And src/admin-tool.ts also imports StoreGame and calls save
    And AdminTool is absent from the authored .expec specification
    And all these references are statically resolvable by the selected target inspector
    When I call search with the StoreGame SpecIdentifier
    Then the result locates the StoreGame definition
    And it locates both imports and both save calls in main-menu.ts and admin-tool.ts
    And it identifies Storage and Logger as actual outgoing dependencies with their use locations
    And it identifies MainMenu and AdminTool as incoming consumers with their use locations
    And AdminTool is included even though it has no .expec declaration
    And the result distinguishes the definition, incoming uses, and outgoing dependencies

  @US-011 @EX-031
  Scenario: Compare declared dependencies with the dependencies found in the project
    Given the specification declares StoreGame's outgoing service dependencies as a, b, and c
    And each declared dependency resolves to an available specification declaration
    And StoreGame's current source actually uses services a, b, and d
    And d is an identifiable project service but is not a declared StoreGame dependency
    And inspection covers all outgoing service references in this fixture
    When I compare the declared dependencies with search results for StoreGame
    Then a and b are reported as matching dependencies
    And c is reported as declared but missing from the inspected implementation
    And d is reported as present in the implementation but unexpected by the specification
    And the comparison includes the source evidence for actual uses of a, b, and d
    And the comparison does not silently change either the specification or the implementation

  @US-010 @US-011 @EX-032
  Scenario: Existing output instances inspect fresh project state and disclose coverage gaps
    Given the output was constructed while StoreGame.save called DiskStore.write
    And an initial read and search observed that implementation
    When I edit the project so StoreGame.save calls DatabaseStore.write instead
    And I add src/cli.ts with an import of StoreGame and a call to save
    And the project-context service reports src/extensions.ts as unavailable for inspection
    And I call read and search again on the same output instance
    Then read returns the current save body containing DatabaseStore.write
    And search finds the DatabaseStore use and the new StoreGame references in cli.ts
    And search does not present the old DiskStore call as a current use in the edited method
    And the results disclose that src/extensions.ts could not be inspected
    And the search does not claim an exhaustive project-wide set of uses or dependencies
    And a relationship comparison does not claim a dependency is absent solely because it was not found in that incomplete coverage

  @US-002 @US-010 @US-011 @EX-033
  Scenario: Inspection observes project code without declaring names or editing files
    Given src/extra-consumer.ts defines ExtraConsumer and calls StoreGame.save
    And ExtraConsumer has no .expec declaration or configured import into specification scope
    And I record the current specification, manifest, and connected-project file contents
    When I call read and search with the StoreGame SpecIdentifier
    Then search reports the actual ExtraConsumer use
    And all recorded files retain their contents
    And no specification or project files are created or deleted
    And the observations do not add ExtraConsumer to the specification's declarations
    When I validate a separate candidate specification that references ExtraConsumer without declaring or importing it
    Then validation reports the unresolved ExtraConsumer reference
    And the previous inspection result does not silently supply that missing declaration

  @US-010 @US-011 @EX-034 @proposed-policy
  Scenario: Identify a concept's references rather than every matching spelling
    Given src/shop/store-game.ts and src/tools/store-game.ts each define a different StoreGame symbol
    And the supplied SpecIdentifier is explicitly associated with the symbol in src/shop/store-game.ts
    And src/play.ts imports that shop symbol under the alias Game and calls Game.save
    And src/maintenance.ts uses only the tools symbol
    And src/notes.ts contains the text StoreGame in a comment without referring to either symbol
    And the target inspector can resolve the fixture's module references and alias
    When I call read and search with the supplied SpecIdentifier
    Then read returns the associated shop concept's representation
    And search locates the shop definition and its aliased references in play.ts
    And it does not attribute the tools definition or maintenance.ts uses to the shop concept
    And it does not report the comment in notes.ts as a semantic use of the concept
    And the result identifies the matched target symbol without requiring a particular SpecIdentifier encoding
