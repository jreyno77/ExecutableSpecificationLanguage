# Compiler acceptance inputs

Status: authored fixtures for CORE-18, all unexecuted. No compiler, generated ANTLR parser, acceptance driver, dependency resolver, or test result is supplied by these files.

Each `.expec` file is one independent source input for [compiler.feature](../../acceptance/compiler.feature). Do not concatenate the directory into one module: independent examples deliberately reuse names. The future driver reads the chosen fixture as test setup, then passes its exact text and source identity to `Compiler.compile`. The compiler itself receives a `CompilationInput` snapshot and must not discover other files.

`valid` means intended to pass the proposed semantic rules with the catalog specified by its case; it does not mean implemented or behaviorally verified. `invalid` means intended to be rejected. The three `deferred` fixtures are grammatical but need source composition from a later task; the current compiler must return `composition-required` instead of pretending their contribution is complete. Relationships are derived from ordinary declared uses, without a dedicated keyword.

## Built-ins and supplied catalogs

`Text`, `Number`, `Boolean`, `List<T>`, and `Nothing` come from the built-in catalog without source imports. Custom types still need declarations or explicit dependency exports. `valid/store-game.expec` declares its own opaque `URL` and all of its custom model types to make its type dependencies self-contained.

These named catalog fixtures are **input facts**, not canned compiler output. The future test adapter constructs complete `DependencyModule` symbol/type records according to [compiler.expec](../compiler.expec), including the record fields, declaration origins, export IDs, built-in type references, and generic applications below. It must not replace a module by a list of untyped names or a previously expected `CompilationResult`.

| Catalog | Module locator | Public export | Complete record contract |
| --- | --- | --- | --- |
| Standard results | `results` | `ValidationResult` | `accepted: Boolean`; `messages: List<Text>` |
| Standard payments | `payments` | `Receipt` | `total: Number` |
| Standard shipping | `shipping` | `Receipt` | `tracking: Text` |

The two `Receipt` exports are different declarations with different module origins, even though their exported names match. Each catalog record is a named nominal type with no generic parameters, no field defaults, no optional fields, and no callable members. Its export points to that record's declaration; all required primitive/container type records must be included or linked according to the input contract. An omitted module is unavailable, regardless of similarly named files on disk.

The Store Game success case additionally supplies these package entries:

| Package alias | Configured phases |
| --- | --- |
| `vite` | `build` |
| `supabase` | `runtime` |

These entries say that the package requirements are configured. They do not say that packages are installed, reachable, compatible at runtime, or capable of implementing the promised behavior. Missing `supabase` is an input change exercised by CV-008. No package download or installation belongs to these compiler cases.

## Coverage and legacy examples

The acceptance cases identify exact files and any supplied catalog. Positive fixtures cover Store Game, implicit built-ins, local and imported types, generics and aliases, recursive records, defaults, contracts, typed helpers, captures, readable shopping scenarios, unfinished promises, and ordered interaction messages. Negative fixtures isolate the related resolution, scope, type, flow, contract, and syntax failures.

| Earlier intent | Current compiler case |
| --- | --- |
| EX-001: a fully declared contract is valid | CV-001, CV-002 |
| EX-002: an unavailable input type is rejected | CV-003 |
| EX-003: an unavailable public capability is rejected | CV-004 |
| EX-004: a supplied declaration can satisfy an import | CV-008 |
| EX-005: an unsupplied nearby file does not declare a type | CV-022 |

The earlier examples remain historical design artifacts; this table carries their intent forward without claiming notation compatibility or rewriting their files.

Expected diagnostic locations and semantic facts are written in the feature independently of future compiler output. They are not parser snapshots. Tests should compare declaration bindings, checked types, source provenance, and unfinished obligations through the actual public result. They must not satisfy an assertion by reparsing the fixture in the observation helper or by returning the expected answer directly.

CV-024 specifies the eventual clean-checkout ANTLR and acceptance path. It is an implementation obligation, not a command executed by creating this directory. All CV cases remain `@unbound` until real bindings and the real compiler make their outcomes observable.
