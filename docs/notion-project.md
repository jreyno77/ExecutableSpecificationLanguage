# Notion project

Created September 25, 2026 in Joshua Reynolds’s Space.

[Open .expec — Project Home](https://app.notion.com/p/3e603914566581b2a671cbe2927bab48)

The project home contains the Learning Kanban board. The active plan has **18 substantial construction tasks**, with **CORE-01 — Define the .expec language grammar** and **CORE-18 — Build the compiler and validation** both **Ready**. The other 16 tasks are Captured. All hypotheses are Untested; all 11 stories remain Not demonstrated.

## Project areas

- [Vision and proposed pitches](https://app.notion.com/p/3e60391456658124a325d356d0cebe37)
- [User stories](https://app.notion.com/p/e43f60bcd0db49e18f4433087b79f1d5)
- [Build sequence and learning tasks](https://app.notion.com/p/232f1b2950614bbcab94b2faa3af2464?v=7b693fa3ec4c4603a3d27016a817ebd1)
- [Learning workflow](https://app.notion.com/p/3e603914566581aa9eafc31ce3aca2b9)
- [Reusable task-body template](https://app.notion.com/p/3e603914566581d491edeffbba525cbb)
- [Specifications checkpoint](https://app.notion.com/p/3e60391456658177bf34ebd26864f075)
- [CORE-01 grammar specification — candidate 0.1](https://app.notion.com/p/3e60391456658154b355f311127ba550)
- [Earlier task breakdown](https://app.notion.com/p/3e603914566581418962c2f7c5d60caf)

## Task scope

The [build plan](build-plan.md) covers grammar, compiler and validation, configuration and dependencies, file composition, project connection, the output API, live inspection, identity and change comparison, code and test generation, execution integration, preservation, builds, diagrams, documentation, additional languages, self-development, and packaging.

Each card has only **Hypothesis**, **Test list**, and **Learnings**. Detailed executable specifications and implementation design follow the card. The task sequence supplies context; cards do not require a separate prerequisite-state account. Story relations retain traceability. The copyable task template is not an automatic default database template.

The previous 62 cards were consolidated into 18 existing pages. The other 44 pages were moved to Earlier task breakdown; they are reference material rather than additional active tasks. The [earlier snapshot](planning/earlier-build-backlog.json) preserves all original page text and properties. Each current task's `consolidates` field in the [registry](planning/build-backlog.json) identifies the earlier items it covers.

## Working conventions

Board phases are Captured → Specifying → Ready → Implementing → Evaluating → Reviewed. Hypothesis result is tracked separately. Reviewed closes a learning cycle; it does not establish delivery. Learnings can revise the tasks, examples, stories, and pitch.

Notion holds planning and learning records. Local sources and acceptance fixtures hold versionable details. Changes are reconciled deliberately; no automatic synchronization is installed. This iteration remains planning and specification work, with no compiler implementation or executed acceptance evidence.

## Grammar specification checkpoint

CORE-01 now links to a detailed candidate specification, with child pages for the [grammar rules and recognition contract](https://app.notion.com/p/3e6039145665815b9174fd3c2a616d55) and [acceptance cases with source fixtures](https://app.notion.com/p/3e603914566581cabc84f95897b4cf53). The local source is [specifications/grammar/README.md](../specifications/grammar/README.md). The task card retains only Hypothesis, Test list, and Learnings.

GR-001–GR-019 add 19 scenario definitions (28 cases with outline rows) to the earlier 34 EX definitions. That grammar checkpoint contained 53 unbound, unexecuted definitions; the compiler checkpoint below brings the current total to 78. The new artifacts include EBNF, lexical/layout rules, a proposed SyntaxReader interface and source/result types, and 19 source fixtures. Checks of rule references, file links, fixture facts, source locations, and Notion copies are documentation checks, not execution evidence. The grammar is now Ready, with relationships now derived from existing declarations; its hypothesis remains Untested.

The next review confirmed import-free primitives (including `Text`) and renamed the reader operation to `read`. A subsequent review accepted `ReadResult` as the working result name, rejected the later `owns cart: Cart` / `uses storage: Storage` style too, and retained the shortening ideas as learning for future design. The rejected labeled-relationship notation was removed, with GR-010 explicitly `@syntax-pending`; its requirement remains. ANTLR 4 is the preferred implementation candidate, and shortening the broader language remains a discussion question. Current specification, rules, fixtures, and Notion copies were reconciled; no parser was installed or implemented.

## Compiler specification checkpoint

[CORE-18 compiler specification](https://app.notion.com/p/3e6039145665818c940af6af42bf3be2) refines task 02 into the compile/read/validate interfaces, concrete source and resolved models, supplied dependency contracts, semantic rules, diagnostics, and independent acceptance examples. Local source: [specifications/compiler/README.md](../specifications/compiler/README.md).

Supporting pages: [interfaces and semantic rules](https://app.notion.com/p/3e603914566581439448eeccae53b99a), [shared source model](https://app.notion.com/p/3e603914566581a999fbfac77603bc07), and [acceptance cases and fixtures](https://app.notion.com/p/3e60391456658149a2c2c50bcf9afb63).

CV-001–CV-025 add 25 definitions, expanding to 56 cases, with 67 source fixtures. The current total is 78 definitions: 34 EX, 19 GR, and 25 CV. All are unbound and unexecuted. Both grammar and compiler tasks are Ready; this is specification readiness, not implementation evidence. A subsequent user decision accepts relationships derived from existing declarations; the deferred syntax question is superseded.

The user supplied [ExecutableSpecificationLanguage on GitHub](https://github.com/jreyno77/ExecutableSpecificationLanguage). The workspace now has that repository configured as origin and its main branch fetched. No local specification files have been pushed by this work.

## Connection reference

- Project page: `3e603914-5665-81b2-a671-cbe2927bab48`
- Story database: `e43f60bcd0db49e18f4433087b79f1d5`
- Story data source: `collection://d9c6a4e4-0e35-4a40-b212-936a7a1069b8`
- Task database: `232f1b2950614bbcab94b2faa3af2464`
- Task data source: `collection://09275654-6a5c-48d9-a74d-86fd6049dbf7`
- Kanban view: `view://3e603914-5665-8117-92e3-000cfb9336ff`
- Build sequence view: `view://7b693fa3-ec4c-4603-a3d2-7016a817ebd1`
- Next task view: `view://3e603914-5665-8196-9869-000c3a1410d0`
- Earlier breakdown page: `3e603914-5665-8141-8962-c2f7c5d60caf`

Planning verification checks task count, story coverage, consolidation coverage, dependencies, and compact card bodies. These checks are not execution of product acceptance tests.
