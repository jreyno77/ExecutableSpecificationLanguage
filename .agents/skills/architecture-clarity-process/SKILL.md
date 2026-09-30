---
name: architecture-clarity-process
description: Run a contract-first architecture discussion before implementation. Use when a request involves refactors, performance/scalability work, execution-flow changes, viewer/UI pipeline changes, or unclear code ownership and boundaries. Produce explicit API contracts, component boundaries, A-to-B flow, risks, and a recommended plan, then pause for approval before coding.
---

# Architecture Clarity Process

## Overview
Drive clarity before code. Focus on explicit contracts, clean boundaries, and direct flow from source input to user-visible output.

## Required Behavior
1. Do architecture/process discussion first.
2. Do not write code until the plan is approved.
3. Keep language direct; remove jargon and abstract phrasing.
4. Ask at most one clarifying question if absolutely required; otherwise proceed with assumptions stated.
5. Do not bias toward a specific pattern unless requested (for example, do not force session/assembly/event-bus patterns by default).

## Workflow
1. Restate goal and non-goals.
2. List constraints:
- performance/scale targets
- cancel/refresh behavior
- UX expectations
- test constraints
3. Identify boundaries:
- Core responsibilities
- VS Code responsibilities
- Webview responsibilities
- Cross-boundary contracts
4. Define explicit contracts (shape + ownership + lifecycle):
- input contract
- processing contract
- output contract
- error/cancel contract
5. Describe A-to-B flow:
- producer input
- transformation steps
- delivery path
- viewer/application of output
6. Provide 1-3 options with tradeoffs.
7. Recommend one option with rationale.
8. Add rugged investigation summary:
- concern
- defense
- evidence needed to prove defense
9. Pause for approval before implementation.

## Output Template
Use this structure in discussion responses:

```text
Goal
- <what must happen>

Non-goals
- <what is intentionally out of scope>

Constraints
- <constraint>

Boundaries
- Core: <responsibility>
- VS Code: <responsibility>
- Webview: <responsibility>
- Contracts crossing boundaries: <list>

Contracts
- Input contract: <shape + owner>
- Processing contract: <shape + owner>
- Output contract: <shape + owner>
- Cancel/error contract: <shape + owner>

A->B Flow
- A: <source>
- Steps: <ordered transformations>
- B: <final consumer>

Options
1. <option> - <tradeoff>
2. <option> - <tradeoff>
3. <option> - <tradeoff>

Recommendation
- <chosen option + why>

Rugged Investigation
- Concern: <risk>
- Defense: <mitigation>
- Evidence: <what must be validated>

Approval Gate
- <exact statement that implementation is blocked pending approval>
```

## Quality Bar
- Every proposed component/API must have one clear owner.
- Every boundary must have one explicit contract.
- Every flow step must be necessary and directly tied to user-visible outcome.
- Prefer smallest viable architecture that satisfies constraints.
