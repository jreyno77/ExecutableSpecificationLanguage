# Proposed build plan

These 18 tasks cover constructing .expec from its grammar and compiler foundations through configuration, connected projects, generated outputs, code preservation, and self-development. Each task names a substantial piece of work. Defining the language grammar is one task; the specifications and implementation reveal the finer steps.

Cards contain only Hypothesis, a compact Test list, and Learnings. They provide concrete examples to refine into executable specifications before detailed code architecture. Task order provides context without requiring a separate inventory of what exists before every task.

The order and dependency links are proposed coordination aids and can change as we learn. **CORE-01 grammar and CORE-18 compiler/validation are Implementing**; their specifications remain Ready baselines and their full-scope hypotheses are **Inconclusive**. The remaining **16 tasks are Captured and Untested**, with scoped results recorded in Learnings and the [implementation evidence](implementation-evidence.md). An initial reader/compiler and acceptance bindings run; target generation and project integration remain later work.

The [grammar specification](../specifications/grammar/README.md) and [compiler specification](../specifications/compiler/README.md) define the current contracts. Relationships are derived from existing declarations; no separate keyword is required. The set contains 78 scenario definitions: 34 earlier EX, 19 GR (28 expanded cases), and 25 CV (56 expanded cases with 67 fixtures). The [compiler acceptance cases](../specifications/acceptance/compiler.feature) remain unbound. Earlier EX examples and draft self-descriptions preserve discovery history rather than the current compiler API.

The [backlog registry](planning/build-backlog.json) records current IDs, links, relationships, and the consolidation mapping. The [earlier snapshot](planning/earlier-build-backlog.json) preserves all 62 original cards and their metadata. The 44 superseded pages are kept in [Earlier task breakdown](https://app.notion.com/p/3e603914566581418962c2f7c5d60caf), outside the active board.

| Order | Task | Related preceding work |
| --- | --- | --- |
| 1 | [CORE-01 — Define the .expec language grammar](https://app.notion.com/p/3e6039145665819cb7bed5350ce614ad?pvs=204) | None |
| 2 | [CORE-18 — Build the compiler and validation](https://app.notion.com/p/3e6039145665815db0bdc490acf8a18c?pvs=204) | CORE-01 |
| 3 | [PROJECT-01 — Implement configuration and dependency management](https://app.notion.com/p/3e603914566581c79c4ffe6b6194edb7?pvs=204) | CORE-18 |
| 4 | [CORE-13 — Implement imports and specification composition](https://app.notion.com/3e60391456658111a70ce23fafa8e728) | CORE-18, PROJECT-01 |
| 5 | [PROJECT-03 — Implement project connection and initialization](https://app.notion.com/p/3e6039145665813d935adbc52b03cb7c?pvs=204) | PROJECT-01 |
| 6 | [OUT-01 — Implement the extensible output API](https://app.notion.com/p/3e60391456658112887cd63b6e55c679?pvs=204) | CORE-18, PROJECT-01 |
| 7 | [PROJECT-05 — Implement live project reading and searching](https://app.notion.com/p/3e60391456658163bf2de4421935eecd?pvs=204) | PROJECT-03, OUT-01 |
| 8 | [PROJECT-10 — Implement specification identity and change comparison](https://app.notion.com/p/3e60391456658177b89cdbee12ceffbd?pvs=204) | CORE-18, PROJECT-05 |
| 9 | [OUT-03 — Generate TypeScript contracts and implementation scaffolds](https://app.notion.com/p/3e6039145665813cb987c8a7b62619b1?pvs=204) | CORE-13, OUT-01 |
| 10 | [OUT-04 — Generate readable executable specifications and domain helpers](https://app.notion.com/3e603914566581739ebfc952e41e129d) | CORE-13, OUT-03 |
| 11 | [OUT-07 — Implement scenario setup and execution integration](https://app.notion.com/p/3e603914566581a7bf18e73ce3a19646?pvs=204) | OUT-04, PROJECT-03 |
| 12 | [PROJECT-11 — Implement project updates that preserve handwritten code](https://app.notion.com/p/3e603914566581ef8407f710c6bbf70f?pvs=204) | PROJECT-10, OUT-03, OUT-04 |
| 13 | [OUT-19 — Assemble repeatable builds into connected projects](https://app.notion.com/p/3e603914566581389d72c884da252b87?pvs=204) | CORE-13, PROJECT-03, OUT-07, PROJECT-11 |
| 14 | [OUT-10 — Implement UML structure and interaction outputs](https://app.notion.com/p/3e60391456658101902ce3111a609b61?pvs=204) | CORE-13, OUT-01 |
| 15 | [OUT-11 — Implement Markdown documentation output](https://app.notion.com/p/3e603914566581b684dad345efcf7a63?pvs=204) | OUT-04, PROJECT-11 |
| 16 | [OUT-12 — Implement Kotlin, Java, and Python targets](https://app.notion.com/p/3e60391456658136bb9bfdc44877e9b7?pvs=204) | OUT-19, PROJECT-05 |
| 17 | [OUT-17 — Develop .expec through its own specifications and a real pilot](https://app.notion.com/3e603914566581359d7bf3e060e4e3ae) | OUT-19, OUT-10, OUT-11 |
| 18 | [OUT-20 — Package the tool and support exporter development](https://app.notion.com/p/3e603914566581c886abc8f6c7ce8611?pvs=204) | OUT-17, OUT-12 |

The [learning workflow](development-workflow.md) connects each task to its examples, implementation, evidence, and revisions. Existing stories and acceptance examples remain available; consolidation does not establish delivered behavior.
