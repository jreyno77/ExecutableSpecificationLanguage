---
name: cleanup-diff-reducer
description: Deletion-first cleanup workflow for kalm-ide. Use when the user asks to reduce green diff, simplify A-to-B flow, and enforce strict rules like no test edits, remote-diff accounting, and required check/test runs.
---

# Cleanup Diff Reducer

## Use This Skill When
- The user asks for cleanup, simplification, or reducing an oversized diff.
- The user sets hard constraints (for example: insertion cap, deletion minimum, red-heavy diff).
- The user wants accounting against remote branch diff, not only local working diff.

## Non-Negotiable Rules
- Functional code only. No comment-only churn.
- Do not edit tests.
- Only exception: remove `invalidate` and its tests when the user explicitly allows that exception.
- Prefer direct A -> B flow: remove indirection, duplicate paths, and unnecessary abstractions.
- Keep the smallest working diff that satisfies behavior.
- Measure progress against `origin/<current-branch>`.
- If unexpected unrelated file changes appear during work, stop and ask user.

## Required Workflow
1. Capture baseline and targets.
- `branch=$(git rev-parse --abbrev-ref HEAD)`
- `upstream=origin/$branch`
- `git diff --shortstat "$upstream"`
- `git diff --numstat "$upstream" | sort -nr -k1,1 | head -n 30`
- Record user targets (for example: `insertions <= 1000`, `deletions >= 400`, `red >= green` for working diff).

2. Cut highest-impact green first.
- Work top insertion files first.
- Remove duplicate orchestration and stale branches before adding new helpers.
- Collapse multi-path code into one explicit path where behavior is equivalent.

3. Apply guardrails while editing.
- No edits under `ide/test/**` unless user explicitly allowed the invalidate exception.
- No deletion padding via comment-only edits.
- Keep behavior stable; avoid broad refactors unless required for correctness.

4. Mandatory verification gate.
- Run in `ide/`:
- `npm run check`
- `npm run test:core`
- If a timeout/flaky failure occurs, rerun once and report both outcomes.

5. Final accounting (always report both).
- Working diff: `git diff --shortstat`
- Remote diff: `git diff --shortstat "$upstream"`
- Remaining top green contributors:
- `git diff --numstat "$upstream" | sort -nr -k1,1 | head -n 10`
- If target is not met, continue cleanup passes until met or blocked.

## Output Template
```text
Targets
- insertions <= ...
- deletions >= ...
- rules: ...

Changes made
- file: removed/reduced path and why

Verification
- npm run check: pass/fail
- npm run test:core: pass/fail (+ rerun if needed)

Diff accounting
- vs upstream: ... insertions / ... deletions
- working: ... insertions / ... deletions
- top remaining green files: ...
```

## Rugged Story (Required)
- Concern: <what could fail or regress>
- Defense: <what was simplified/removed to defend>
- Evidence: <tests/checks/diff metrics>
