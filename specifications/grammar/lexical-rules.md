# Candidate lexical and layout rules

Status: candidate v0.1 implementation baseline. This document and [language.ebnf](language.ebnf) define the reviewed lexical contract; an ANTLR-based reader and scoped tests now exist. See [implementation evidence](../../docs/implementation-evidence.md) for coverage and limits. Grammar acceptance does not establish resolved declarations, valid types, executable behavior, or successful target generation.

## Text, names, and comments

- Files use UTF-8; file decoding is outside the source-text recognition contract. An optional initial byte-order mark is ignored for tokenization but retained in source coordinates. LF and CRLF both represent a newline; lone CR is rejected.
- Spaces and tabs separate tokens and have no indentation meaning. Identical token sequences at different indentation levels have the same structure.
- `//` starts a comment outside strings and quoted names; it consumes text up to, but not including, the newline. Comments do not swallow a required statement boundary. Block comments are not proposed here.
- A plain identifier matches `[A-Za-z_][A-Za-z0-9_]*`. Identifiers and keywords are case-sensitive.
- A backtick-delimited identifier allows spaces, reserved words, and other Unicode characters in a name. It must contain at least one decoded character. Only escaped backtick and escaped backslash are supported inside it; an unescaped backtick ends it. Raw newlines and control characters are forbidden. Names are compared by their decoded characters; backtick quoting is not part of identity. No case folding or Unicode normalization is proposed.
- A dot separates the segments of a qualified name. A dot within a backtick-delimited name is part of that single segment. Source names are lookup syntax, **not** a commitment to the persistent `SpecIdentifier` used to preserve generated content across renames and moves.
- Double-quoted strings are data: literal values, descriptive text, scenario titles, and source/package locators in their specific contexts. They never stand in for a declaration name or a name reference.

Exact lowercase reserved words are:

~~~text
action and as assert build capability check class component concept construction
depends do ensures example examples extend false fixture for from function given
include interaction interface let local message not observation on opaque or
package participant promises public requires return returns runtime
satisfies scenario setup test then true type use when
~~~

Primitive types are available automatically through declarations supplied by the language, without source imports. The candidate built-in set contains primitive `Text`, `Number`, and `Boolean`, generic `List<T>`, and the no-result type `Nothing`. `Text` is a confirmed spelling; the other spellings and the numeric representation remain proposals. These names use ordinary identifier syntax. A source reader records their type references; later semantic validation distinguishes built-in declarations from user declarations.

Built-in availability does not make arbitrary names exist. Other referenced types must be declared or imported. `URL` is a standard type requiring an explicit import in these fixtures, not a primitive or automatic built-in. Its proposed provider locator is `expec:core`; no provider implementation is included here. A missing provider or an unknown custom type is a later resolution error, not malformed syntax. The `Nothing` type does not introduce an implicit `nothing` or `null` value.

## Strings and numbers

Double-quoted strings admit ordinary Unicode text except raw control characters, raw newlines, unescaped quote, and unescaped backslash. Supported escapes are `\"`, `\\`, `\n`, `\r`, `\t`, and `\uHHHH`, where each H is a hexadecimal digit. A Unicode escape denotes its encoded character; paired surrogate escapes represent one non-BMP character, and isolated surrogate escapes are rejected. Unknown escapes and unterminated strings are lexical errors. Multiline strings and interpolation are not proposed.

Unsigned number tokens match:

~~~text
[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?
~~~

Examples include `0`, `64`, `1.5`, `2e3`, and `4.2E-2`. Signs are expression operators, or part of the grammar for a negative numeric literal type. A decimal point needs a digit on each side. Numeric separators, hexadecimal literals, `NaN`, and infinity are outside this candidate. Exact numeric representation and arithmetic behavior are semantic decisions, not consequences of this token rule.

Use the longest recognized operator token. `=>`, `->`, `==`, `!=`, `<=`, and `>=` are indivisible. There is no `>>` operator; nested type arguments can end with `>>`. Write a separating space when two intended tokens would otherwise form one operator, for example `List<Number> = value`.

## Statement boundaries and delimiters

Curly braces delimit declaration, contract, type-field, helper, example, scenario, and interaction blocks. Newlines end simple statements and separate adjacent declarations or steps inside these structural blocks. Indentation is cosmetic. A statement immediately before its structural closing brace or end of file may omit its final newline. An empty or one-statement block may consequently fit on one line. Two adjacent statements on one line are invalid; semicolons are not terminators.

Blank lines and comment-only lines are permitted wherever the grammar repeats `newline`. Statements with an optional body require that body's opening brace on the same logical line as the header. Thus `capability save() {` begins a contract body; a newline after `capability save()` instead ends a bodyless declaration.

Line breaks are insignificant inside:

- Parameter and argument parentheses, and parenthesized expressions/types.
- List expressions and tuple types in square brackets.
- Generic parameter/argument angle brackets when recognized in a type position.
- Record expressions in curly braces, such as `Position { x: 1, y: 2 }`.

These collection forms require commas between entries and allow a trailing comma. A newline never substitutes for a collection comma. This differs deliberately from a structural record-type body, where `x: Number` and `y: Number` are field statements on separate lines. Structural braces are distinguished from record-expression braces by grammatical context; treating every pair of braces as one kind of lexical layout region would be incorrect.

Angle brackets in ordinary expressions are comparison operators, not a general newline suppression mechanism. A long expression can be parenthesized to continue onto another line. This proposal does not use backslash continuation. Import and dependency lists outside collection delimiters remain on one logical line.

## Expression precedence

From highest precedence to lowest:

| Level | Operators/forms | Association |
| --- | --- | --- |
| 1 | Calls and member access | Left to right |
| 2 | Unary `+`, unary `-`, `not` | Right to left |
| 3 | `*`, `/`, `%` | Left to right |
| 4 | `+`, `-` | Left to right |
| 5 | `==`, `!=`, `<`, `<=`, `>`, `>=` | One comparison only |
| 6 | `and` | Left to right |
| 7 | `or` | Left to right |

Parentheses override precedence. `not x == y` groups as `(not x) == y`; write `not (x == y)` when that is intended. Chained comparisons such as `a < b < c` are syntax errors; write `a < b and b < c`. Evaluation order, short-circuit behavior, numeric conversion, and allowed operand types still need semantic definitions.

Type postfix `?` binds more tightly than union `|`: `Text | Number?` means the union of `Text` and optional `Number`; `(Text | Number)?` makes the whole union optional. Tuple types require at least one element. Lists use the built-in generic `List<T>`; list expressions may be empty. A generic parameter or argument list cannot be empty. Record expressions can be anonymous or name an explicit type. Whether a record conforms to that type is checked after parsing.

## Structural distinctions that parsing must preserve

- A `requires package "vite" for build` member declares a package requirement. A contract-body `requires expression` records a precondition. They have distinct contexts and syntax.
- `promises "..."` and `satisfies "..."` mark prose. In `example "label": title() => "Dune"`, the expected value is a literal string. In `=> satisfies "a nonempty title"`, it is a descriptive obligation. No interpretation of the words inside the string chooses between these meanings.
- A scenario contains zero or more `given` steps, one or more `when` steps, then one or more `then` steps. Going back to an earlier phase is a syntax error. Each `given` or `when` step ends in a call; an optional `name =` captures its result. A `then` clause contains an expression, potentially a declared check call, or explicitly marked prose.
- Helpers have declared names and typed parameters. `setup`, `action`, and `observation` can be bodyless or contain ordered `let`, `do`, and `return` statements. Checks can additionally contain `assert`. A bodyless helper/check is representable but is not implemented or verified behavior. Parsing does not infer an implementation from its name.
- An omitted `returns` clause leaves the result unspecified; it does not silently mean `Nothing`. Within an `ensures` clause for an explicitly typed return, the proposed semantic model supplies a context-bound `result` name. It is an ordinary identifier to the grammar, not a global declaration. A parameter named `result` in that same contract creates a semantic conflict to diagnose later. Repeated contract clauses are retained as separate clauses.
- An interaction preserves written participant and message statements in order. Each message names its sender and recipient operation, supplies arguments, and may capture a reply with `as`. A dependency alone does not imply a message or its ordering. Checking that participants, capabilities, captured replies, and arguments exist belongs to semantic validation.
- Relationships are derived from declared dependencies, constructors, capability/function signatures, outputs, and typed fields. No standalone relationship keyword is needed. The rejected forms remain unsupported; explicit interaction messages retain their distinct ordered meaning.
- `local` explicitly introduces ownership for a type or concept-like declaration. `extend` supplies additional concept members. Scope, merge compatibility, duplicate declarations, and public-name resolution need semantic rules; parsing these forms does not authorize conflicting declarations.
- `use`, `include`, separate example attachment, and an ownerless `examples` block are explicit source-composition forms. Their graph, loading, and scope validation belong to later compiler work. A quoted source path is data in an import, not a source identifier.

Every EBNF rule reference is defined. The six lexical/layout rules using special sequences (`identifier`, `quoted_identifier`, `string`, `number`, `newline`, and `terminator`) are intentionally delegated to this document. This is a documentation consistency statement, not evidence that a parser accepts the fixtures.

## Source coordinates

The proposed `read(SourceDocument)` contract retains decoded source text and identifies it with a source ID. Offsets are zero-based Unicode scalar counts, and ranges are half-open `[start, end)`. Lines and columns are one-based; columns also count Unicode scalars, and a tab counts as one scalar rather than an expanded display width. CRLF contributes two offset units and one line break. An initial ignored byte-order mark still contributes one scalar to offsets and the first-line column. End-of-file diagnostics may have an empty range; an unmatched delimiter may also point back to its opening token. These conventions do not define file-system paths or declaration identity.
