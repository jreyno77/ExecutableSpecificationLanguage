# Candidate grammar fixtures

Status: proposed and unexecuted. These files express intended syntax acceptance or rejection for the v0.1 grammar proposal. No compiler, parser, runtime, test driver, or executable grammar check exists as a result of this work. They are source fixtures, not executable implementations.

Each listed entry is an independent example source set. Do not load every valid file into one module: several independent fixtures deliberately reuse ordinary names. The proposed `read(SourceDocument)` operation can inspect each physical file without loading any imported content. A semantic compiler will additionally need any specified dependency provider and source graph.

Primitive `Text`, `Number`, and `Boolean`, generic `List<T>`, and the no-result type `Nothing` are available without imports through language-provided declarations. `Text` is confirmed; the other spellings remain proposed. `URL` is a standard type explicitly imported from a proposed `expec:core` dependency in `models/system-config.expec`. Missing provider availability or an unknown custom type remains a later resolution error, not malformed source syntax. No external provider implementation is included. Imported paths and package names are ordinary string data in an explicit import context.

## Intended syntax-valid source sets

| Entry | Supporting files / purpose |
| --- | --- |
| [valid/store-game.expec](valid/store-game.expec) | `models/system-config.expec`, `models/player-state.expec`, `models/pair.expec`, `models/shopping-cart.expec`; public contracts, separate types, package requirements, and a local type. |
| [valid/shopping.expec](valid/shopping.expec) | `shopping.examples.expec`; declared domain helpers, an observation-backed check, and separately attached examples. |
| [valid/relationships.expec](valid/relationships.expec) | Player-state model files; a dependency plus explicitly ordered messages, a captured reply, and inline/top-level interaction forms. Relationships are derived from ordinary declarations. |
| [valid/reusable-setup.expec](valid/reusable-setup.expec) | Typed fixture values, helper defaults, composed setup, result capture, and observation dataflow. |
| [valid/language-forms.expec](valid/language-forms.expec) | `support/shared.expec`; a custom-type alias (`Mode` as `OperatingMode`) and include, all concept kinds, generic/opaque/union/optional/tuple/literal types, construction, ownership, extension, quoted names, and function contracts. |
| [valid/lexical-layout.expec](valid/lexical-layout.expec) | Comments, escaped quoted names and strings, cosmetic indentation, multiline parameters/lists/records/grouped expressions, and trailing commas. |
| [valid/literals-and-prose.expec](valid/literals-and-prose.expec) | Literal numeric/string expectations, explicitly marked prose, arithmetic and boolean precedence, and a scenario with multiple expectations. |
| [semantic/unresolved-public-capability.expec](semantic/unresolved-public-capability.expec) | **Syntax-valid but semantically invalid:** `saveGame` is referenced by the public list while only `save` is declared. The source reader accepts this structure; a later compiler must reject the unresolved reference. |

The shopping scenario records the user's desired four-call test body: `bookIsAvailable("Dune")`, `startWithEmptyBasket()`, `addBook("Dune")`, and `expectBookQuantity("Dune", 1)`. An output policy may generate the receiver `shopping` for a `Shopping` context; that target naming policy is not inferred by grammar recognition. The check explicitly calls `bookQuantity(title)` and compares the returned value with `expected`. Its bodyless observation and setup/action helpers still need real implementations. Parsing or generating this example cannot establish a passing shopping test.

The relationship fixture's message order is specified, not inferred from `depends on`. Its diagram can show the persist call followed by the confirmation call because both messages are present in source. The grammar does not prove that the participating system actually executes them. The user rejected both `relates "owns" to Cart` and `owns cart: Cart` / `uses storage: Storage`; neither is supported candidate syntax. GR-010 now uses valid/derived-relationships.expec to retain dependency, construction-input, capability-input, and output facts without introducing a separate relationship syntax.

## Intended syntax-invalid files

Locations below use one-based physical lines and columns for these ASCII fixtures. They identify the primary offending token or missing-token insertion point. Exact diagnostic wording and any secondary recovery messages remain open. Fixtures end with a newline, so EOF in `missing-delimiter.expec` is at line 3, column 1.

| File | Primary source location | Expected syntax issue |
| --- | --- | --- |
| [invalid/missing-colon.expec](invalid/missing-colon.expec) | Line 2, column 12 (`Number`) | A field name must be followed by `:` before its type. |
| [invalid/missing-delimiter.expec](invalid/missing-delimiter.expec) | EOF, line 3, column 1; related opener line 1, column 18 | A concept body has no closing `}`. |
| [invalid/unterminated-string.expec](invalid/unterminated-string.expec) | Opening quote, line 2, column 12 | The string reaches the end of the line without a closing quote. |
| [invalid/missing-operand.expec](invalid/missing-operand.expec) | Line 2, column 38 (`=>`) | Binary `+` is missing its right-hand operand. |
| [invalid/phase-order.expec](invalid/phase-order.expec) | Line 4, column 5 (`given`) | Setup cannot appear after a `when` phase. |

Do not report the absent declarations in these intentionally malformed files as the primary grammar finding. Name resolution is a later concern. Conversely, treating the semantic mismatch fixture as a syntax error would obscure the distinction this proposal is intended to make.

[valid/derived-relationships.expec](valid/derived-relationships.expec) supplies the agreed GR-010 input: dependency, construction input, capability input, and output, with direction derived after resolution.
