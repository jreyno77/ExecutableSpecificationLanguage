# QR-S-P-I Workflow Reference

## Purpose

Use this workflow to turn a vague ask into a right-sized prompt packet. Expand only when the task needs it.

## Task Size Heuristic

- Ultra-compact: one obvious action, short context, low risk.
- Tiny: one edit, one output, obvious success criteria.
- Standard: moderate ambiguity or a few connected steps.
- Wide: architecture, migration, cross-team, user data, or unstable requirements.

If the task fits more than one bucket, choose the smaller path unless risk says otherwise.
If it fits ultra-compact, do not promote it unless a missing fact would materially change the prompt.

## Stage Templates

### Questions

Goal: surface unknowns, not solve them.

Output: 0-1 blocking question for ultra-compact tasks, or 1-5 focused questions otherwise.

### Research

Goal: objective facts only.

For wide tasks, use a clean context or fresh session before research so the ticket does not bias the facts.
For ultra-compact tasks, skip research unless a missing fact would change the prompt.

Capture:

- current behavior
- relevant files or surfaces
- existing patterns
- constraints
- edge cases
- tests or examples that already exist

### Design

Goal: define the end state before planning.

Persist the design as markdown before moving to structure or plan.
Skip this stage for ultra-compact tasks unless the ask is ambiguous.

Capture:

- must keep
- must change
- preferred patterns
- anti-patterns
- unresolved decisions

### Structure

Goal: define phases and interfaces.

Capture:

- inputs and outputs
- modules or components
- sequence of work
- data contracts
- checkpoints

### Plan

Goal: list the tactical steps.

Keep it short. If the plan starts to look like a long checklist, split the task or collapse the scope.

### Prompt

Goal: produce the final reusable prompt.

Include:

- objective
- context
- constraints
- expected output
- acceptance criteria
- first action
- stop conditions

## Collapse Rules

- Ultra-compact task: final prompt only, or one blocking question plus final prompt.
- Tiny task: Questions + Prompt only.
- Standard task: Questions + Research + Design + Structure + short Plan + Prompt.
- Wide task: keep the stages separate and persist the important artifacts in markdown.
- If a stage would exceed the instruction budget, split it or move details into a reference file.

## Anti-Patterns

- Do not start with a huge plan.
- Do not research with implementation bias.
- Do not ask for human review of a 1,000-line plan.
- Do not force ceremony when the ask is already narrow.
- Do not keep a long-running context window if a fresh one would be cleaner.
