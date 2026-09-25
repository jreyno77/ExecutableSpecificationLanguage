# Developing .expec through evidence and learning

The development process is a loop: start with a broad need, propose a solution, make its promises concrete, implement enough to test them, and use the evidence to decide what to change. Apply that process to .expec itself. A finished task or passing test suite is useful evidence only for the behavior and conditions it actually covers.

This workflow records the user's direction. Task descriptions stay short, with detailed specifications kept separately. The workflow does not settle the language grammar, implementation stack, or final architecture.

## From a need to the next learning cycle

1. **Broad need.** Describe the problem, who experiences it, and the desired outcome. The [language vision](checkpoints/2026-09-24-language-vision.md) records .expec's current need and confirmed constraints.
2. **Pitch and proposed pieces.** Explain how the proposed system could meet that need. Identify the concepts or components, their responsibilities, the assumptions connecting them, and the next useful scope to investigate. Keep a proposed solution distinguishable from a confirmed requirement.
3. **User stories.** Describe who needs each behavior and its benefit. Use the [story set](stories.md) to expose gaps and disagreements before committing to detailed implementation.
4. **Notion tasks.** Name a substantial piece to construct, such as the language grammar, compiler, or project integration. Give it a hypothesis, a short high-level Test list, and space for Learnings. Keep story links in relations. The current plan contains 18 such tasks.
5. **Detailed and executable specifications.** Develop the task's contracts and examples into precise initial conditions, actions, and observable outcomes. Use domain language and support code that exercises the real system. The grammar is defined as one complete task for the current language scope; detailed architecture and implementation steps emerge through the specifications and subsequent work. Keep unbound drafts visibly unexecuted.
6. **Generate.** Once a capable tool exists, generate the contracts, domain-level tests, helpers, or other artifacts supported by the specification. Generated structure can still contain explicit unfinished work. During bootstrapping, record which artifacts were written by hand and which were actually generated.
7. **Design and implement in code.** Use the specifications to develop the responsibilities, boundaries, and implementation steps needed to complete the construction task. Supply real behavior and preserve handwritten work. Existing agreed contracts constrain the solution; detailed architecture remains a hypothesis tested through implementation.
8. **Evidence and learning.** Run the checks, inspect the real results, and compare them with the stated success and failure criteria. Record limitations, unexpected behavior, and evidence that contradicts the proposal.
9. **Revisit.** Update the board, stories, examples, and pitch as needed. Choose whether to refine, replace, expand, or stop a proposed piece. Continue the loop until the desired outcomes are met within an explicitly stated scope.

This is not a rule that every discovery must wait for the preceding stage to finish. A detailed example may reveal a missing story; implementation may expose an impossible assumption; evidence may change the pitch. Carry that learning back to the relevant artifacts instead of hiding it in implementation notes.

## Keep task descriptions simple

The task title names a substantial construction deliverable: for example, **Define the .expec language grammar** or **Build the compiler and validation**. The [build plan](build-plan.md) orders the 18 pieces of the current solution. The full grammar belongs in one task; detailed architecture and substeps are developed in its specifications and implementation work.

Each task body has only three sections:

- **Hypothesis:** One short statement of what we expect to learn or make possible.
- **Test list:** A few high-level bullets describing how we will check it.
- **Learnings:** Update later with what happened and what it means for the next step.

Use the story relation for story links. Detailed scenarios, contracts, execution details, and supporting records belong in the separate specifications, rather than being repeated on the card.

For the grammar task, the hypothesis can be: “One readable grammar can express the current specification needs consistently.” Its Test list can be:

- Express concepts, types, public contracts, dependencies, relationships, and behavior.
- Express inline and separate-file declarations and scenarios using the same language rules.
- Distinguish declarations, references, and literals, and identify malformed or ambiguous forms.

Leave Learnings empty or mark it “Not tried yet” until there is something learned to record. Reviewing grammar examples can provide evidence about the design; it does not establish that a compiler implements those rules.

## From a construction task to specifications and implementation

For **CORE-01 — Define the .expec language grammar**, develop the rules and representative examples across the full current language scope. The deliverable should explain how the language expresses the agreed concepts and their relationships and how valid forms differ from invalid ones. Use Store Game, the compiler self-description, and the other current examples to expose ambiguity and missing forms. Draft syntax remains provisional until that work settles it.

The compiler and validation task is now Implementing around those rules. Its [specification](../specifications/compiler/README.md) establishes the source model, declaration resolution, diagnostics, and independently observable results. Parsing, resolution, source tracking, and other internal responsibilities are organized while implementing that contract; the board does not need a separate task for each internal component. Relationships derive from existing declarations without a separate keyword.

The same pattern applies to the other construction tasks. A handwritten-code update task needs examples for additions, changes, renames, moves, and removals, followed by a design that preserves implementations. A single example helps specify part of that task without replacing its broader deliverable. Real compiler and filesystem observations must remain independent of a generator's own success claims.

## Proposed board conventions

Use a Kanban board with the existing phases: **Captured → Specifying → Ready → Implementing → Evaluating → Reviewed**. “Ready” means the next work and its scoped observations are clear enough to attempt. “Reviewed” closes a learning cycle: the evidence and resulting decision were recorded. It does not claim that the hypothesis was supported or that a requirement was delivered. A review can send work back to an earlier phase or create a better next task.

Track the hypothesis result separately:

- **Untested:** No relevant execution or observation has tested the claim.
- **Supported in scope:** Recorded evidence meets the stated criteria within the identified scope.
- **Counterevidence found:** Observed behavior conflicts with the claim or one of its necessary assumptions.
- **Inconclusive:** The available evidence cannot decide the claim, for example because a needed binding is absent or the observation is insufficient.

A disproven approach can still produce a completed investigation and valuable learning. The underlying desired outcome stays open until an adequate approach satisfies it. Conversely, moving a card to the end of a board does not establish that the software meets its story.

## Evidence must be able to change the plan

Confirmed needs describe what the user wants; they do not prove that our proposed grammar, shared model, project inspector, or generator will satisfy it. Evidence should test those choices while respecting the user's confirmed constraints. If a constraint itself needs reconsideration, surface the conflict for discussion rather than silently weakening it.

Keep tests capable of exposing incorrect behavior. Use real implementation bindings and independent observations. A deliberately incorrect implementation can help check whether an acceptance example actually detects its stated failure. Do not replace an assertion with a constant success, suppress an unexpected failure, relabel unfinished work as passing, or weaken an expectation solely to make the current implementation appear successful.

Write from the intent of the person using the code, including another component as a consumer. Before implementation, use concrete examples to discover useful contracts, dependencies, and boundaries. The domain-level test should communicate the reason the behavior matters; its helpers should carry the mechanics of exercising and observing the real system. Deriving both a test and its expected answer from the implementation can repeat the same mistaken assumption. A test's useful perspective and observations matter more than its label or the layer through which it happens to run.

An expectation can change when learning shows it was wrong. Record the reason, update the linked story or hypothesis, and run the revised checks. Evidence for an earlier requirement does not automatically verify its replacement. Preserve counterevidence and limitations so the next decision can use them.

## Current position

The repository contains **11 user stories and 78 acceptance-scenario definitions: 34 earlier EX, 19 CORE-01 grammar GR, and 25 CORE-18 compiler CV scenarios**. The grammar scenarios expand to 28 cases; the compiler scenarios expand to 56 cases with 67 fixtures. The [coverage inventory](../specifications/acceptance/coverage.json) records 8 bound definitions, 2 partially bound, and 68 unbound. An initial TypeScript reader/compiler and real acceptance tests run; [implementation evidence](implementation-evidence.md) records their scope and limits. Specifications and the example manifest remain handwritten. Target generation and self-hosting are not implemented.

The [build backlog](planning/build-backlog.json) contains **18 substantial construction tasks** across the current solution and all 11 stories. **CORE-01 — Define the .expec language grammar** and **CORE-18 — Build the compiler and validation** are **Implementing**, with Ready specification baselines and **Inconclusive** full-scope hypotheses. The remaining **16 tasks are Captured and Untested**; scoped observations belong in Learnings. The earlier 62-task decomposition is retained separately as historical planning material.

The [CORE-01 specification](../specifications/grammar/README.md) and [CORE-18 specification](../specifications/compiler/README.md) constrain the implementation; relationships derive from existing declarations without a dedicated keyword. Continue binding the remaining [compiler acceptance cases](../specifications/acceptance/compiler.feature) to independently observed behavior. Follow the [construction sequence](build-plan.md) through configuration, composition, project integration, outputs, preservation, and self-development. The [specification guide](../specifications/README.md) retains the earlier EX examples and draft sketches as history, not the current API. Develop further examples and internal steps within each construction task as the work makes them concrete.
