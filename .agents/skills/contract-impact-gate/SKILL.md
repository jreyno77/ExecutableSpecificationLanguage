---
name: contract-impact-gate
description: Enforce a mandatory pre-implementation checkpoint for high-impact code changes. Use when a request includes new files, broad refactors, public API/schema/event changes, architecture shifts, CI/build/runtime changes, or dependency additions/upgrades. Require explicit analysis of contractual implications (explicit and implicit), system fit, and non-standard dependency risk, then pause and obtain user approval before continuing.
---

# Contract Impact Gate

## Objective
Run a mandatory contract and dependency checkpoint before implementing high-impact changes.
Do not continue with implementation until the user explicitly approves the checkpoint summary.

## Trigger Conditions
Activate this skill when any of the following is true:
- Create or remove source/config/build files.
- Change multiple files with broad behavior impact.
- Change public interfaces (APIs, exported types/functions, events, CLI/UI contracts).
- Change persistence models, database schema, or migrations.
- Change authn/authz, tenancy, or data-handling behavior.
- Change CI/CD, release logic, runtime wiring, or deployment paths.
- Add or upgrade dependencies in package/build manifests.

## Workflow
1. Classify change scope before coding.
- Label the request as `minor`, `major`, or `uncertain`.
- Treat `uncertain` as `major`.

2. Identify explicit contractual implications.
- API contracts: endpoints, methods, request/response schemas, status/error codes.
- Event/message contracts: topics, payload shape, ordering, delivery assumptions.
- Type/export contracts: public function signatures, exported interfaces, CLI flags.
- Data contracts: schema/migration changes, constraints, defaults, retention.
- Config contracts: environment variables, feature flags, required runtime settings.

3. Identify implicit contractual implications.
- Behavioral semantics: side effects, default behavior, idempotency, retries/timeouts.
- Compatibility: backward/forward compatibility, rollout and migration expectations.
- Operational behavior: latency/throughput assumptions, observability signals, alerting.
- Security/compliance expectations: auth boundaries, data classification, auditability.

4. Explain system fit.
- Identify bounded context and ownership.
- Identify upstream producers and downstream consumers.
- Explain coupling changes and failure-mode impact.
- Explain migration or fallback strategy if behavior diverges.

5. Run non-standard dependency gate.
- Review dependency manifest deltas (`package.json`, lockfiles, Gradle/Maven files, etc.).
- Flag dependency changes as `non-standard` when any condition applies:
- New runtime dependency not already used in the repo.
- Major-version upgrade.
- Native/system-level requirement.
- Security, license, or compliance uncertainty.
- Network egress, telemetry, or data-sharing behavior.
- Overlap with existing in-repo capability.
- For each flagged dependency, document rationale, alternatives, blast radius, and rollback plan.

6. Pause and verify with user.
- Present the checkpoint summary.
- Ask exactly one approval question:
`Approve this contract/dependency impact profile and continue? (yes/no/adjust)`
- Stop execution until explicit approval.

## Checkpoint Output Template
Use this structure before implementation:

```text
Change Classification: <minor|major|uncertain>

Explicit Contract Implications
- <item>

Implicit Contract Implications
- <item>

System Fit
- Bounded context: <context>
- Upstream/downstream impact: <impact>
- Migration/fallback: <plan>

Dependency Gate
- Manifest changes: <none|summary>
- Non-standard dependencies:
  - <name/version>: <reason, alternatives, blast radius, rollback>

Decision Needed
Approve this contract/dependency impact profile and continue? (yes/no/adjust)
```

## Guardrails
- Treat unknown impacts as risks until resolved.
- Prefer smaller compatible changes over broad rewrites.
- Require contract tests or compatibility checks when contracts change.
- Re-run this gate if scope expands during implementation.
