---
name: kalm-hypothesis-workflow
description: "General hypothesis-driven coding workflow: confirm a falsifiable hypothesis with the user, encode it as a minimal test, run it before/after changes, and report results. When in kalm-ide, also gate changes with module tests."
---

# Hypothesis Workflow (General)

## Overview
Use a user-confirmed hypothesis loop for any coding task, explicitly following TDD (red -> green -> refactor). When in kalm-ide, also run module tests before and after changes as a gating step.

## Workflow
1. If the repo has required baseline/module tests, run them before changes. If they fail unexpectedly, stop and ask how to proceed.
2. State a one-sentence hypothesis to the user and ask for confirmation/feedback. Revise before proceeding.
3. Identify an existing test that validates the hypothesis or propose a new minimal test. Present the test choice to the user and confirm it before proceeding.
4. Encode the hypothesis as the smallest distinguishing test (or select the existing one) and run it.
   - If the hypothesis expects failure and the test passes, re-evaluate and confirm a revised hypothesis.
   - If the hypothesis expects failure and the test fails, proceed.
   - If the hypothesis expects success and the test fails, re-evaluate and confirm a revised hypothesis.
   - If the hypothesis expects success and the test succeeds, proceed.
5. Implement the smallest change that should satisfy the confirmed hypothesis.
6. Before post-tests, restate the hypothesis and confirm the change aligns with it.
7. Re-run the same hypothesis test(s).
8. Re-run any required baseline/module tests.
9. Report: hypothesis, tests used, pre/post results, and any hypothesis adjustments.

## Kalm-ide module test gating (only when applicable)
- Resolve the module root from an explicit path (active file or prompt path). If ambiguous, ask which module to test.
- `cli`, `ide`, `init`: run `npm test`, `npm run test:core`, and `npm run check` from the module root.
- `ls`: run `./gradlew test` from the `ls` module root.

## Formatting checks (cli/ide/init)
- If `npm run check` fails due to formatting, run `npm exec biome check -- --write .` from the module root.
- If formatting still fails, present a short plan with options (narrow scope, fix specific files, or ask before unsafe fixes).

## Module resolution (kalm-ide)
- If the path is a file, use its parent directory.
- If the prompt names a module (`cli`, `ide`, `init`, `ls`) or a file path inside one, use that path.
- If the current path is inside `cli/`, `ide/`, or `init/`, run `npm test`, `npm run test:core`, and `npm run check` from that module root.
- If the current path is inside `ls/`, run `./gradlew test` from the `ls` module root.
- If the module cannot be determined (repo root or mixed module changes), ask which module to test.

## Commands
- Prefer `scripts/run-module-tests.sh [path]` with an explicit path if available.
- If not using the script, follow the module rules above.
