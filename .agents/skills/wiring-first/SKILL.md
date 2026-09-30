---
name: wiring-first
description: "Establish and test skeletal contracts and application wiring before implementing a multi-component feature. Use when designing swappable components, decoupling commands/operations/bridges/writers/sessions, or splitting work into independently buildable branches. Detect hidden implementation dependencies and prove substitution through the real entry point. Do not use for isolated bug fixes, formatting, or documentation-only changes."
---

# Wiring First

Build the smallest working connection between components before filling in their internals. Independent Git history is not evidence of independent components; a full feature still needs explicit composition.

## Scope and approval

Honor the user's requested outcome and existing repository rules. A design request authorizes inspection and a proposal, not implementation or Git changes. For implementation, reuse an already approved architecture plan; obtain any required approval before changing contracts or introducing the skeleton. Do not restart an approved discussion unless the scope or contract changes materially.

When `architecture-clarity-process` applies, use its discussion to settle ownership and contracts; this skill adds the implementation order and proof of independence. Do not introduce a new framework, foundation branch, work batch, or dependency merely to follow this workflow.

## 1. Map the real boundaries

- Trace the existing entry point through registration, execution, and output. Inspect actual imports, constructors, defaults, types, tests, fixtures, and build inputs.
- Reuse established execution, repository, resolver, progress, cancellation, and reporting APIs. Verify them in the code rather than assuming they are wired already.
- For each component, name its responsibility, required input/output contract, and who supplies its collaborators. Identify the application startup/registration location that selects concrete implementations: the composition root.
- Distinguish stable platform dependencies and a component's own implementation details from dependencies on another independently delivered component.

## 2. Define only the contracts consumers need

Prefer existing types and narrow, required function parameters or interfaces. Use consumer-owned structural contracts when sufficient; introduce shared contracts only when there is a concrete need and an explicit delivery owner.

Specify input/output shape, identity validation, errors, cancellation, ordering, and completion timing. Give progress, persistence, and retained partial results explicit owners where relevant. Do not silently strengthen guarantees such as turning an awaited write into a promise of crash durability.

Check for disguised coupling:

- A parameter typed as `typeof concreteApply`, a return type derived from a concrete factory, or a DTO nested inside an implementation still depends on that implementation.
- An optional injected dependency with a default concrete constructor still requires the concrete implementation to compile.
- A type-only sibling import still requires that sibling's source or declarations.
- Reflection, dynamic imports, service locators, casts, and duplicated implementation files do not establish independence.

Keep concrete selection at the composition root. Do not abstract unrelated internal details or require zero dependencies.

## 3. Prove the skeleton before feature internals

Present a compact wiring packet: component/contract ownership, entry-to-output flow, production assembly location, standalone-build scope, and the smallest checks that could falsify the design. Then, within approved scope:

1. Add the minimum contracts and registration/factory wiring needed for a compilable vertical skeleton.
2. Supply deterministic recording implementations in tests only. Drive the real registration/parsing/dispatch path, not a parallel mock route that bypasses application wiring.
3. Assert inputs reach the supplied implementation and outputs/errors return through the expected boundary. Replace a provider with a second implementation and prove consumers do not change.
4. Exercise relevant lifecycle rules with controlled promises or callbacks: cancellation, failure, sequencing, notification count, and preservation of earlier completed work.
5. Keep unfinished production capabilities unregistered or explicitly unavailable. Never use a production no-op, fabricated success, or swallowed exception to make a skeleton appear complete.

**Gate:** do not fill in concrete component behavior until the skeleton compiles and its wiring checks pass. If checks cannot run, report the limitation and seek direction instead of calling the wiring proven. Preserve existing working behavior during a refactor; introduce the seam without removing a functioning provider prematurely.

## 4. Implement behind the proven seams

Implement each cohesive component against its contract; independent components can proceed in parallel once the skeleton gate passes. Connect real implementations at the production composition root without giving consumers concrete implementation knowledge. Keep recording providers test-only and retain contract/wiring tests.

If a component cannot fit the agreed contract, return to that boundary explicitly. Do not repair the mismatch by importing its implementation into a consumer. Keep existing application lifecycle ownership unless a change is deliberately approved.

## 5. Verify independence and the assembled feature separately

When independent delivery is required, verify each component from a clean agreed base (usually `main`) plus only its own changes. Include tests, fixtures, bootstrap code, and build configuration in that check; stale generated output or sibling declarations cannot supply missing dependencies. If a new shared contract is necessary, either land it in the agreed base first or acknowledge the prerequisite and revisit the split. Do not claim independence while it is unmerged.

Run the relevant module checks, then test real implementations together through the production entry point. Test providers prove routing and substitution, not end-to-end behavior. Report missing transport, application-host, or external-service coverage explicitly.

If the user requests sibling branches, keep each component's changes cohesive and independently buildable. A local integration branch may merge them for combined testing, but production composition changes need an explicit shipping owner; they cannot exist only as untracked/local-only glue. Branch creation, rewriting, commits, and pushes still require authorization from the task.

## Handoff

Report briefly:

- What was wired and where concrete implementations are selected.
- Which components are independently buildable and what evidence supports that claim.
- Which substitution, lifecycle, and real integration checks passed, failed, or were not run.
- Remaining prerequisites and the next concrete component to implement.
