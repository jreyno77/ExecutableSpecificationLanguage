---
name: contract-breaker-tests
description: Perform adversarial contract testing for APIs and function arguments, then harden confirmed breakages with minimal fixes. Use only when explicitly invoked (for example `/contract-breaker-tests`) or when the task creates a new source-code file. Focus on breaking input/argument contracts, validating failure behavior, and closing vulnerabilities before continuing feature work.
---

# Contract Breaker Tests

## Activation Gate
Run this skill only when one condition is true:
- User explicitly invokes the skill (for example `/contract-breaker-tests`).
- Task creates a new source-code file.

If neither condition is true, do not run this skill.

## Objective
Write tests that intentionally break contract boundaries for API inputs and function arguments.
If tests reveal a real breakage, implement the smallest safe fix and keep the breaking test as regression coverage.

## Workflow
1. Identify contract surfaces.
- Enumerate externally visible inputs first: HTTP/API payloads, event payloads, CLI args, exported function args.
- Enumerate internal high-risk validators/parsers that gate untrusted input.

2. Build an adversarial test matrix.
- Required/missing fields.
- Wrong types and coercion traps.
- Boundary values (`min-1`, `max+1`, zero, empty, null, undefined).
- Oversized payloads and long strings.
- Unexpected enum values and unknown fields.
- Encoding edge cases (unicode normalization, control chars, null bytes).
- Injection-style payloads relevant to the surface (SQL/path/command/template).
- Authorization and tenant-boundary argument misuse where applicable.

3. Write break-first tests (TDD).
- Add focused tests that assert safe rejection or safe handling.
- Prefer one failure mode per test.
- Assert error contract shape and status/code semantics, not only "throws".

4. Run tests before fixes.
- Confirm which break tests fail.
- Classify each failure as `vulnerability`, `robustness gap`, or `expected behavior`.

5. Fix confirmed breakages minimally.
- Add or tighten validation/normalization/authorization checks.
- Avoid broad refactors unless required for correctness.
- Preserve backward compatibility unless a breaking fix is explicitly approved.

6. Re-run and expand coverage.
- Re-run targeted break tests.
- Add at least one neighboring negative test for each confirmed vulnerability.
- Run module-required baseline tests after hardening.

7. Report results.
- List attempted break vectors.
- List vectors that succeeded pre-fix.
- List exact fixes applied and residual risk.

## Quality Bar
- Keep tests deterministic and readable.
- Do not delete or weaken failing adversarial tests after fixing.
- Do not suppress failures with broad try/catch or generic 500 handling.
- Prefer explicit validation errors over implicit coercion.
- Add rate/size guards where unbounded input can cause resource abuse.

## Output Template
Use this summary before closing the task:

```text
Activation reason: <slash invocation | new source file>

Contract surfaces
- <surface>

Adversarial vectors tested
- <vector>

Confirmed pre-fix breakages
- <breakage + impact>

Fixes applied
- <minimal fix>

Post-fix verification
- <targeted tests>
- <baseline/module tests>

Residual risks
- <risk or none>
```
