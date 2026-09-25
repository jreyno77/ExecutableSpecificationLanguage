@draft @coverage-in-progress @CORE-01
Feature: Read candidate language source while preserving its authored meaning
  As a specification author
  I want my source to retain its written meaning or identify malformed syntax
  So that later compiler work receives an accurate description of what I wrote

  These scenarios describe candidate-0.1; selected bindings now exercise its reader.
  The coverage inventory identifies the complete cases still awaiting bindings.
  The acceptance driver submits source to the real read(SourceDocument)
  boundary and independently inspects its returned description or diagnostics.
  ReadResult is the agreed working return-type name; its class layout is not prescribed.
  Expected facts below are authored independently of the reader's output.
  Reading preserves custom references for later validation and does not execute examples or project changes.
  Built-in types are available without source imports; custom references still need declarations.
  Syntax-pending cases preserve domain intent without claiming an accepted source notation.
  Source locations use one-based lines and Unicode-scalar columns.

  Background:
    Given recognition follows the versioned candidate-0.1 grammar definition
    And fixture paths are relative to "specifications/grammar/fixtures"
    And each fixture-backed SourceDocument carries its fixture path as its source identifier

  @US-001 @GR-001
  Scenario Outline: Recognize simple and quoted concept names with their source locations
    Given the unmodified source fixture "<fixture>"
    When I submit that SourceDocument to the real reader
    Then the result is accepted
    And its description contains a concept named "<name>"
    And that name originates from "<spelling>" at line <line> column <column> of the submitted source
    And name quoting is distinguished from a literal string value

    Examples:
      | fixture                   | name       | spelling     | line | column |
      | valid/store-game.expec     | StoreGame  | StoreGame    | 4    | 9      |
      | valid/language-forms.expec | Store Game | `Store Game` | 22   | 9      |

  @US-001 @GR-002
  Scenario: Preserve declaration categories instead of treating every concept as a class
    Given the unmodified source fixture "valid/language-forms.expec"
    When I submit that SourceDocument to the real reader
    Then the result is accepted
    And its description distinguishes these declarations
      | name       | declared category | owner  |
      | Worker     | class             | source |
      | Gateway    | component         | source |
      | Store Game | concept           | source |
      | Settings   | data type         | source |
      | Driver     | interface         | Worker |
    And the additional stop capability is recorded as an extension of Worker
    And recognition does not replace the written categories with a target-language class choice

  @US-001 @US-002 @GR-003
  Scenario: Distinguish field types, literal restrictions, and default values
    Given the unmodified source fixture "valid/models/system-config.expec"
    When I submit that SourceDocument to the real reader
    Then the result is accepted
    And SystemConfig contains an os field restricted by the literal string "windows"
    And SystemConfig contains a gameroot field whose type refers to URL
    And SystemConfig contains a brightness field whose type refers to Number and whose default is the numeric literal 80
    And the os field name is located at line 3 column 3
    And the literal spelling "\"windows\"" is located at line 3 column 7
    And recognition does not turn the literal windows into a type reference or supply a declaration for URL

  @US-001 @US-002 @GR-004
  Scenario: Use implicit built-ins while preserving opaque, generic, tuple, union, and optional type forms
    Given the unmodified source fixture "valid/language-forms.expec"
    And Text, Number, and Boolean are available in the language's built-in scope without a use declaration
    When I submit that SourceDocument to the real reader
    Then the result is accepted
    And references to Text, Number, and Boolean retain those names without requiring source imports
    And the description invents neither import statements nor authored declarations for those built-ins
    And Token is recorded as an opaque type
    And SpecIdentifier is recorded as an opaque type without choosing an identity encoding
    And Handle declares the type parameter T without a represented implementation
    And Pair declares T and a tuple with two references to T in order
    And PairList refers to List whose sole argument is Pair whose sole argument is Number
    And Selection retains the alternatives "small", "large", 0, -1, true, and false as literal type values
    And Settings.label makes the whole union of Text and Number optional
    And recognition does not claim that custom references resolve or that generic arguments are valid
    When I submit a SourceDocument identified as "unknown-custom-type.expec" with this source
      """expec
      type Envelope {
        title: Text
        payload: MissingPayload
      }
      """
    Then that result is accepted
    And Envelope.title refers to the built-in Text type without an import
    And Envelope.payload retains the custom type reference MissingPayload
    And no MissingPayload declaration or built-in is invented
    And later compiler validation remains responsible for rejecting the unresolved custom type

  @US-001 @GR-005
  Scenario Outline: Preserve callable names, parameter order, and return types
    Given the unmodified source fixture "<fixture>"
    When I submit that SourceDocument to the real reader
    Then the result is accepted
    And the callable "<callable>" has the declared category "<category>"
    And its ordered input signature is "<inputs>"
    And its separately declared return type is "<result>"
    And a missing implementation body is not replaced by an inferred implementation

    Examples:
      | fixture                   | callable          | category   | inputs                       | result              |
      | valid/store-game.expec     | StoreGame.startup | capability | configurations: SystemConfig | Nothing             |
      | valid/store-game.expec     | StoreGame.newGame | capability | none                         | PlayerStateSnapshot |
      | valid/store-game.expec     | StoreGame.delete  | capability | none                         | Nothing             |
      | valid/language-forms.expec | multiply          | function   | a: Number, b: Number         | Number              |

  @US-002 @GR-006
  Scenario: Recognize an inconsistent public reference without declaring or repairing it
    Given the unmodified source fixture "semantic/unresolved-public-capability.expec"
    When I submit that SourceDocument to the real reader
    Then the result is accepted with no syntax diagnostics
    And StoreGame has a public reference named saveGame at line 2 column 10
    And StoreGame has a capability declaration named save at line 3 column 14
    And save has no parameters and no written return type
    And the description contains no capability declaration named saveGame
    And the reader neither renames save nor claims that the saveGame reference resolves
    And later compiler validation remains responsible for rejecting the unresolved reference

  @US-001 @US-002 @GR-007
  Scenario: Retain local declaration ownership without deciding visibility during recognition
    Given the unmodified source fixture "valid/store-game.expec"
    When I submit that SourceDocument to the real reader
    Then the result is accepted
    And SessionState is recorded as a local data type owned by StoreGame
    And its running field refers to Boolean and defaults to the literal false
    And its snapshot field is an optional reference to PlayerStateSnapshot
    And SessionState is not flattened into an unrelated top-level type
    And recognition does not claim that SessionState is available outside StoreGame

  @US-001 @US-010 @GR-008
  Scenario: Separate construction inputs from individual operation inputs
    Given the unmodified source fixture "valid/language-forms.expec"
    When I submit that SourceDocument to the real reader
    Then the result is accepted
    And Worker construction declares settings of type Settings followed by tag of type Text
    And tag has the default literal string "worker"
    And Worker.start has no input parameters and returns a reference to Nothing
    And construction inputs are not copied into the start signature
    And recognition does not create a Worker instance

  @US-001 @US-002 @US-003 @GR-009
  Scenario: Distinguish concept dependencies from external package requirements
    Given the unmodified source fixture "valid/store-game.expec"
    When I submit that SourceDocument to the real reader
    Then the result is accepted
    And StoreGame depends on the named references SystemConfig and PlayerStateSnapshot
    And StoreGame requires package "vite" for the build phase
    And StoreGame requires package "supabase" for the runtime phase
    And the package name "vite" originates from its quoted source at line 6 column 20
    And package locators are not recorded as concept declarations
    And recognition does not resolve or install either package or read a project manifest

  @US-001 @US-007 @GR-010
  Scenario: Preserve the declared uses from which relationship views are derived
    Given the unmodified source fixture "valid/derived-relationships.expec"
    When I submit that SourceDocument to the real reader
    Then the result is accepted
    And X explicitly depends on Y
    And X's construction receives y of type Y
    And X.make declares Y as its output type
    And Y.handle receives x of type X
    And each use retains its own source location and declaring owner
    And no separate relationship keyword or ownership promise is invented
    And later resolution can distinguish Y entering X from Y leaving X
    And none of these references implies an actual call or message order

  @US-001 @US-007 @GR-011
  Scenario: Preserve explicitly ordered messages and a captured reply
    Given the unmodified source fixture "valid/relationships.expec"
    When I submit that SourceDocument to the real reader
    Then the result is accepted
    And the interaction "save and show confirmation" belongs to GameScreen
    And it takes snapshot of type PlayerStateSnapshot
    And it declares participant screen of type GameScreen and participant storage of type GameStorage
    And it retains these messages in their written order
      | order | sender  | recipient | operation | arguments | captured reply | line | column |
      | 1     | screen  | storage   | persist   | snapshot  | receipt        | 14   | 5      |
      | 2     | storage | screen    | showSaved | receipt   | none           | 15   | 5      |
    And the top-level interaction "persist without a confirmation view" contains only the written persist message
    And recognition does not add a reply capture or showSaved message to that top-level interaction

  @US-001 @US-005 @GR-012
  Scenario: Distinguish literal expected values and preserve expression grouping
    Given the unmodified source fixture "valid/literals-and-prose.expec"
    When I submit that SourceDocument to the real reader
    Then the result is accepted
    And "eight times eight" calls multiply with numeric arguments 8 and 8 and expects the numeric literal 64
    And "a literal string result" calls label with no arguments and expects the literal string "Dune"
    And "operator precedence" describes adding 2 to the product of 3 and 4 with a separately written expected literal 14
    And "grouping" describes multiplying the parenthesized sum of 2 and 3 by 4 with a separately written expected literal 20
    And "logical operators" groups not before and and groups and before or
    And recognition retains these expressions without evaluating them or claiming that their examples pass

  @US-001 @US-005 @GR-013
  Scenario: Keep descriptive promises separate from return types and executable conditions
    Given the unmodified source fixture "valid/language-forms.expec"
    When I submit that SourceDocument to the real reader
    Then the result is accepted
    And multiply returns a reference to Number
    And its requires condition says both a and b are greater than or equal to 0
    And its ensures condition compares the written result reference with 0 using greater than or equal
    And it retains these descriptive promises in order
      | order | promise                             |
      | 1     | Return the product of the inputs.   |
      | 2     | Keep both input values unchanged.  |
    And neither promise is rewritten as a return type, implementation, or asserted comparison
    When I submit "valid/literals-and-prose.expec" as a separate SourceDocument to the real reader
    Then that result is accepted
    And "description of the digits" has the descriptive obligation "A nonnegative pair of digits starting with 6 and ending with 4."
    And the scenario "a descriptive obligation" retains both the title equality and the separately marked prose expectation
    And the prose obligations are not treated as literal expected result strings

  @US-001 @US-005 @GR-014
  Scenario: Preserve declared domain roles and an observation-backed comparison
    Given the unmodified source fixture "valid/shopping.expec"
    When I submit that SourceDocument to the real reader
    Then the result is accepted
    And Shopping owns setup declarations bookIsAvailable and startWithEmptyBasket
    And Shopping owns the action addBook and the observation bookQuantity
    And bookQuantity takes title of type Text and returns a reference to Number
    And the check expectBookQuantity takes title of type Text and expected of type Number
    And its first statement captures bookQuantity(title) as actual
    And its next statement asserts actual equals expected
    And actual and expected remain distinct references with their distinct roles
    And bodyless helpers remain declared without fabricated implementations

  @US-005 @US-009 @GR-015
  Scenario: Preserve a stateful scenario's phases, arguments, and source order
    Given the unmodified source fixture "valid/shopping.examples.expec"
    When I submit that SourceDocument to the real reader
    Then the result is accepted
    And its examples block has no subject written in this source
    And its scenario is named "a shopper can add an available book"
    And its description preserves exactly these steps
      | order | phase | called operation       | ordered arguments | line | column |
      | 1     | given | bookIsAvailable        | "Dune"            | 3    | 5      |
      | 2     | given | startWithEmptyBasket   | none              | 4    | 5      |
      | 3     | when  | addBook                | "Dune"            | 6    | 5      |
      | 4     | then  | expectBookQuantity     | "Dune", 1         | 8    | 5      |
    And recognition does not infer additional setup or execute any step

  @US-001 @US-005 @GR-016
  Scenario: Preserve reusable composition, declared defaults, and result flow
    Given the unmodified source fixture "valid/reusable-setup.expec"
    When I submit that SourceDocument to the real reader
    Then the result is accepted
    And defaultBook is a fixture of type Book initialized with a typed record whose title is the literal string "Dune"
    And stockedBasket defaults title to the member reference defaultBook.title and copies to the numeric literal 2
    And stockedBasket preserves these statements in order
      | order | written intent                         |
      | 1     | capture openBasket() as basket         |
      | 2     | call stockBook(title)                  |
      | 3     | call addCopies(basket, title, copies)   |
      | 4     | return basket                         |
    And the scenario captures stockedBasket() as basket before passing basket, "Dune", and 1 to addCopies
    And its final condition compares copiesIn(basket, "Dune") with the independently written literal 3
    And recognition does not compute a basket quantity or substitute defaults by executing setup

  @US-002 @US-009 @GR-017
  Scenario: Recognize imports, inclusion, and example attachment without loading their sources
    Given the unmodified source fixture "valid/language-forms.expec"
    When I submit that SourceDocument to the real reader
    Then the result is accepted
    And its import records the nonprimitive type Mode from "./support/shared.expec" under the local alias OperatingMode
    And its include records the source locator "./support/shared.expec"
    And neither form silently contributes declarations from the referenced source
    When I submit "valid/shopping.expec" as a separate SourceDocument to the real reader
    Then that result is accepted
    And it attaches "./shopping.examples.expec" as examples for Shopping
    And this attachment is distinguished from a declaration import
    When I submit a SourceDocument identified as "qualified-imports.expec" with this source
      """expec
      use catalog.Item as Product from "./not-loaded.expec"
      examples for shop.Shopping from "./not-loaded.examples.expec"
      """
    Then that result is accepted
    And its import retains the qualified name segments catalog and Item and the alias Product
    And its attachment retains the qualified subject segments shop and Shopping
    And the imported name starts at line 1 column 5
    And the absence of those files does not become a syntax rejection

  @US-001 @US-002 @US-005 @GR-018
  Scenario Outline: Locate malformed syntax at the offending text or missing delimiter
    Given the unmodified source fixture "<fixture>"
    When I submit that SourceDocument to the real reader
    Then the result is rejected
    And a primary diagnostic has category "<category>"
    And it explains "<issue>" without requiring an exact sentence
    And its source identifier is "<fixture>"
    And its source range starts at line <line> column <column>
    And its range identifies "<offending text>" rather than an unrelated name-resolution error
    And no accepted source description or verified behavior is reported

    Examples:
      | fixture                           | category            | issue                                  | line | column | offending text |
      | invalid/missing-colon.expec        | expected-token      | a field needs a colon before its type  | 2    | 12     | Number         |
      | invalid/missing-delimiter.expec    | expected-token      | a concept body needs its closing brace | 3    | 1      | EOF            |
      | invalid/unterminated-string.expec  | unterminated-string | a string has no closing quote          | 2    | 12     | opening quote  |
      | invalid/missing-operand.expec      | expected-token      | addition needs a right-hand operand    | 2    | 38     | =>             |
      | invalid/phase-order.expec          | unexpected-token    | given cannot follow when               | 4    | 5      | given          |

  @US-001 @US-005 @GR-019
  Scenario Outline: Recognize comments, escapes, and multiline forms with either supported line ending
    Given the source fixture "valid/lexical-layout.expec" with every newline encoded as <line ending> and no other text changes
    When I submit that SourceDocument to the real reader
    Then the result is accepted
    And its concept name decodes to "Display `name`"
    And that name starts at line 2 column 9
    And its original spelling has the half-open Unicode-scalar source range from <start offset> to <end offset>
    And render's multiline parameter list retains title followed by location
    And render's title default contains A, a space, a quoted word "quoted", a space, and title
    And render's location default contains C, a colon, one backslash, and books
    And the title fixture decodes to exactly
      """text
      Dune
      Part two!
      """
    And comments create no declaration and do not remove collection entries
    And the Measurements values retain the numeric literals 1 and 2 in order
    And the typed sample record retains its values entry containing 1 and 2
    And the multiline grouped example describes multiplying the sum of 2 and 3 by 4 with expected literal 20
    And recognition neither evaluates that expression nor claims its expected result was observed

    Examples:
      | line ending | start offset | end offset |
      | LF          | 63           | 81         |
      | CRLF        | 64           | 82         |
