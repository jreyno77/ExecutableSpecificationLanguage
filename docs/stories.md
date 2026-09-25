# User stories for building .expec with .expec

Status: proposed story decomposition of the [confirmed language vision](checkpoints/2026-09-24-language-vision.md). These 11 stories describe desired behavior, using the language's own development as the first subject. They do not establish that a compiler, generator, or self-hosting system exists today.

The [development workflow](development-workflow.md) expands the progression observed in the recordings into a learning loop: broad need → pitch and proposed pieces → stories → Notion tasks carrying story summaries, high-level examples/tests, and falsifiable hypotheses → detailed specifications → generation → implementation → evidence and learning → revisiting the board, stories, and pitch. Scenario intent should use domain vocabulary; reusable support code should contain file handling, source inspection, compiler invocation, and other execution details.

The requirements summarized as **Confirmed** come from the user's request and clarifications. A confirmed need is not evidence that a proposed solution meets it. **Proposed examples** and sequencing are candidate acceptance agreements whose success criteria and limits should be recorded on the related tasks. Counterevidence can require revisiting the solution or examples. Names such as `ExpecCompiler`, `Specification`, and `ValidationResult` are illustrative declarations for discussing the compiler itself, not adopted syntax or architecture.

The [concrete acceptance examples and traceability map](../specifications/README.md) retain 34 earlier EX scenario definitions and add the current GR/CV cases. The earlier EX files remain historical and unbound. Selected GR/CV expectations now exercise the initial reader/compiler; the [coverage inventory](../specifications/acceptance/coverage.json) and [implementation evidence](implementation-evidence.md) distinguish that scoped progress from the remaining work. Backfilled design tasks do not establish completed stories or a tested full-scope hypothesis.

## US-001 — Describe concepts and public contracts

As a specification author, I want to declare concepts and their capabilities, inputs, outputs, relationships, and expectations so that another person or tool can understand what the software promises before its implementation is complete.

**Confirmed:** Concepts are broader than classes. Authors can work at different levels of detail, and a capability's expected behavior can include a literal result or a descriptive requirement.

**Proposed examples:** An author declares `ExpecCompiler`, its public `validate` capability, the input type `Specification`, and the result type `ValidationResult`. A reader can identify the validation contract and its types. The declaration establishes a contract even if validation has no implementation yet. Adding a prose expectation that invalid input reports a useful diagnostic preserves that intent without inventing a working diagnostic algorithm.

The acceptance examples should distinguish declared structure, expected behavior, and implementation obligations. The minimum valid declaration and the relationship between a separate public list and declarations still need design.

## US-002 — Resolve declarations and dependencies

As a specification author, I want every reference checked against available declarations so that a build catches missing or inconsistent contracts before changing my project.

**Confirmed:** A name must be declared locally, available elsewhere in the project, or supplied through a dependency. Mentioning a name does not declare it. An inconsistent capability reference must fail compilation.

**Proposed examples:** `ExpecCompiler.validate` references `Specification`, but that type is unavailable. Validation reports the unresolved reference. Making a declared `Specification` available resolves that error. If `ValidationResult` is still unavailable, validation continues to report that separate error. An available dependency can supply a declaration without requiring a duplicate local definition.

As a regression example, Store Game's public list contains `saveGame` while only `save` is declared. Compilation fails; an old handwritten `saveGame` method or a similar spelling does not repair the source specification. Exact diagnostic wording, imports, scope, and built-in types remain open. Rejecting the invalid source is required regardless of which compiler phase reports it.

## US-003 — Build into the manifest-connected project

As a project maintainer, I want the manifest to identify my software project and selected targets so that a build applies the specification directly to the project I actually maintain.

**Confirmed:** The manifest owns the connected project, target languages or output formats, dependencies, version, and build settings. Output can involve inline edits, new files, movement, and deletion under the preservation requirement.

**Proposed examples:** A manifest connects an existing compiler project and selects TypeScript. Building the declared validation contract creates the needed structure in that project's source. An unrelated handwritten helper remains intact. A second fixture uses a different connected path to prove the destination comes from configuration. An invalid source specification leaves the connected project's files unchanged.

Initial examples can exercise creation and a narrow structural update. Moves, deletions, package mappings, and arbitrary existing layouts need further examples. Field names and path-resolution rules are not settled by this story.

## US-004 — Offer project initialization

As an author starting a project, I want the tool to ask whether to initialize one when no project is connected so that I control where a new project is created.

**Confirmed:** With no connected project, the tool asks whether to initialize one. It uses the user's choice rather than creating an arbitrary destination automatically.

**Proposed examples:** An author requests a build without a connection, accepts initialization, and supplies the needed destination and target information. The resulting project is connected and receives the output. Another author declines; no project is created and no project files are changed. If required setup information is still missing, the tool obtains it before writing output.

The initialization interaction and target-specific starter structure remain open. These examples describe an observable choice, not a commitment to a particular CLI or graphical interface.

## US-005 — Produce readable executable specifications

As an implementer, I want examples to become tests expressed in the software's domain so that I can see which promised behaviors work and which still need implementation.

**Confirmed:** Output should include readable coded behavior tests that call domain operations, such as `shopping.bookIsAvailable("Dune")`, `shopping.addBook("Dune")`, and `shopping.expectBookQuantity("Dune", 1)`. The language should provide shorthand for these through scenarios, input/output examples, or other suitable constructs, and flesh out the reusable DSL as much as the specification allows. Literal expectations and prose expectations both need representation.

**Proposed examples:** A scenario reads: given a specification with an unknown input type, when it is validated, then that type is reported as unresolved. Shared helpers construct the fixture, invoke validation, and inspect the result. The scenario fails when the compiler incorrectly accepts the reference.

A prose expectation without a defined observation or execution binding produces a visible implementation obligation. It cannot count as a passing verification merely because a test file exists. The binding model, test framework, and incomplete-test policy remain decisions to make. These examples should determine the needed interfaces before selecting them.

The [acceptance-generation examples](acceptance-generation.md) propose the distinction between domain actions, observations, checks, and execution bindings. They illustrate working assertion generation alongside explicit unfinished observations, without requiring AI inference during a build.

## US-006 — Evolve structure while preserving handwritten code

As a maintainer, I want a revised specification to update project structure while retaining my implementation so that I can keep using the specification as the project evolves.

**Confirmed:** Existing method bodies, private state, helpers, exports, and unrelated content must survive. Both single-file and distributed implementations matter. Changing behavior may leave implementation work or temporarily broken target code.

**Proposed examples:** Start with the supplied Store Game implementation. Add a declared capability; the build adds its scaffold and retains the existing bodies and helper. Change the saving expectation from local storage to Supabase; the updated obligation becomes visible while the existing implementation remains available for revision.

For a rename, both specification versions must be valid and the intended correspondence must be established. `save` becoming `saveGame` should preserve its body once that correspondence is known. Removal must not silently erase handwritten work. Conflict handling, retention, and identity mechanisms need concrete decisions. An unchanged repeat build should produce no additional edits.

## US-007 — Generate alternative language and diagram outputs

As a software designer, I want to select another supported language or a diagram target so that the same declared contracts remain useful across implementation and design work.

**Confirmed:** The intended scope includes TypeScript, Kotlin, Java, Python, UML, Markdown, and future targets. Target selection belongs in the manifest, and a public extension API should allow additional exporters.

**Proposed examples:** Generate a TypeScript scaffold and a diagram from the same compiler specification. Both show the validation capability and the same input/output relationships. A future second code target expresses the equivalent contract using its own supported mappings. An unsupported mapping is reported, rather than presented as successfully generated functionality.

The first proof need not support every language. It should establish which contract information target generation must retain.

## US-008 — Use .expec to specify and eventually build .expec

As a language maintainer, I want .expec's own concepts and acceptance examples captured in its specification model so that developing the tool continually tests whether the language serves its intended purpose.

**Confirmed direction:** The user wants to apply the emerging system to its own development, starting with stories and examples.

**Proposed examples:** Describe `ExpecCompiler.validate(Specification) -> ValidationResult` in a provisional self-description. Trace its missing-declaration example to US-002. A bootstrap implementation later reads an agreed subset and generates part of its own contract or test scaffolding. Subsequent compiler changes are checked against those examples.

Writing a self-description is an immediate design activity. Generating some of the tool's artifacts is a later milestone. Full self-hosting requires separate evidence; neither a draft source file nor handwritten tests establishes it.

## US-009 — Organize specifications across files

As a specification author, I want to reference shared declarations and keep examples or other lengthy concerns in separate files so that the specification remains readable as it grows.

**Confirmed:** Language-level include/reference support should let examples live separately and be associated with a specification. The user also explicitly confirmed inline authoring; authors can choose either form. Other specification concerns should support similar organization. Existing declaration and name-resolution requirements still apply. `bindings` was rejected as a proposed keyword; no replacement spelling has been selected.

**Proposed examples:** Extract a shopping scenario into its own file, reference it from the specification, and retain the same generated test behavior. An unknown operation in that file produces a diagnostic at the actual reference. Moving a declaration between files preserves its association with handwritten output code. Import and attachment syntax remain open.

## US-010 — Extend output through a public API

As an exporter author, I want a defined extension API for generating another output format so that the same specification can serve new uses without each exporter rebuilding language interpretation.

**Confirmed:** The user wants a strong, extensible output API spanning code, tests, diagrams, documentation, and future targets. The chosen direction uses a shared resolved model and operations `create(spec)`, `insert(specDiff)`, `update(specDiff)`, `read(SpecIdentifier)`, `search(SpecIdentifier)`, and `delete(SpecIdentifier)`. Target options and a separate live project-context component are supplied when an output instance is configured, rather than on every operation. `read` retrieves a concept's complete current representation, including handwritten details and artifacts across files. `search` discovers its definition, uses, incoming dependents, and actual outgoing dependencies in the live project, including elements absent from the `.expec` specification. The identifier encoding and exact result schemas remain open; these read/search responsibilities are settled.

**Proposed examples:** Register a Markdown output and render resolved contracts and scenarios without changing the parser. Modify project files after constructing the output instance; subsequent reads, searches, and updates observe the new state. Output implementations report missing required information or unsupported mappings and preserve handwritten implementations through coordinated, target-aware updates. US-011 makes the live read/search behavior and specification comparison concrete. Return schemas and the remaining mutation details still need design.

## US-011 — Inspect and reconcile the live project

As a project maintainer, I want to read a concept's current implementation and discover its actual relationships so that I can understand how the connected project agrees with or differs from its specification before changing it.

**Confirmed:** A read returns all current source, representation, and artifacts associated with the concept, including handwritten implementation details even when they span multiple files. A search locates the definition and all uses or incoming dependents, and identifies actual outgoing dependencies. Discovery includes project components absent from `.expec`; the project context must reflect the live project rather than only an earlier generated model or a declared signature.

**Proposed examples:** Read `StoreGame` when its declaration, implementation, and related artifacts span several files. The result includes its current handwritten method bodies, private state, helper, and associated artifacts. Edit the saving implementation after configuring the output instance and read again; the new implementation is returned.

Search for `StoreGame` in a project containing an unmodeled launcher that uses it. The result locates the definition and that incoming use, along with the other uses and actual dependencies. The launcher is discoverable even though `.expec` does not declare it.

For a dependency comparison, the specification expects `a`, `b`, and `c`, while the live implementation uses `a`, `b`, and `d`. Report `a` and `b` as matched, `c` as expected but missing from the actual dependencies, and `d` as an actual project dependency absent from the specified dependency set. Retain those distinctions so the maintainer can decide the intended correction.

Discovery does not silently declare `.expec` symbols, make an unresolved source reference valid, or authorize deletion of project-only code. Reading, searching, and reporting this comparison leave the specification and project unchanged. Any later structural change continues to follow declaration-resolution and handwritten-code-preservation rules. The exact result schema and `SpecIdentifier` encoding remain design choices; the meaning of read, search, and this comparison is no longer an open question.

The [modularity and export notes](modularity-and-exports.md) collect related examples and remaining alternatives. The user explicitly wants to work through these choices collaboratively; existing syntax sketches are not fixed decisions.

## Proposed first development slice

Start with US-001, US-002, and US-003: declare the validation contract, reject an unavailable type, accept the corrected declaration, and generate a narrow scaffold into an existing connected project. Use US-005's readable scenario style from the beginning. Include an early US-006 proof that adding structure preserves handwritten code, using Store Game as the regression fixture.

For each example, record its initial state, action, observable result, and link to a story. Separate checks that can execute immediately from those awaiting compiler or driver implementation. This provides a reviewable path from today's design to executable specifications without treating illustrative grammar or unimplemented checks as finished software.
