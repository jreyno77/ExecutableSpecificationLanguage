---
name: batch-runner-orchestrator
description: Orchestrate one selected bounded architecture batch using the repo's existing batch-runner and worker prompt files. Use when Codex needs to run `ide/temp/prompts/batch-runner.md`, coordinate subagents across `drift-check.md`, `challenger.md`, `plan.md`, `implement.md`, `validate.md`, `update-calibration.md`, and `write-metrics.md`, keep the batch bounded, and surface only the approval packet when escalation is genuinely required.
---

# Batch Runner Orchestrator

## Overview

Run the selected batch as an orchestrator, not as a replacement for the repo prompts.
Treat `ide/temp/prompts/batch-runner.md` as the parent contract and the worker prompt files it names as the execution algorithm.

Your job is to:
- verify the batch against repo truth
- delegate the right worker to the right slice at the right time
- keep parallelism real and safe
- redirect agents when they drift
- stop only for true blockers or the approval packet conditions

## Non-Negotiables

- Do not redefine worker roles from scratch.
- Do not summarize a worker prompt and substitute your own version if the prompt file is usable.
- Do not let "awareness" become permission to skip any required worker stage.
- Do not broaden the batch because a worker found adjacent cleanup.
- Do not surface raw agent chatter to the human.
- Do not treat implementation sub-slices as separate human batches unless repo truth forces it.

## Awareness Model

Be aware of live execution state, but use that awareness only to improve delegation and control.

Keep a compact internal map of:
- current batch goal and acceptance gate
- repo-truth contradictions and blockers
- active file ownership and overlap risk
- unsettled shared contracts
- completed vs pending artifacts
- which worker outputs are binding on downstream stages

Use that map to decide:
- which workers can run in parallel
- which slices must serialize
- when to interrupt and redirect an agent
- when a result is strong enough to unblock the next phase
- when the batch must stop and surface the approval packet

Do not use that map to:
- replace a required worker prompt
- weaken a challenger no-go without directly answering it
- silently absorb out-of-scope work
- invent new architecture

## Required Reads

Start by reading the inputs named by `ide/temp/prompts/batch-runner.md`.
Then read the worker prompt files it names.

At minimum, use:
- `ide/temp/prompts/batch-runner.md`
- `ide/temp/canonical-context.md`
- `ide/temp/research-org.md`
- `ide/temp/portfolio/improvement.md`
- `ide/temp/05_calibration_log.md`
- `ide/temp/06_metrics.tsv`
- `ide/temp/portfolio/batch-<BATCH_ID>-selection.md`
- `ide/temp/prompts/drift-check.md`
- `ide/temp/prompts/challenger.md`
- `ide/temp/prompts/plan.md`
- `ide/temp/prompts/implement.md`
- `ide/temp/prompts/validate.md`
- `ide/temp/prompts/update-calibration.md`
- `ide/temp/prompts/write-metrics.md`

If the selected batch or seam docs point to additional seam artifacts, read only the files required by the downstream prompt contract.

## Orchestration Workflow

### 1. Verify the batch

- Confirm the selected batch exists and the repo still supports its stated seam and acceptance gate.
- Resolve the seam docs and artifact paths that the worker prompts will need.
- If repo truth already materially contradicts the batch, stop and prepare the approval packet.

### 2. Run drift-check, then run challenger

- Launch a drift-check worker using `ide/temp/prompts/drift-check.md`.
- Require the drift-check worker to write or update its required artifact, not just send chat output.
- Launch the challenger worker only after the drift-check output is available.
- Give the challenger worker the selected batch id, the concrete batch-selection path, the relevant seam path, and the concrete drift artifact it must consume.
- Require the challenger worker to write or update its required artifact, not just send chat output.

Treat these results as the first gate:
- if drift-check finds a true prerequisite blocker, stop before launching challenger
- if challenger finds a true prerequisite blocker, stop
- if either result shows the batch cannot remain one honest review unit, stop unless the batch can be honestly reshaped inside the same parent boundary
- if challenger returns `split` or `no-go`, treat that as binding until directly answered

### 3. Run the planner

- Launch the planner only after the drift-check and challenger outputs are available.
- Pass the concrete outputs, not a vague summary.
- Require the planner to produce the smallest reversible execution slices inside the selected batch.
- Require explicit notes on:
  - parallel-safe slices
  - rollback points
  - how challenger objections are handled

### 4. Run implementation

- Spawn implementers by slice only when file ownership is disjoint and shared contracts are settled.
- Serialize slices that share files, risk, or prerequisite order.
- Give each implementer:
  - the exact worker prompt file to follow
  - the exact slice it owns
  - the files it may edit
  - the artifact it must update
  - the blocker rule: stop and report, do not silently expand scope

During implementation, stay active as coordinator:
- poll for progress when needed
- send corrective follow-ups if an agent drifts from the plan
- interrupt an agent if it starts editing out-of-scope files or bypassing the prompt contract
- resynthesize before launching more edits if a blocker invalidates the plan

### 5. Run validation

- Launch the validator using `ide/temp/prompts/validate.md`.
- Validate against challenger output, plan compliance, invariants, validation sufficiency, and file sprawl.
- If validation fails, decide whether bounded repair inside the same batch is still honest.
- If bounded repair is not honest, stop and surface the approval packet.

### 6. Run calibration and metrics

- After implementation and validation, run `update-calibration.md` and `write-metrics.md`.
- Run them in parallel only after the validation outcome is clear enough to support factual recording.
- Record facts, not optimistic interpretations.

## Delegation Rules

When you delegate, be explicit and narrow.

Every worker handoff should include:
- worker role and prompt file
- selected batch id
- exact input files to read
- artifact file to update
- ownership boundaries
- stop conditions

Good delegation means:
- parallelize independent work aggressively
- keep workers inside their exact prompt contract
- reuse agents for follow-up clarification when context continuity helps
- interrupt agents when they drift rather than waiting for a bad result

Bad delegation means:
- spawning implementers before the shared contract is settled
- letting two implementers edit the same file concurrently
- asking a worker to "basically do" another worker's job
- using awareness as justification to skip calibration or metrics

## Artifact Discipline

Ensure the worker flow produces or updates the artifacts required by `batch-runner.md`, including:
- `batch-<BATCH_ID>-drift-check.md` or equivalent drift artifact
- `batch-<BATCH_ID>-challenge.md`
- `batch-<BATCH_ID>-implementation-plan.md` or repo-standard equivalent
- `batch-<BATCH_ID>-implementation-result.md`
- `batch-<BATCH_ID>-validation.md`
- `batch-<BATCH_ID>-update-calibration.md`
- `batch-<BATCH_ID>-write-metrics.md`

If repo conventions use seam-local equivalents, use those exact files instead of inventing new parallel documents.

## Human Output Contract

Keep the human abstraction clean.

- If no approval condition is triggered, continue autonomously.
- If approval is required, output only the approval packet shape required by `batch-runner.md`.
- Do not dump raw worker transcripts.
- Do not make the human reconstruct which agent was right.

## Failure Handling

Stop and surface the approval packet when:
- repo truth materially contradicts the selected batch
- a prerequisite seam blocks the batch
- the batch cannot meet its acceptance gate without broadening scope
- validation is too ambiguous for an honest autonomous close
- rollback conditions are triggered
- materially different directions remain

If a worker prompt is truly unusable because repo truth invalidates it, state exactly why before deviating.

## Success Standard

The run is successful when:
- the selected batch stays bounded
- the repo worker prompts are actually used
- delegation is efficient and actively managed
- concurrency is real, not cosmetic
- artifacts are updated
- the human sees only the clean approval abstraction when needed
