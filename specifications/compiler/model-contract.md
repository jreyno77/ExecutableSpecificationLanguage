# Proposed source description contract

Status: handwritten public contract, now used by the initial reader/compiler implementation. [source-model.expec](source-model.expec) makes `SourceDescription` concrete; its presence alone is not implementation evidence. See [current evidence](../../docs/implementation-evidence.md) for tested scope. The records are not ANTLR parse-tree classes or a prescribed in-memory class hierarchy.

The reader and compiler share **one** `SourceDescription` declaration. The reader imports it rather than retaining a separate opaque declaration. Source location records come from [shared/source.expec](../shared/source.expec), so the source model does not import the reader and introduce a module cycle. `Text`, `Number`, `Boolean`, and `List<T>` are available through the language's built-in declarations.

## Shape and provenance

A description contains a source ID, ordered root IDs, and a table of `SourceNode` records. Each node has an ID, a `SourceRange`, and one member of the closed `SourcePayload` union. Union aliases such as `TypeNode` and `ExpressionNode` group these concrete record variants; they do not add wrapper objects. A consumer switches on `payload.kind`, follows documented child IDs, and reads values through typed fields. No compiler or test driver needs to inspect parser-generator classes, guess object keys, or parse diagnostic prose to find authored facts.

`SourceNodeId` is the pair `{sourceId, ordinal}`. The ordinal is a nonnegative integral `Number`, equals the node's index in `nodes`, and has meaning only within the particular submitted source snapshot. A later read may assign different IDs. These IDs are **not** persistent `SpecIdentifier` values, symbol names, or stable identities for project edits. Symbol IDs and dependency-catalog identities belong to the compiler's separate resolution tables.

The containing accepted read result retains the complete `SourceDocument`. The description does not copy its text. Its source ID and every node ID/range must match that document. Ranges use the shared conventions: zero-based Unicode-scalar offsets, half-open endpoints, and one-based scalar line/column positions. CRLF occupies two offset units and one line break. A node range covers the actual source construct, excluding trailing whitespace and its statement-ending newline; internal whitespace/comments remain inside the raw source slice. A block node includes its braces. Name ranges include their backticks when quoted. Literal ranges include quotes or the original numeric token. Operator ranges identify the operator token itself.

`NameNode.decoded` retains the decoded identifier and `quoted` retains its source form; original spelling comes from its range and the original document. No case folding or normalization occurs. `ReferenceNode.segments` contains ordered `NameNode` IDs, allowing `catalog.Item` to remain two segments and a quoted name containing a dot to remain one. Reference nodes represent authored usages. Declaring a name, importing an alias, and writing a reference are distinct relationships in the model.

String literals store decoded text, with raw escapes recoverable from source. Number literals retain their exact unsigned decimal token as `Text`, including fractional/exponent spelling. This avoids selecting floating-point precision or evaluating arithmetic during reading. An expression `-1` is a unary-expression node applied to a number-literal node. A literal type `-1` is a literal-type node with `negative = true` whose number-literal child retains `1`; the parent range includes the minus sign. Other literal types set `negative = false`.

## Graph integrity and authored order

The flat table represents an ordered syntax forest. Every listed child ID belongs to this description and exists exactly once in its node table. Every non-root node has exactly one structural parent, every node is reachable from `roots`, and structural child links have no cycles. References to external declarations are unresolved `ReferenceNode` data, not cross-document structural edges.

Roots follow source order. Each child list follows the order of its authored entries. The node table uses depth-first preorder: visit a node, then its children in their written order, with roots visited in order. When a record has several child fields, their order is the source form's order: for example a callable's name, parameters, return type, then body. This is an observable data-order proposal; it does not prescribe how a parser constructs the table internally. Child ranges must lie within their parent's range; equal ranges are allowed for wrappers such as a name-expression, its reference, and its name.

All required list fields are present, including empty lists. An optional field is absent when the author did not write that item; it does not cause a synthetic source node or a defaulted semantic value. In particular:

- Missing `returnType` means no return type was specified, not implicit `Nothing`.
- Missing `body` is different from a body node with an empty `members` list.
- Missing package `phase` records an unspecified phase, not an inferred runtime phase.
- Missing example `subject` can mean inline examples owned by a surrounding concept or an ownerless root block awaiting attachment. Structural containment preserves that distinction.
- Missing record `declaredType` identifies an anonymous record expression.

The identifier record type makes links concrete; the following child-category constraints give those links their public meaning. A malformed graph is a reader/adapter contract violation, not an authored undefined-name error.

## Child categories and coverage

The names in the final column refer to payload variants in `source-model.expec`. `Name` means `NameNode`; `Reference` means `ReferenceNode`; `Type` means the `TypeNode` union; `Expression` means the `ExpressionNode` union. Other variant names appear in full.

| Parent kind / source form | Child requirements and meaning |
| --- | --- |
| `reference` | Nonempty `segments` of Names; qualification does not resolve a symbol. |
| `use`, `import-item` | `imports` is a nonempty list of ImportItemNodes; `locator` is a StringLiteralNode. Each item has an imported Reference and optional alias Name. |
| `include`, `examples-attachment` | Locator is a StringLiteralNode; an attachment also has a subject Reference. Neither loads another document. |
| `concept`, `component`, `class`, `interface` | Name plus ordered member IDs. Members are DependenciesNode, PackageRequirementNode, PublicNode, ConstructionNode, capability CallableNode, LocalDeclarationNode, ExamplesNode, or InteractionNode. The category remains written, not mapped to a target class. |
| `record-type-declaration` | Name, ordered generic parameter Names, and ordered FieldNodes. |
| `alias-type-declaration` | Name, ordered generic parameter Names, and one target Type. |
| `opaque-type-declaration` | Name and ordered generic parameter Names; no fabricated fields or represented type. |
| `field`, `parameter` | Name, declared Type, and optional default Expression. |
| `local` | Exactly one ConceptNode or record/alias/opaque type declaration; the wrapper preserves explicit local ownership. |
| `extend` | A target Reference and members with the same permitted categories as a concept body. |
| `depends-on`, `public` | Nonempty lists of References. Public references each have one Name segment. Referencing a capability does not declare it. |
| `requires-package` | StringLiteralNode locator plus optional written phase. A package locator is not a concept reference. |
| `construction` | Ordered ParameterNodes; no capability name, body, or return type. |
| Callable kinds | Name, ordered ParameterNodes, optional return Type, and optional BodyNode. Capability/function bodies have kind `contract-body`; setup/action/observation bodies have kind `helper-body`; check bodies have kind `check-body`. A check has no authored returnType in the current grammar. |
| `contract-body` | Ordered ContractClauseNodes, retaining repeated clauses individually. |
| `promises`, `requires`, `ensures` | `promises.content` is a StringLiteralNode; the other contents are Expressions. The word `result` remains a Reference within an expression; its contract scope is a later semantic rule. |
| `examples` | Optional subject Reference and ordered FixtureNodes, helper/check CallableNodes, ScenarioNodes, or ShortExampleNodes. Inline examples have no written subject. |
| `fixture` | Name, declared Type, and value Expression. |
| `helper-body`, `check-body` | Ordered StatementNodes. Helper bodies permit let/do/return; checks also permit assert. |
| `let`, `do`, `return`, `assert` | A let introduces a Name and value Expression. Other statements have an Expression; do requires a CallExpressionNode at its root. Allowed result/condition types remain semantic checks. |
| `scenario` | StringLiteralNode title and ordered ScenarioStepNodes: given*, when+, then+. |
| `given`, `when`, `then` | Given/when content is a CallExpressionNode with optional capture Name. Then content is an Expression or ProseExpectationNode and never has a capture. |
| `example` | StringLiteralNode title, actual Expression, and expected Expression or ProseExpectationNode. |
| `prose-expectation` | `text` is a StringLiteralNode; the node range includes the explicit `satisfies` marker. This differs from a string-literal expected value. |
| `interaction` | StringLiteralNode title, ordered ParameterNodes, and ordered ParticipantNodes/MessageNodes. Preserve their original interleaving. |
| `participant`, `message` | Participant has Name and Type. A message has sender and receiver References, a one-segment operation Reference, ordered argument Expressions, and optional reply-capture Name. |
| `named-type` | One Reference and ordered Type arguments. An empty list means no generic arguments were written. |
| `tuple-type`, `union-type` | Ordered Types: at least one tuple element or at least two union alternatives. |
| `optional-type`, `grouped-type` | One inner Type. Parentheses remain represented instead of discarding explicit grouping. |
| `literal-type` | StringLiteralNode, NumberLiteralNode, or BooleanLiteralNode. Negative is permitted only with a numeric child. |
| Literal expression kinds | Decoded text, exact numeric token, or Boolean value as described above. Context determines whether a string is data, a title, a locator, or prose. |
| `name-expression` | One Reference containing one Name. An authored qualified expression becomes member-expression nodes. |
| `member-expression` | Receiver Expression and a one-segment member Reference. The reader does not decide whether the receiver is a value, namespace, or type. |
| `call-expression` | Callee Expression and ordered argument Expressions. No call is executed. |
| `record-expression`, `record-entry` | Optional NamedTypeNode and ordered RecordEntryNodes. Each entry has a Name key and value Expression. A key is authored field syntax, not an automatic declaration or unrelated lexical reference. |
| `list-expression` | Ordered Expressions, possibly empty. |
| `unary-expression`, `binary-expression` | Typed operator spelling, exact operator range, and operand Expressions. Nesting follows the grammar's precedence/association. |
| `grouped-expression` | One inner Expression; the node range includes parentheses. |

The complete root set is UseNode, IncludeNode, ExamplesAttachmentNode, ConceptNode, record/alias/opaque type declaration, function CallableNode, ExtensionNode, ExamplesNode, or InteractionNode. A root is not automatically a public symbol. All grammar forms are representable, including those the compiler core explicitly rejects as requiring a composition stage.

There is no payload for the rejected labeled-relationship notation. Ordinary dependencies and explicit interactions have their separate variants. Relationship views are derived from existing dependency and signature nodes after resolution. No dedicated relationship source node is needed.

## Reader data versus compiler facts

The source model records authored structure and locations. It does not contain resolved symbol targets, inferred types, synthesized imports, persistent project identities, or claims that requirements have passed. Built-in names are references to language-provided declarations when semantic validation resolves them; arbitrary unknown names remain unknown.

The compiler can reuse this graph and attach separate typed tables for symbols, reference bindings, type facts, public exposures, and implementation obligations. A binding identifies an exact ReferenceNode occurrence and its resolved symbol. Declaration symbols can point to their declaration and Name nodes; context-created symbols such as a return `result` must be identified as compiler/context facts rather than fabricated authored declarations. Type facts can point to the relevant TypeNode or ExpressionNode occurrence. Anonymous record shape checks can identify RecordEntryNodes without pretending that their field keys are lexical declarations.

Imported catalog declarations carry the catalog's own provenance and symbol identity. They are not added as source nodes claiming to have appeared in the submitted document. Each available reference still needs an explicit resolution rule or supplied declaration. A same-spelling name elsewhere is not sufficient evidence of a binding.

For the compiler core, supported imports resolve against the explicitly supplied immutable catalog snapshot. Include/extend/external example attachment are represented faithfully by this reader model while the compiler returns an explicit composition-required diagnostic until the composition task supplies a validated expansion. This model does not authorize file reads, package installation, or successful partial validation that drops unsupported source.

The model supports independent acceptance assertions: inspect the distinct public `saveGame` reference and `save` declaration; follow a shopping check's observation and equality operands; or inspect ordered messages and captured replies. Selected reader/compiler observations now execute, while complete shopping and interaction validation remains unfinished. Consult the coverage inventory rather than treating this list of possible observations as proof that each case passed.
