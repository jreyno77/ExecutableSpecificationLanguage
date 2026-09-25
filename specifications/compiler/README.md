# CORE-18 — Build the compiler and validation

**Compiler candidate 0.1 · Ready for implementation · Hypothesis Untested.** This specification is authored by hand. No compiler, ANTLR integration, acceptance runner, or generated implementation has been added or executed. Ready means that the construction work has an explicit contract and observable acceptance criteria.

Task: [02 — Build the compiler and validation](https://app.notion.com/p/3e6039145665815db0bdc490acf8a18c). Stories: US-001 concepts/contracts, US-002 declaration availability, US-005 executable specifications, and US-008 developing .expec through its own specifications.

Notion copies: [Specification](https://app.notion.com/p/3e6039145665818c940af6af42bf3be2), [interfaces and semantic rules](https://app.notion.com/p/3e603914566581439448eeccae53b99a), [shared source model](https://app.notion.com/p/3e603914566581a999fbfac77603bc07), and [acceptance cases and fixtures](https://app.notion.com/p/3e60391456658149a2c2c50bcf9afb63). These are manually synchronized copies.

The grammar task is Ready by the user's direction. The user has accepted relationships derived from dependencies, constructors, capability/function inputs and outputs, and typed fields. No standalone relationship syntax is required. Explicit ordered messages remain distinct. The learning about reducing repetition while retaining narrative readability remains a design consideration; this task does not redesign the source notation.

## Consumer need and hypothesis

An author needs to know whether their specification consistently describes something that could be implemented. A later exporter needs a trustworthy, inspectable description of the declarations, contracts, references, types, examples, dependencies, and messages. Neither consumer should have to guess what an unavailable name meant or treat a prose promise as a passing test.

**Hypothesis:** a compiler built around explicit source reading and semantic validation can reject inconsistent specifications and supply one meaningful model for later tools, while keeping unfinished implementation distinct from invalid declarations.

The tests start with authored intent. For example, if an author promises `saveGame` but declares `save`, a compiler must report the unavailable public capability, locate the reference, and return no accepted model. That example leads naturally to a reader, a representation of declarations versus references, a scope/resolution responsibility, and useful diagnostics. It does not prescribe an internal call sequence or the number of classes in the implementation.

## Specification artifacts

| Artifact | What it makes concrete |
| --- | --- |
| [compiler.expec](compiler.expec) | Compiler/validator interfaces; input, catalog, result, diagnostic, symbol, type, and obligation records. |
| [source-model.expec](source-model.expec) | Concrete source description shared by the reader and validator. |
| [model-contract.md](model-contract.md) | Node meanings, graph invariants, provenance, and how consumers inspect source data. |
| [semantic-rules.md](semantic-rules.md) | Name, scope, type, contract, scenario, helper, and interaction validation policies. |
| [compiler.feature](../acceptance/compiler.feature) | CV-001–CV-025: 25 scenario definitions, 56 cases with outline rows; unbound and unexecuted. |
| [Compiler fixtures](fixtures/README.md) | 67 concrete source fixtures and supplied catalog facts for those cases. |
| [Shared source records](../shared/source.expec) | SourceDocument, SourcePosition, and SourceRange without a reader/model import cycle. |

## Scope of this construction task

The public entry point compiles **one supplied source document** against a supplied dependency snapshot. This is the compiler core contract; source identities and dependency locators are data, not permission to discover files or contact a package registry. Its consumer may be an editor, a future build coordinator, or an independently written acceptance driver.

This task covers implementing the ANTLR reader, its source-model adapter, declaration and type validation, result/diagnostic handling, repeatable compiler construction, and the real acceptance integration. It covers the current grammar's concepts, record/alias/opaque/local types, generics, imports from supplied exports, package declarations, signatures, contracts, inline/subject-attached examples, helpers, expressions, dependencies, and interactions.

`use` selects exports from catalog entries already supplied to the compiler. It does not load their files. `include`, `extend`, and an external examples attachment require composition before semantic validation; this core entry point reports `composition-required` rather than ignoring them or declaring an incomplete model valid. Task CORE-13 will supply and integrate file composition, preserving original provenance. The separate source-reader and validator contracts give that work a place to integrate without forcing a directory loader into this compiler call.

Configuration and dependency management will construct the catalog from actual configuration and library metadata. Project connection, initialization, project inspection, generation, execution drivers, and safe project mutation remain their existing tasks. A configured package entry proves declared availability only; it does not prove the package has been installed. A source-level compile does not run the software or its scenarios.

## Public boundary and dependencies

~~~text
Compiler(reader: SyntaxReader, validator: SemanticValidator)
  compile(input: CompilationInput) -> CompilationResult

SemanticValidator(builtins: BuiltinCatalog)
  validate(input: ValidationInput) -> CompilationResult

SyntaxReader
  read(source: SourceDocument) -> ReadResult
~~~

`Compiler.compile` is the author-facing operation for this task. It performs reading and validation; a second public compiler `validate` operation with identical work is unnecessary. `SemanticValidator.validate` is a component contract, useful for composition and focused validation integration. The earlier ExpecCompiler validate/build sketch remains historical; building a connected project is a later coordinator responsibility.

| Component/data | What it owns | Required input/dependencies |
| --- | --- | --- |
| Grammar definition | Recognizable forms, lexical rules, precedence, and original-source ranges. | The Ready grammar candidate; relationships derived from declarations. |
| ANTLR-backed SyntaxReader | Reads text and adapts the generated parse tree into our SourceDescription; converts lexical/syntax failures into ReadResult. | Generated lexer/parser and their matching runtime; shared source records and source model. |
| SourceDescription | Preserves declarations, names, references, values, bodies, and order with exact provenance. | SourceNode IDs, closed payload variants, and SourceRange. |
| SemanticValidator | Establishes scopes, binds references, checks types/contracts, and identifies remaining obligations. | SourceDocument/SourceDescription, fixed builtin catalog, supplied dependency catalog. |
| Compiler | Coordinates the public read-and-validate operation and returns one accepted or rejected result. | SyntaxReader and SemanticValidator; neither project context nor exporter. |
| DependencyCatalog | Describes explicitly available module exports and configured package aliases. | Caller-supplied immutable metadata snapshot; no hidden provider callback. |
| ResolvedSpecification | Supplies inspectable source plus symbols, bindings, type facts, imports, public contracts, and dependency/package uses. | Successful validation; no unresolved required reference. |
| Acceptance driver | Supplies inputs, invokes the real compiler, and independently observes its returned result. | Authored fixtures/expected answers and the implementation's public API. |

This is a proposed decomposition. The implementation may combine internal algorithms or use functions instead of classes while satisfying these boundaries. Generated ANTLR classes are private to the reader adapter; callers consume our data contracts.

~~~mermaid
flowchart LR
  A["SourceDocument"] --> R["SyntaxReader.read\nANTLR + adapter"]
  R --> S["SourceDescription"]
  S --> V["SemanticValidator.validate"]
  D["Builtin and dependency catalogs"] --> V
  R --> E["Rejected: diagnostics"]
  V --> E
  V --> M["Accepted: resolved specification\nand remaining obligations"]
~~~

## Input and result rules

1. `CompilationInput` contains the exact SourceDocument and a DependencyCatalog snapshot. The core compiles one document per call. Reusing the same compiler with a changed source or catalog must observe the new input; earlier declarations must not leak into it.
2. The builtin catalog is the fixed candidate profile: `Text`, `Number`, `Boolean`, generic `List<T>`, and return-only `Nothing`. Text and primitives require no imports. Other types, including URL, must be declared or supplied through an explicit import. Invalid builtin profiles are construction/configuration errors, not a way to redefine language semantics silently.
3. Each supplied module has a unique locator, typed symbol/type tables, and an explicit export list. Catalog IDs must be unique within the supplied snapshot and every referenced header/type ID must exist. Imports cannot select non-exported symbols. Modules do not enter scope merely because they appear in the catalog.
4. Catalog headers describe actual declaration kinds, generic arities, fields, callable signatures, and public members. An arbitrary name or a prewritten success answer is insufficient dependency metadata. External symbol provenance stays external; the compiler must not pretend it was declared in the submitted source.
5. Package clauses require an entry with a compatible phase in the supplied package catalog. An omitted source phase retains that absence and requires only an available alias. Missing aliases/phases fail validation. No package installation or version fetching occurs here.
6. A syntax error rejects the document without semantic validation of a repaired tree. ANTLR recovery may help collect diagnostics, but must never silently turn a repaired parse into accepted author intent.
7. If semantic, input, or required-composition errors exist, return RejectedCompilation with diagnostics and **no ResolvedSpecification**. Internal diagnostic recovery information may exist but is not an exportable successful result. Unexpected implementation failures surface as failures; they must not be relabeled author mistakes or empty success.
8. An accepted result has an empty error-diagnostic list, the complete resolved specification, and any remaining obligations. A bodyless capability or a prose promise can be a valid specification while implementation or checking remains unfinished.
9. Every example/scenario receives `execution-not-performed`; prose expectations additionally receive `prose-needs-check`. This compiler neither proves that `multiply(8, 8)` returns 64 nor counts an unimplemented helper as a passing test.
10. The result retains the original document and source model. Every authored reference needing a declaration has an unambiguous binding. Context-defined `result` symbols have explicit contextual provenance rather than fabricated authored declarations. Absence of a written return type remains observable.

## Model contract for later consumers

The source model is a concrete ordered node table, described in model-contract.md. The resolved model keeps it and adds typed facts rather than replacing authored text with target-specific code.

`SymbolRecord` describes a declaration's kind, containing symbol, provenance, generic parameters, fields, callable signature, and public members. Unused signature lists are empty; optional fields are absent when inapplicable. `resultSpecified` distinguishes a deliberately declared `Nothing` from an omitted result. `members` contains only direct members; `publicMembers` selects capabilities belonging to that concept. Anonymous records do not invent globally named types.

A construction declaration has a nonpublic `construction` member symbol with owned parameter symbols and its ConstructionNode as source origin. It has no return type and creates no missing-result obligation. Because it has no authored name, its display path is its owner's path; IDs, not paths, identify symbols. Contextual `result` uses the explicit result kind and ContextOrigin. Scenario/interaction scopes can be identified through source containment without making their prose titles declaration names. A symbol's owner is its nearest containing symbol when one exists; source provenance retains the precise lexical scope.

For local parameter/field defaults, `defaultSource` identifies the authored expression. External catalog headers use `hasDefault` to describe omission rules and leave `defaultSource` absent; they must not invent nodes in the submitted document. A callable's explicitly declared return populates resultType, including Nothing's no-result shape. Check and noncallable symbols have no resultType and do not gain unspecified-result obligations just because `resultSpecified` is false.

`SemanticType` has an explicit discriminated shape. Primitive, nominal declaration/application, type parameter, literal, tuple, union, optional, list, and no-result types remain distinct. Aliases retain their source symbol while `aliasTarget` and type-resolution entries expose their checked expansion. ParameterShape identifies the declaring generic symbol and the parameter's zero-based position. LiteralShape stores decoded text/Boolean spelling or the exact finite decimal value spelling; source ranges retain the authored token regardless of normalization.

`ReferenceBinding` points from one actual ReferenceNode occurrence to its target symbol. `TypeResolution` gives every authored type node a checked type. `ExpressionType` records a value type when an expression produces a known value, or an explicit call-target, namespace, no-result, check-result, or unspecified-result role. A call returning Nothing has the no-result role; a check invocation has the check-result role. Only the value role has a valueType; the other roles do not invent values. `ResolvedImport` retains the locator, selected target, and local alias without changing the imported declaration's identity.

The compiler allocates symbol/type IDs deterministically within a result and preserves source/cross-catalog distinctions. SourceNode IDs, SymbolIds, and TypeIds are **not** the persistent SpecIdentifier required for project evolution. The encoding of persistent project identities remains in its own task. Consumers follow IDs and typed fields instead of searching source strings or interpreting error wording.

DependencyUse and PackageUse retain explicit declared relationships with provenance. Signature type references remain inspectable through bindings; they are not silently rewritten into explicit `depends on` clauses. Scenario/helper/expression trees and ordered message nodes remain available with their bindings and type facts. An exporter can inspect meaning without access to ANTLR or rerunning resolution.

## Diagnostics and obligations

Diagnostics include a stable machine code, phase, explanation, primary source range or input property path, and related locations. They identify the author's actual reference; a missing `PlayerStateSnapshot` must not be blamed on an unrelated field or reported only as a generic compiler failure. Duplicate/collision errors relate both occurrences. Catalog errors use input-property paths when there is no authored source range.

Report independent errors where practical. Do not cascade fabricated member/type errors from a single unavailable root name. Syntax failures prevent later-phase diagnostics for that document. Sort diagnostics by source identity/input path, primary position, phase, and code; wording may improve without breaking acceptance tests. Accepted model and obligation ordering follows source order with deterministic tie-breaking. Tests assert the cause, location, and absence of a successful model, not a fragile exact paragraph or incidental number of recovery messages.

| Condition | Stable code or obligation |
| --- | --- |
| Malformed source | Reader code preserved, phase `syntax`. |
| Missing declaration/imported export | `unresolved-reference`. |
| Unavailable module/package | `unavailable-dependency` / `unavailable-package`. |
| Invalid catalog closure or duplicate catalog identity | `invalid-dependency-catalog`. |
| Duplicate declarations or alias/local collision | `duplicate-declaration`. |
| Two explicitly selected exports make one name ambiguous | `ambiguous-reference`. |
| Inaccessible local declaration / public signature exposes local type | `inaccessible-reference` / `inaccessible-public-type`. |
| Wrong declaration category | `wrong-reference-kind`. |
| Type/argument/return incompatibility | `type-mismatch`, `argument-count`, or `generic-arity`. |
| Nonterminating transparent alias expansion | `cyclic-type-alias`. |
| Unknown/member/record field or missing required field | `unknown-member`, `unknown-field`, or `missing-field`. |
| Value used before introduction / duplicate capture | `unresolved-reference` / `duplicate-declaration`. |
| Omitted result used where a value type is required | `unspecified-result-type`. |
| Supplied empty check body | `missing-assertion`. |
| Composition has not occurred | `composition-required`. |
| Declared operation/bodyless helper/check needs implementation | `implementation-needed` or `check-implementation-needed` obligation. |
| Valid omitted return type, prose, unexecuted example, configured package | `result-type-unspecified`, `prose-needs-check`, `execution-not-performed`, or `package-installation-not-verified` obligation. |

This is an initial diagnostic vocabulary; semantic-rules.md specifies the behavior. New error codes may refine an uncovered case, but cannot make an invalid requirement pass. Obligations are never error suppression. A supplied helper body with an invalid return is rejected rather than called unfinished.

## ANTLR and implementation work

Use the agreed ANTLR direction. Implement a `.g4` grammar from the reviewed EBNF/lexical contract, then adapt its parse tree into SourceDescription. [ANTLR's listener/visitor documentation](https://github.com/antlr/antlr4/blob/master/doc/listeners.md) describes the parse-tree boundary this adapter uses. The source contract deliberately does not expose generated context classes.

Keep semantic checking outside embedded grammar actions. Exercise significant newlines, record-expression versus structural braces, nested generic delimiters, escaped identifiers, operator precedence, and original Unicode/CRLF positions through the GR cases. A parser-generator default is not authority to change the reviewed syntax. If an implementation constraint exposes an ambiguity, record it and revise the grammar with an example.

The implementation step must choose and document the bootstrap host language, exact supported tool/runtime versions, dependency locks, generation/build commands, and acceptance-runner command. Those are routine construction choices, not hidden assumptions in the language or exported target. A clean checkout must be able to regenerate the parser, build the compiler, and run the real acceptance suite with the documented prerequisites. Failing acceptance cases must make the command fail. No successful execution is claimed in this specification.

Suggested implementation responsibilities follow from the examples: adapt source and diagnostics; establish scopes and builtin/dependency availability; bind names; check types and expression contexts; validate contracts/helpers/messages; assemble results and obligations; bind the independent acceptance suite. These are internal construction steps within task 02, not new board cards.

## Acceptance perspective and readiness

An eventual test can read like this:

~~~javascript
test("a public promise must name a declared capability", async () => {
  await language.sourceIs("public-mismatch.expec");
  await language.compile();
  await language.expectUnavailablePublicCapability("StoreGame", "saveGame");
  await language.expectNoAcceptedSpecification();
});
~~~

The fixture helper supplies text and catalog facts. The exercise helper calls the real Compiler.compile. Observation helpers inspect returned diagnostics, bindings, and source ranges against the authored expected answers. They must not implement a second pretend compiler, answer from the fixture's filename, or compare generated output with expected output generated by the same compiler. Incorrect implementations that always accept, invent unknown types, drop public references, or silently ignore unsupported composition must fail their corresponding cases.

The source-model tables support targeted assertions—what `saveGame` binds to, whether a scenario capture precedes its use, what a field expects—without snapshotting an entire parser tree. Lower-level tests may then support implementation decisions as necessary. The acceptance cases verify useful promises to authors and later consumers.

The task is Ready when the grammar baseline/derived relationships, core/composition boundary, concrete source/result/catalog contracts, semantic policies, independently authored examples, and implementation/evidence expectations are explicit and consistent. That is the checkpoint this document provides. Runtime acceptance still needs the actual implementation; the hypothesis remains Untested. Revisit the task if implementation exposes a missing rule, an unusable interface, or a test that cannot detect its intended failure.

The earlier EX-001–EX-005 and EX-013 express related compiler intentions. Their old quoted-name sources and validate/build API are historical sketches, not a compatibility requirement. The current CV cases provide the binding target for this compiler contract. EX-019 self-description and EX-020 self-generation remain later integration milestones; defining these interfaces in .expec is a handwritten self-description, not evidence of self-hosting.
