# CORE-01 — Define the .expec language grammar

**Candidate 0.1 · September 25, 2026 · Ready · Hypothesis untested.** The user has moved this grammar candidate to Ready, with relationships derived from ordinary declarations. It has not been parsed or executed. Ready establishes an implementation baseline; learning can still revise its notation and contracts.

**Review amendments:** `Text` is a primitive, and primitives require no imports. The agreed reader operation is `read`, with `ReadResult` as its working result name. Both `relates "owns" to Cart` and the later `owns cart: Cart` / `uses storage: Storage` style were rejected. Neither style is candidate syntax. GR-010 now preserves dependencies and signatures from which relationship views are derived; no relationship keyword is needed. ANTLR 4 is the preferred parser-generator candidate, not an installed dependency. Shortening ideas are retained as design learning: remove repetition while preserving readable intent. They are not an adopted syntax redesign.

Task: [01 — Define the .expec language grammar](https://app.notion.com/p/3e6039145665819cb7bed5350ce614ad). Stories: US-001 concepts and contracts, US-002 available declarations, US-005 readable executable specifications, and US-009 file composition.

Notion copies: [Specification](https://app.notion.com/p/3e60391456658154b355f311127ba550), [rules and recognition contract](https://app.notion.com/p/3e6039145665815b9174fd3c2a616d55), and [acceptance cases and source fixtures](https://app.notion.com/p/3e603914566581cabc84f95897b4cf53). These are manually synchronized copies, not an installed publishing integration.

## Need and hypothesis

An author needs to describe software at different levels of detail, with enough precision that another person or a tool can understand the same contract. A compiler needs to distinguish definitions, references, data, promises, and examples without guessing from prose or existing implementation code.

**Hypothesis:** one readable grammar can express the current requirements consistently, and concrete examples can reveal ambiguity before we build the compiler. This task defines the full current language surface as one piece of work. The examples are observations within that task, not replacements for its scope.

The test perspective is the consumer's intent: can an author state the intended contract, and can a compiler consumer recover that meaning or locate a mistake? Expected answers are authored from that intent. They are not snapshots copied from a parser's current output. These tests should help us discover useful interfaces and responsibilities while leaving the implementation open to change.

## Read this specification

| Artifact | Purpose |
| --- | --- |
| [language.ebnf](language.ebnf) | Proposed syntactic rules for the complete current language surface. |
| [lexical-rules.md](lexical-rules.md) | Names, strings, whitespace, comments, delimiters, and expression precedence. |
| [recognition.expec](recognition.expec) | Handwritten self-description of the proposed grammar-consumer contract and supporting types. |
| [grammar.feature](../acceptance/grammar.feature) | GR-001–GR-019: 19 concrete scenario definitions (28 cases with outline rows), all unbound. |
| [Fixtures](fixtures/README.md) | Authored source inputs and the specific distinctions each input exercises. |

The EBNF and lexical rules together define recognition. This document defines the meaning that recognition must preserve, its result contract, and the boundaries with later work. If these artifacts disagree, that is a defect in the candidate specification to resolve; no implementation is the automatic authority.

## Confirmed needs and proposed notation

Confirmed needs include explicit available declarations, typed contracts, dependencies, inline and separate-file authoring, literal and descriptive expectations, readable scenarios, relationships, communications, and incomplete specifications that can be refined. References never invent their declarations. A public reference to `saveGame` with only `save` declared must fail compilation. Source names are not automatically the persistent `SpecIdentifier` used during project evolution.

The candidate chooses braces for structure, newlines between statements, backticks for names containing spaces or reserved words, and double quotes for data and prose. This replaces the ambiguous use of double quotes for both names and expectations in earlier sketches. The older files under `specifications/draft/` and `specifications/examples/` remain exploratory sketches; compatibility with them is not claimed. The rejected `bindings` keyword is not part of this proposal.

For example, these three uses have deliberately different meanings:

~~~expec
concept `Store Game` {}

function title() returns Text {
  promises "Return the displayed book title"
}

examples {
  example "exact title": title() => "Dune"
  example "descriptive title": title() => satisfies "A nonempty book title"
}
~~~

`Text` is supplied by the language as a primitive; it needs no import. `"Dune"` is expected data. The text following `satisfies` is a prose obligation requiring further executable detail. Neither a meaningful title nor recognition success proves behavior.

## Concepts, data, and responsibilities

The grammar is a versioned language definition. It does not inherently need a runtime `Grammar` class. ANTLR 4 is the preferred implementation candidate: a concrete `.g4` grammar would generate the lexer/parser behind `SyntaxReader.read`, with an adapter producing our source description and diagnostics. The EBNF here is a design document, not a runnable ANTLR grammar. Parser integration, semantic validation, and export remain separate responsibilities.

| Concept | Responsibility and supplied information | Dependencies |
| --- | --- | --- |
| Grammar definition | Defines valid forms, lexical rules, precedence, and the distinctions they carry. Candidate identity: `candidate-0.1`. | The confirmed language needs and explicit notation decisions; no software project or exporter. |
| `SourceDocument` | Holds a caller-supplied source identity and the exact decoded text to read. | Builtin `Text`. A source identity is diagnostic provenance, not a request to read a path. |
| `SourcePosition` / `SourceRange` | Locates a construct or error in that original source. | Builtin `Number`, source identity. |
| `SyntaxDiagnostic` | Explains a lexical or structural failure, its primary range, and optionally a related opening construct. | `SourceRange`, builtin `Text`, `List`. |
| `SourceDescription` | Retains the authored forms, declaration/reference distinctions, nesting, expressions, and ordering listed below. | Source provenance and the grammar's logical forms. References remain unresolved. |
| `ReadResult` | AcceptedSource or RejectedSource, with concrete fields defined in the self-description. | `SourceDescription`, `SyntaxDiagnostic`; includes the grammar version used. |
| `SyntaxReader` | Public boundary: `read(source: SourceDocument) returns ReadResult`. | A conforming implementation of the chosen grammar rules and the input/result types. No filesystem, package manager, project context, or exporter is required. |
| Compiler, later task | Obtains source, invokes recognition, resolves declarations, validates meaning, and supplies a resolved specification for later consumers. | The recognition contract, source/dependency supply, and semantic rules defined during CORE-18 and composition/configuration work. |

The self-description makes source and result fields concrete. CORE-18 now supplies the concrete [SourceDescription](../compiler/source-model.expec) and its [access contract](../compiler/model-contract.md), replacing the earlier opaque placeholder. Shared source records live in `../shared/source.expec`, avoiding a reader/model import cycle. This refinement preserves the reading behavior and provenance specified here without exposing parser-generator classes.

### Proposed recognition contract

1. The caller supplies one `SourceDocument`. Recognition depends on its text and the fixed grammar version. Repeating that input preserves the same accepted/rejected result, meaning, and diagnostic locations.
2. Accepted source returns a description containing all recognized forms and their source provenance. Empty source and an explicit empty concept are valid incomplete specifications. Their acceptance supplies no undeclared behavior.
3. Rejected source returns at least one error diagnostic and no accepted description. A recovery implementation may find further errors; consumers must not rely on a fixed total or precise sentence wording. The acceptance cases identify the primary offending location and diagnostic category that must be present.
4. Proposed diagnostic categories are `unexpected-token`, `expected-token`, `unterminated-string`, `unterminated-name`, `invalid-escape`, and `invalid-character`. Missing syntax is located at the next offending token, or a zero-width range at end of source. An unterminated quote is located at its opening quote. A related range may identify the opening delimiter.
5. Ranges carry the source identity. Offsets count Unicode scalar values from zero, with an exclusive end; lines and columns start at one. A tab counts as one column. CRLF counts as two offsets but advances one line. Positions refer to the original decoded text, including comments, rather than a normalized copy. Decoding UTF-8 files is the source provider's responsibility.
6. `use`, `include`, package requirements, and external example attachments are recognized as authored requests. Recognition does not load those resources. Their absence is not a syntax error.
7. Recognition does not execute expressions, scenarios, capabilities, or generators. It does not resolve a name from a nearby file, existing project, or a familiar spelling.

### Information that must survive recognition

| Authored form | Observable information for the next consumer |
| --- | --- |
| Declaration | Kind, decoded name, owning scope, type parameters if present, members, and locations. A concept, component, class, interface, and data type remain distinguishable. |
| Type/field | Named references versus literal types; generic arguments; tuple order; unions; optionality; field names and defaults. |
| Capability/function | Declared name, ordered named parameters, types/defaults, specified or omitted return type, preconditions, postconditions, and prose promises. |
| Public contract | Public name references separately from capability definitions, even when their spellings do not match. |
| Construction/local declarations | Constructor inputs separately from operation inputs; nested declaration ownership separately from module scope. |
| Dependency | Named concept reference separately from package locator and optional build/runtime/test phase. |
| Composition | Selected imported names and aliases, source locators, inclusions, external example targets, and extension targets. |
| Relationship/interaction | Relationship label and direction; interaction participants, ordered messages, sender, recipient operation, arguments, and result captures. |
| Example/scenario | Owner, title, data fixtures, setup/action/check order, captured values, expressions, and literal versus prose expectations. |
| Helper | Setup/action/observation/check role, signature, body presence, ordered calls, local values, returned values, and assertions. |
| Expression | Operators and grouping, literal values, name references, arguments, member access, typed or untyped records, and list order. |

Preserve source ranges for declarations, references, fields/signatures, clauses, steps, and expression occurrences, including import paths and literal/prose values. The accepted description can retain the supplied document to preserve comments and exact spelling without assigning them executable meaning.

## Proposed meaning of the forms

These rules explain the intent the grammar carries. Recognition records the forms; later validation enforces their compatibility and availability.

- A declaration introduces its name in the containing scope. A reference only names something to resolve. Declaration order within a scope is not intended to change availability. A local declaration belongs to its enclosing concept; exposing a local type through a public signature needs a deliberate visibility rule during compiler design.
- `use Name from "source"` explicitly selects a supplied declaration; `as Alias` changes its local spelling. Qualified names preserve segments. `include "source"` requests composition in the including specification's scope. An `examples for Target from "source"` request attaches example content to an existing target; `extend Target` contributes members to an existing target. None creates the target or authorizes duplicate/conflicting definitions. Loading, cycles, repeated inclusions, and merge validation belong to the composition task.
- `depends on Storage` records a required concept relationship. `Storage` still needs a declaration in scope or an explicit import. Imported and locally declared types are available for signatures; repeating every type in `depends on` is not required by this candidate. A package requirement names an entry supplied through configuration, not a type declaration. Versions, destinations, and exporter options stay in the manifest.
- `public startup, saveGame` lists capabilities promised to consumers. Each must resolve to a capability declared for that concept. A declaration alone is not automatically public in this proposal. Repeating a public name or incompatible declaration is a validation error, even if the text is grammatically well formed.
- `returns Type` supplies a result type. Omitting it means unspecified, not silently `Nothing`. `promises` records prose; `requires` and `ensures` record expressions intended to be Boolean. The contract placeholder `result` is available in an `ensures` clause only when a return type is specified; it denotes the operation's observed result. A conflicting parameter called `result` requires a validation error. This contextual name is language-defined, not an inferred declaration.
- A type alias, record type, opaque type, and local type are distinct. Literal types constrain to their value; generic parameters are explicit declarations within that type. `T?` expresses optionality; its runtime representation and each target's mapping are later decisions. `Text` is a primitive supplied automatically by the language. The candidate also supplies `Number` and `Boolean`, plus builtin `List<T>` and the no-result type `Nothing`; these latter choices remain proposals. Builtin availability does not authorize inventing other types. `URL` remains an explicitly imported standard type in this candidate, and custom types must still be declared or imported.
- Relationships emerge from declared dependencies, construction parameters, capability/function inputs and outputs, and typed fields. The source reader preserves those uses; semantic resolution establishes their targets and direction. GR-010 exercises the existing forms. Neither rejected relationship spelling is supported. An interaction separately supplies participants and ordered messages; a structural reference alone supplies no sequence.
- A short `example "label": call() => expected` describes an invocation and expected value. More general expressions, including `8 * 8`, are representable. A literal arithmetic example tests expression behavior; it does not test a software capability unless that capability is actually invoked.
- A scenario orders setup (`given`), exercise (`when`), then observation (`then`). `given value = call()` and `when value = call()` introduce captures available to later steps. A `then` expression must eventually be a Boolean condition or a declared check invocation. A prose `then satisfies "..."` remains an execution obligation. Phase ordering is structural syntax; unknown helpers, incompatible arguments, and invalid captured-value use are semantic errors.
- Helpers give the generated test a domain vocabulary. `let` introduces a local value, `do` calls an operation, and `return` returns a value. A check's `assert` records a comparison or condition. An omitted helper body is unfinished implementation; a supplied body is still subject to type/meaning validation. An empty check must never be considered a verified assertion merely because its syntax is accepted.
- Parameter/field defaults and typed fixtures supply authored data. They do not supply missing operations or implementations. Behavior, lifecycle isolation, real-system drivers, and the treatment of unfinished execution belong to the executable-specification and execution-integration tasks.

For example, the grammar must retain these as different names:

~~~expec
concept StoreGame {
  public saveGame
  capability save(snapshot: PlayerStateSnapshot)
}
~~~

Recognition can accept the structure. Compilation must reject both unavailable references here: `saveGame` has no matching capability and `PlayerStateSnapshot` has no supplied type. Calling them semantic diagnostics internally must never soften the user-facing compile failure.

## From an acceptance example to implementation

Consider an author specifying how a shopper adds an available book. The grammar examples check that the setup, action, and observation survive in the correct roles and order. Later generation examples check that those forms produce this level of test:

~~~javascript
test("a shopper can add an available book", async () => {
  await shopping.bookIsAvailable("Dune");
  await shopping.startWithEmptyBasket();
  await shopping.addBook("Dune");
  await shopping.expectBookQuantity("Dune", 1);
});
~~~

For CORE-01 itself, an eventual acceptance test should be equally readable:

~~~javascript
test("public names retain their exact references", async () => {
  await language.sourceIs("semantic/unresolved-public-capability.expec");
  await language.readSource();
  await language.expectPublicReference("StoreGame", "saveGame");
  await language.expectCapabilityDeclaration("StoreGame", "save");
});
~~~

This is illustrative test shape, not executable code added to the repository. The fixture helper supplies text and a source identity. The exercise helper invokes the **real future** `SyntaxReader.read`. The observation helpers inspect its returned description, using a representation adapter if needed. They compare against values authored in the acceptance case; they do not answer by rereading the fixture and assuming recognition succeeded. Syntax-error tests inspect actual rejection diagnostics. The later compiler case additionally demands rejection of the unresolved reference.

These observations imply useful design boundaries—source input, recognition result, meaningful descriptions, provenance, and diagnostics. They do not require a particular parsing library, token stream, class hierarchy, filesystem layout, or target language. During implementation, a recognizer that drops public references, treats prose as a literal, changes scenario order, or always reports success must fail the corresponding cases.

## Scope and remaining design decisions

The specification covers the current authoring categories, with fixtures for broad and detailed concepts, types, contracts, examples, composition, dependencies, and communications. Relationships are derived from dependencies, constructor/capability signatures, outputs, and typed fields. Other reviewable choices include braces/newlines, backtick names, explicit prose markers, explicit public references, a small expression language, and Given/When/Then scenario phases. These choices may change when authoring and implementation expose friction.

This task does not promise unrestricted host-language code, arbitrary natural-language execution, inheritance rules, macros, concurrency semantics, or a plugin-defined grammar. The extensible output API can consume the shared specification without requiring every output to invent syntax. New authoring needs should extend the language deliberately with their own examples.

CORE-18 now specifies the concrete reader/model integration, diagnostics, and acceptance boundary; their implementation is still required before these cases execute. GR-010 uses existing declaration forms to preserve relationship direction and provenance. Semantic validation is also part of CORE-18, but is not a prerequisite for executing the other source-only grammar cases. Configuration, source loading/composition, connected projects, target generation, execution drivers, and safe project updates keep their existing construction tasks. ANTLR has not been installed, integrated, or tested here.

### Parser tool and concision discussion

[ANTLR](https://www.antlr.org/) generates a parser from a grammar and supports parse-tree traversal. Both [FSH](https://build.fhir.org/ig/HL7/fhir-shorthand/reference.html#grammar) and [CQL](https://cql.hl7.org/grammar.html) publish ANTLR grammars. This supports considering it here; it does not provide .expec's name resolution, relationship meaning, project updates, or exporters automatically. The language used to implement our parser is independent of the languages/formats our exporters produce.

The FSH/CQL comparison is a question for exploration, not a request to shorten the current grammar immediately. One useful distinction is structural shorthand versus readable behavioral expressions. FSH's paths and assignments work against supplied FHIR definitions; its [instance rules](https://build.fhir.org/ig/HL7/fhir-shorthand/reference.html#defining-instances) show the role of that existing model. Our candidate can similarly avoid repeating known context and primitive imports while keeping unknown project concepts explicit. Retain the shortening ideas as learning: avoid repeating known context, explore combining public visibility with a capability declaration, and keep behavioral language readable. The later review rejected `owns cart: Cart` and `uses storage: Storage` too; a shorter phrase alone did not make the relationship clear enough. A later user decision resolves this: derive relationships from existing declared uses. No standalone relationship syntax or broader shortening is needed.

**Learning checkpoint:** the earlier sketches used overlapping notation for names, strings, and promises. This candidate separates them and makes declaration availability distinct from text recognition. That is a design observation, not test evidence. The next useful review is to write and read these fixtures as an author, challenge ambiguous or cumbersome forms, then use the resulting contract to design the compiler. All GR cases remain unbound and unexecuted; no production behavior or grammar implementation is claimed.
