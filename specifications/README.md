# Building .expec through its own specifications

These specifications are part of the [development learning loop](../docs/development-workflow.md): broad need → pitch and proposed pieces → [user stories](../docs/stories.md) → substantial construction tasks → detailed and executable specifications → generation when supported → design and implementation → evidence and learning → revisiting the board, stories, and pitch. Task bodies contain only **Hypothesis**, **Test list**, and **Learnings**; detailed architecture and implementation steps emerge through the specifications and work.

The examples describe observable behavior of .expec itself. They are the starting point for its implementation, not a description generated afterward from whatever the implementation happens to do. Confirmed needs do not prove a proposed solution. Each task should identify the scope in which its examples support a hypothesis and what counterevidence would require reconsideration. Keep failed or incomplete checks visible rather than changing them merely to make an implementation appear successful.

The current set has 18 construction tasks, 11 stories, and **78 scenario definitions: 34 earlier EX, 19 grammar GR, and 25 compiler CV scenarios**. The [coverage inventory](acceptance/coverage.json) records **8 bound, 2 partially bound, and 68 unbound** definitions. CORE-01 and CORE-18 are **Implementing**, with full-scope hypotheses **Inconclusive**; the remaining 16 tasks are **Captured** and **Untested**. Their Ready specifications remain the implementation baseline. An initial TypeScript reader/compiler and real acceptance tests run; target generation and connected-project updates remain later work. See [implementation evidence](../docs/implementation-evidence.md).

## Ready specifications: grammar and compiler

[CORE-01's detailed specification](grammar/README.md) develops the first construction task into a syntax proposal, lexical rules, source fixtures, the `SyntaxReader.read` contract, and [GR-001–GR-019 acceptance scenarios](acceptance/grammar.feature), comprising 28 cases when outline rows are expanded. Selected cases now observe the real reader; the remaining complete GR scenarios need bindings. Reading does not run the described software, load imports, or generate targets.

The candidate distinguishes names from strings, literal expectations from prose obligations, and declared capabilities from public references. Syntax reading can retain a `saveGame`/`save` mismatch; semantic validation rejects it during compilation. Review confirmed import-free primitives and the working names `read` and `ReadResult`. Both suggested relationship styles were rejected; the user then chose to derive relationships from existing declarations, with GR-010 revised accordingly. Dependencies and explicit ordered interactions remain specified. The implementation uses antlr-ng with the antlr4ng runtime; pinned versions and commands are in the development guide.

[CORE-18's detailed specification](compiler/README.md) defines `Compiler.compile(CompilationInput)`, the reader/validator contracts, a concrete shared source model, supplied dependency catalogs, validation rules, and inspectable accepted or rejected results. Its [CV-001–CV-025 acceptance scenarios](acceptance/compiler.feature) comprise 56 expanded cases supported by 67 fixtures. The compiler core reads supplied source and validates against supplied metadata; project discovery, generation, and mutation remain later construction tasks.

The earlier EX scenarios and files under `draft/` are historical discovery sketches. They preserve requirement intent and earlier design alternatives; they do not define the current compiler API or claim conformance to the current grammar. The grammar and compiler specifications above are the current contracts.

## What exists now

| Artifact | Purpose | Current status |
| --- | --- | --- |
| [User stories](../docs/stories.md) | Identify who needs each behavior and why. | Drafted from the confirmed requirements. |
| [Grammar specification](grammar/README.md) | Define current language forms, source reading, supporting types, and source provenance. | Ready baseline; reader implementation and scoped tests exist. |
| [Grammar acceptance cases](acceptance/grammar.feature) | GR-001–GR-019 with concrete source fixtures and authored observations. | GR-001 bound; other complete GR scenarios remain unbound. |
| [Compiler specification](compiler/README.md) | Define the compiler core, shared source model, validation rules, catalogs, and results. | Implementing an initial subset; full contract remains incomplete. |
| [Compiler acceptance cases](acceptance/compiler.feature) | CV-001–CV-025, 56 expanded cases, and 67 supporting fixtures. | 7 definitions bound, 2 partially bound, and 16 unbound; see coverage inventory. |
| [Declaration examples](acceptance/declarations.feature) | Valid and invalid compiler contracts; explicit dependency resolution. | Concrete acceptance scenarios; no runner or bindings yet. |
| [Connected-project examples](acceptance/projects.feature) | Manifest destinations, initialization choices, and diagram output. | Concrete acceptance scenarios; no runner or bindings yet. |
| [Behavior and evolution examples](acceptance/evolution.feature) | Readable tests, incomplete behavior, preservation, and repeated builds. | Concrete acceptance scenarios; no runner or bindings yet. |
| [Domain-language generation examples](acceptance/dsl-generation.feature) | Shorthand scenarios become readable calls, comparisons, and explicit implementation obligations. | Concrete acceptance scenarios; no runner or bindings yet. |
| [Multi-file and configured-output examples](acceptance/modularity.feature) | Inline/external equivalence, included-source diagnostics, shared declarations, and interchangeable configured outputs. | Concrete acceptance scenarios; no runner or bindings yet. |
| [Live project inspection examples](acceptance/project-inspection.feature) | Complete reads, definitions and uses, dependency differences, freshness, and project-only consumers. | Concrete acceptance scenarios; no runner or bindings yet. |
| [Bootstrap examples](acceptance/bootstrap.feature) | Apply the specification to the compiler and independently check it. | Concrete acceptance scenarios; no runner or bindings yet. |
| [Earlier self-description](draft/compiler.expec) | Preserve the earlier validate/build compiler sketch. | Historical, authored by hand; superseded as the current compiler API. |
| [Earlier output API and context sketch](draft/output.expec) | Describe the six output operations, complete read/search behavior, constructor configuration, and live project context. | Historical notation; the output requirements remain tracked separately. |
| [Earlier core declarations](draft/core.expec) | Preserve the earlier explicitly imported primitive sketch. | Historical; current primitives require no imports. |
| [Draft manifest](draft/expec.manifest.example.json) | Show the compiler's own project connection and output choices. | Illustrative configuration; no tool reads it yet. |

The `.feature` files use readable Given/When/Then notation to preserve examples independently of the language grammar. Vitest bindings now exercise selected expectations; the files do not themselves become executable merely by existing. This does not make Gherkin part of .expec. The coverage inventory distinguishes bound, partial, and unbound cases; `@unbound` on historical EX features still means no executable binding, not a passing result.

## Story-to-example map

| Story | Concrete examples |
| --- | --- |
| US-001 — Describe concepts and contracts | EX-001 validates the compiler contract; EX-019 validates its fuller self-description. |
| US-002 — Resolve declarations and dependencies | EX-001–005 cover valid and missing declarations; EX-010 prevents applying an invalid build. |
| US-003 — Build into the connected project | EX-006 uses the manifest's destination; EX-010 preserves the previous project on rejection; EX-020 applies a self-specification change. |
| US-004 — Offer initialization | EX-007 accepts; EX-008 declines. |
| US-005 — Produce readable executable specifications | EX-011 checks a literal; EX-012 exposes unbound prose; EX-013 rejects incorrect validators; EX-017 invalidates old evidence after a changed requirement; EX-021–024 specify generated domain calls and assertion helpers. |
| US-006 — Preserve implementation during evolution | EX-014 adds; EX-015 renames; EX-016 detects a destructive removal; EX-017 changes behavior; EX-018 repeats a build; EX-020 exercises the compiler itself. |
| US-007 — Produce alternative outputs | EX-009 compares a code contract and a diagram. Additional language mappings need further examples. |
| US-008 — Develop .expec through .expec | EX-013 tests the compiler independently; EX-019 and EX-020 progress from self-description to self-generation. |
| US-009 — Organize specifications across files | EX-025 preserves inline/external example meaning; EX-026 locates errors in included files; EX-027 reuses one shared declaration. |
| US-010 — Extend output through a public API | EX-028 exercises configured TypeScript/Markdown outputs; EX-029–034 exercise read/search through the configured output API. |
| US-011 — Inspect and reconcile the live project | EX-029 reads all current parts; EX-030 finds definitions and relationships; EX-031 compares a,b,c with a,b,d; EX-032 checks freshness and coverage; EX-033 keeps inspection read-only; EX-034 distinguishes target identities. |

Examples for moves, compatible deletion, conflicting manual edits, and additional code languages should be developed within their construction tasks. The stories retain these requirements; the current examples do not claim exhaustive coverage. The [acceptance-generation design](../docs/acceptance-generation.md) explains the desired generated test level and the proposed deterministic semantics behind EX-021–024.

## Construction sequence

The [build plan](../docs/build-plan.md) contains 18 substantial construction tasks. The first two, grammar and compiler/validation, now have Ready specifications. Configuration and dependencies, imports and composition, and project connection and initialization follow. The candidate provides representative examples and exact proposed syntax, with relationships derived from declared uses; implementation may reveal reasons to revise it.

Subsequent tasks construct the extensible output API, live read/search, identity and structural diffs, TypeScript scaffolds, executable tests and domain helpers, setup and drivers, handwritten-code preservation, coordinated repeatable builds, UML, Markdown, and Kotlin/Java/Python support. The sequence concludes with self-development and the pilot, then packaging and exporter support.

Use the existing examples to develop the specifications for those tasks. **EX-001–005** cover declaration behavior; **EX-006, EX-014, and EX-018** cover connected output, preservation, and repeatability; **EX-029–034** cover live project inspection. These are checks within the construction work, rather than separate replacements for the task deliverables. Detailed architecture, internal steps, and further examples emerge while specifying and implementing each piece.

## How an example becomes executable

Each example needs a binding to the real system and an independent observation. The intent behind the historical EX-003 example maps to the current compiler boundary as follows:

```text
EX-003: Reject an unavailable public capability
  arrange: declare save and reference saveGame publicly
  act:     invoke the real Compiler.compile with the source and supplied catalog
  observe: compilation is rejected; the diagnostic identifies saveGame and its source location
```

The eventual test body should read in these domain terms. Helpers beneath it can create fixture projects, invoke the compiler, read diagnostics, and compare files. Those helpers must observe the real compiler and its filesystem effects. They must not replace the compiler with a pretend implementation that simply returns the expected answer.

| Domain operation in an example | Future binding | Independent evidence |
| --- | --- | --- |
| Compile and validate a specification | Compiler.compile with supplied source/catalog | Accepted or rejected result, diagnostics, and source locations |
| Build a connected project | Build API or command using the manifest | Changes inside that project's actual files |
| Answer the initialization question | A controlled interaction with the prompt | Whether the project was created and connected |
| Preserve implementation code | Read source before and after the build | Unchanged method bodies, helpers, and unrelated bytes |
| Read a concept | Configured output's read operation using its live context | Complete current content across the concept's files/artifacts |
| Search a concept | Configured output's target-aware project inspector | Definition, incoming uses, outgoing dependencies, and source evidence, including unmodeled code |
| Compare intended and actual dependencies | Resolved specification compared with search evidence | Matched a,b; missing c; project-only d, without editing either input |
| Execute a generated expectation | Target test runner and real implementation binding | Passing, failing, or explicitly incomplete execution |

Vitest runs the current independent bindings; source-editing mechanisms remain future work. CORE-18 specifies compiler diagnostic and result schemas. A bare test name or unbound sentence is not an executable assertion. Bindings that throw not-implemented errors must fail or remain explicitly incomplete; they must not count as verified behavior.

## Bootstrap sequence

1. Use the Ready CORE-01 grammar specification and its valid/invalid examples; derive relationships from ordinary declarations rather than adding a dedicated keyword.
2. Continue implementing CORE-18 with independent acceptance bindings. Its contracts and examples define the observable work; internal implementation choices remain testable hypotheses.
3. Run the relevant examples against the real compiler. Include deliberately incorrect behavior, such as a validator that always returns success, to check that the acceptance observations detect it. Record actual results and limitations.
4. Continue through the configuration, composition, connected-project, output, and preservation tasks in the build plan. Generate artifacts when those capabilities exist, while keeping unfinished implementation and test obligations visible.
5. In the self-development task, use the compiler to read its self-description and manifest and generate or update its own contracts and tests while preserving handwritten implementation. Exercise the Store Game pilot and record feedback against the original need.
6. Evaluate outcomes against independent checks, update Learnings, and revisit the board, stories, specifications, and pitch as necessary. Complete the remaining construction tasks and continue the learning cycle until the desired outcomes are met. Full self-hosting requires its own demonstrated result.

Self-description, generating the compiler's structure, and full self-hosting are different milestones. The current contracts are authored by hand; an initial compiler exists, but self-generation is not implemented. The bootstrap provides the initial machinery, and independently authored examples provide behavioral checks. Passing selected examples does not verify the entire language. Counterevidence is a reason to learn and revise; if an expectation changes for a justified reason, retain that rationale and rerun the relevant checks instead of reusing evidence for the earlier requirement.

## Provisional choices exposed by these examples

The following are candidate design choices, not new user requirements:

- `returns` distinguishes a return type from the `=>` prose expectation in the draft syntax.
- Explicit local dependency imports make selected declarations available; imported modules do not become visible merely because their files exist nearby.
- The older core sketch used explicit core imports. Current review supersedes that choice: primitives such as `Text` are available without imports. The current candidate also supplies `Number`, `Boolean`, builtin `List<T>`, and the no-result type `Nothing`; their full definitions and target mappings still need work.
- An unresolved declaration prevents applying a replacement build. An incomplete generated implementation remains a separate state.
- A declared rename mapping can connect old and new capability identities; the notation for that mapping is undecided.
- Deletion that would discard handwritten work yields a conflict and retains the affected code. A fuller retention policy remains open.
- The sample manifest uses JSON and paths relative to the manifest. Its filename and schema are provisional.
- The output self-description uses candidate construction and opaque-type syntax. Read/search responsibilities are confirmed, while result schemas and SpecIdentifier encoding remain undecided.

Scenarios tagged `@proposed-policy` exercise these proposals so the decisions can be discussed concretely. The historical [vision checkpoint](../docs/checkpoints/2026-09-24-language-vision.md) remains the source of confirmed requirements and earlier open questions.

## Earlier design synchronization checkpoint — September 25, 2026

Before the CORE-01 specification, the set contained 11 user stories and 34 identified acceptance-scenario definitions, including an outline that exercises two source layouts. Those stories, design notes, scenario map, example manifest, and draft self-description include multi-file authoring, configured interchangeable outputs, live project context, and the clarified complete-read/project-wide-search behavior.

This was design-level synchronization, not completed software or an exhaustive specification. The scenarios remain unbound and have not executed. Current grammar and compiler contracts now supersede the earlier syntax and compiler API sketches. Persistent identifier encoding, target adapters, detailed mutation rules, deferred relationship notation, and further edge-case examples still need work. The historical draft files are not evidence that a parser, resolver, or output API exists.
