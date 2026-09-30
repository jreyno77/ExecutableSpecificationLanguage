---
name: rugged-code-hardening
description: Enforce a rugged engineering approach for code changes so software remains available, survivable, defensible, secure, and resilient under hostile or unexpected conditions. Use for any new code, refactor, API or schema change, dependency change, CI/runtime change, or security-sensitive bug fix. Drive each change through threat-aware design, explicit defenses, adversarial testing, survivability checks, and evidence-based release gates.
---

# Rugged Code Hardening

## Objective
Make every code change provably harder to break, easier to detect, and safer to recover.
Treat ruggedness as a continuous capability, not a one-time security state.
Investigate the actual change-set and report possible concerns, defenses, and evidence.

## Rugged Posture
- Prioritize mission assurance over checklist completion.
- Seek threats proactively; do not wait for incident-driven learning.
- Build positive defenses and negative attack tests.
- Keep a living rugged investigation for each change: possible concern -> defense -> evidence.
- Prefer simple, reusable defenses over custom one-off security logic.

## Mandatory Rugged Gate
Before implementation, define and document:
- Mission impact: what must stay true even under attack or failure.
- Threat agents: who/what can abuse this change.
- Abuse paths: top ways inputs, state, or dependencies can be exploited.
- Required defenses: prevention, detection, and response controls.

If this gate is incomplete, do not proceed with coding.

## Workflow
1. Frame the change in business and system terms.
- List critical assets and unacceptable outcomes.
- Mark trust boundaries and external inputs.

2. Build the rugged investigation snippet.
- Concern: possible risk or threat introduced/exposed by the current changes.
- Defense: existing or added control (validation, authz, isolation, limits, etc.).
- Evidence: concrete proof currently present (test, metric, log, monitor, policy, code path).
- If evidence is weak/missing, call out the gap explicitly instead of inferring coverage.

3. Implement defense-in-depth.
- Validate and normalize all untrusted input at boundaries.
- Enforce authorization and tenant boundaries server-side.
- Apply safe defaults, explicit allowlists, and strict parsing.
- Add resource controls (size limits, timeouts, retries, backoff, circuit breaking).
- Fail safely with non-leaky error contracts.

4. Run adversarial verification.
- Write break tests for contracts, API params, and function args.
- Use malformed, boundary, oversized, and misuse payloads.
- Confirm the system rejects/contains abuse predictably.
- Keep failing attack tests as regression tests after fixes.

5. Verify survivability and observability.
- Verify degraded-mode behavior when dependencies fail.
- Verify idempotency and replay safety where required.
- Emit security-relevant events, correlation IDs, and actionable alerts.
- Ensure dashboards/logs can show attack-in-progress signals.

6. Gate dependency and supply-chain risk.
- Review new/updated dependencies for necessity and alternatives.
- Flag non-standard, major-version, native, or high-risk additions.
- Require a rollback path for dependency-driven incidents.

7. Ship only with rugged evidence.
- Confirm tests, checks, and monitors support the rugged investigation.
- Record residual risk and follow-up experiments.
- Schedule next hardening experiment for this surface.

## Non-Negotiable Release Blockers
- Unvalidated external input on a new/changed boundary.
- Missing authz checks for sensitive actions/data.
- Unbounded resource use on attacker-controlled inputs.
- No adversarial tests for changed contract/input surfaces.
- No detection signal for high-impact abuse scenarios.
- Dependency changes without risk review and rollback plan.

## Integration With Other Skills
- Use `contract-impact-gate` for major/new-file/dependency-heavy changes before implementation.
- Use `contract-breaker-tests` for dedicated attack-test campaigns and hardening loops.
- Use `kalm-hypothesis-workflow` to keep changes test-driven and verified pre/post.

## Output Template
Use this report format per change:

```text
Rugged Scope
- Critical asset(s): <...>
- Unacceptable outcome(s): <...>
- Threat agents: <...>

Rugged Investigation
- Possible concerns:
- <concern + impact + likelihood>
- Defenses:
- <control + scope>
- Evidence:
- <test/log/check/code reference proving defense>
- Evidence gaps:
- <missing proof, assumptions, or unknowns>

Adversarial Results
- Attack vectors tested: <...>
- Breakages found: <...>
- Fixes applied: <...>

Survivability and Detection
- Failure-mode behavior: <...>
- Detection/alerts: <...>

Dependency Risk
- Changes: <...>
- Risk and rollback: <...>

Release Decision
- Status: <approve | hold>
- Residual risk: <...>
- Next hardening experiment: <...>
```
