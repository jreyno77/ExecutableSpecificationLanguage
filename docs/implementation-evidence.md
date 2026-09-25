# Initial implementation evidence

September 25, 2026. CORE-01 and CORE-18 are **Implementing**, with **Inconclusive** full-scope hypotheses and Ready specification baselines. The observations below support only the implemented increment. This is not a completed compiler, a demonstrated generation system, or self-hosting.

## What now runs

The TypeScript package exposes `createSyntaxReader().read(source)` and `createCompiler().compile(input)`. The reader uses the maintained ANTLR-compatible grammar through the pinned antlr-ng generator and antlr4ng runtime. The compiler resolves the initial declaration/type/signature subset, checks public references and name conflicts, preserves source diagnostics, and derives relationships from existing declarations.

Executable acceptance observations call the real public API. They cover implicit builtins, unavailable custom types, public-name mismatch and wrong declaration kind, local duplicate declarations, original diagnostic locations, syntax rejection, repeated and changed source input, absence of project discovery/mutation, and deliberately incorrect compiler behavior. The relationship case checks explicit dependencies, construction inputs, capability inputs/outputs, function inputs/outputs, and fields without introducing an ownership keyword.

## Fail-first and subsequent checks

Before semantic implementation, the real compiler entry point explicitly threw `CompilationUnimplementedError`. The first combined semantic-and-acceptance run (`tests/unit/semantics.test.ts`, `tests/acceptance/compiler.test.ts`, and `tests/acceptance/relationships.test.ts`) recorded **23 failed, 2 passed, and 1 TODO**. That failure is retained as evidence that the tests exercised an unfinished implementation rather than returning their own expected answers. The later coverage inventory changed the number of visible TODOs; these are different suite snapshots, not a claim that every initial failure became implemented.

The reported local component runs at this checkpoint are:

| Check | Observed result |
| --- | --- |
| Syntax unit cases | 113 passed |
| Semantic unit cases | 16 passed |
| Delivery metrics unit cases | 12 passed |
| Release unit cases | 13 passed |
| Unit total | 154 passed |
| Executable acceptance | 17 passed, with 18 CORE-18 TODO cases |

The latest **`npm run check` passed**, including 154 unit tests and 17 acceptance tests, with 18 TODOs belonging to the current CORE-18 task. No active test or regression assertion was removed. The earlier runner also included 52 out-of-task placeholders and one duplicate, giving 71 TODOs; that broader inventory was a process mistake, corrected at the user's direction. The earlier checks passed in a clean archived checkout and in [GitHub CI on Ubuntu and Windows](https://github.com/jreyno77/ExecutableSpecificationLanguage/actions/runs/36187140824) for commit `824037ff4976d814658af8312989a531604cde45`. Development commands and the pinned runtime are in [development.md](development.md).

That exact commit produced `executable-specification-language-0.1.0-pr.2.tgz` (85,504 bytes, SHA-256 `a643b282cb59491b5b52a113434f7d2ea60c5fd107782970c4e18296e2025575`). Installing the tarball into an isolated consumer and importing its public API accepted a valid declaration and rejected an unknown type. The original checkout remained clean. This verifies a local deliverable, not a hosted deployment: release publication and GitHub deployment integration remain unverified until an authorized merge.

The specification baseline was separately checked from a clean temporary clone of commit `88024f13e5bcb98875503f2d4357968b75faa1ab`: the built ZIP's 141 files matched the commit, and repeated builds were byte-identical. This is specification-artifact evidence, not a delivered compiler package. The baseline is [PR #1](https://github.com/jreyno77/ExecutableSpecificationLanguage/pull/1), from `codex/language-grammar`; [draft PR #2](https://github.com/jreyno77/ExecutableSpecificationLanguage/pull/2) contains the compiler increment on `codex/compiler-foundation`. PR #2 is stacked on PR #1 and should target `main` after PR #1 merges. Neither has been merged.

The metrics calculator separately began with **9 failed and 1 passed** against an explicit unimplemented stub. Review found two additional defects: an incident with unknown deployment linkage could disappear into a zero failure rate, and a string `"false"` could be treated as verified recovery. Each defect received an independently authored failing regression before the fix. All 12 current metrics cases pass, and the empty input CLI smoke report shows unknown coverage rather than fabricated rates. These tests use synthetic data and report no real consumer incident.

A relationship test initially selected both a named concept and its unnamed construction because they share a display path. The observation helper was corrected to select named declarations and the test strengthened to verify the construction's distinct ID, owning concept, and parameter type. The language did not acquire a uniqueness rule for display paths merely to satisfy that mistaken test assumption.

## Coverage and limits

The runner's 18 TODOs cover only unfinished CORE-18 acceptance: 16 unbound CV scenarios and the unfinished portions of CV-005 and CV-020. The explicit CV-020 test body remains; the inventory no longer creates a duplicate. These are requirements of the current compiler task, which must be completed before its PR is ready unless the user agrees to change scope.

Future work belongs in its user stories and construction tasks, not in today's test TODOs. The earlier 34 EX and 18 GR placeholders were removed from the compiler runner; their authored specifications remain as documentation. Existing executed grammar and compiler regression tests remain. Some compiler behavior has unit coverage but still needs its full acceptance observation; a TODO provides no execution evidence. The findings about display paths and missing incident evidence above are actual learnings, with their corrections covered by running tests.

The [coverage inventory](../specifications/acceptance/coverage.json) tracks all **78 authored scenario definitions**: **8 bound, 2 partially bound, and 68 unbound**. Bound definitions are CV-002, CV-003, CV-004, CV-017, CV-018, CV-022, CV-023, and GR-001. CV-005 lacks its imported-alias collision binding; CV-020 lacks its supplied-catalog change binding. A separate executable case covers derived relationships. Definition counts differ from expanded examples and runner test counts.

The remaining semantic specification includes supplied module catalogs, full generic/type compatibility, expression/default checking, contracts, helper/scenario flow, interactions, and broader obligation handling. Unsupported implemented-entry-point paths fail explicitly with `CompilationUnimplementedError`; they must not masquerade as valid author input or successful behavior. Individual supported validation rules have narrower unit evidence, but that does not bind the remaining complete CV scenarios.

Source composition, connected-project setup and inspection, target exporters, generated executable tests, safe handwritten-code updates, and full self-development remain later work. The `.expec` contracts and manifest sketches are handwritten. Parser generation and a TypeScript build are not evidence that .expec generates or recompiles itself.

The next work should bind the remaining consumer expectations, observe the failure, implement the missing behavior, and record what changed. Keep the task's three-section body compact; link these detailed results from Learnings. A passing selected suite is useful evidence within its scope, not permission to hide TODOs or mark the full task complete.
