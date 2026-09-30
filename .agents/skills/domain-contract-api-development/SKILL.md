---
name: domain-contract-api-development
description: Design and deliver service-based systems by combining Domain-Driven Design (DDD), API-first design, and Contract-Driven Development (CDD). Use when planning or implementing microservices or event-driven systems, defining OpenAPI/AsyncAPI/gRPC contracts, enabling parallel consumer/provider development, generating mocks and stubs, enforcing contract tests in CI, or aligning bounded contexts and ubiquitous language before coding.
---

# Domain Contract API Development

## Overview
Use a domain-first, contract-first delivery loop to reduce integration failures and keep implementation aligned with business language.
Prioritize bounded-context ownership, executable contracts, and continuous compatibility checks.

## Core Loop
1. Model domain boundaries first.
- Identify core, supporting, and generic subdomains.
- Define bounded contexts and owners.
- Define a ubiquitous language and key invariants per context.

2. Define contracts before implementation.
- Write interface contracts in OpenAPI, AsyncAPI, or Protocol Buffers.
- Specify success and failure responses, auth expectations, idempotency, pagination, and versioning rules.
- Review contracts jointly with provider and consumer owners.

3. Make contracts executable.
- Generate provider stubs and consumer mocks from the contract.
- Add contract tests that fail on schema drift and behavior mismatch.
- Run contract tests in CI as merge gates.

4. Develop in parallel and apply TDD within each side.
- Implement consumer behavior against mocks first.
- Implement provider behavior against failing contract tests first.
- Use red -> green -> refactor for internal unit and integration logic.

5. Enforce compatibility continuously.
- Run backward-compatibility checks for every contract change.
- Block breaking changes unless versioning and migration plans are explicit.
- Publish docs and generated artifacts from the same contract source.

6. Operate with governance and feedback.
- Enforce authentication, authorization, and data-classification constraints in contracts.
- Standardize tracing, correlation IDs, and error envelopes.
- Track lead time, contract break rate, and integration defect rate.

## Default Outputs
- Bounded-context map with ownership.
- Ubiquitous language glossary.
- Contract files (`openapi.yaml`, `asyncapi.yaml`, or `.proto`).
- Generated mocks and stubs.
- Contract-test suites and CI gates.
- Versioning and deprecation policy per interface.

## Decision Rules
- Prefer this approach for complex domains, multi-team ownership, or high integration risk.
- Use a lighter API-first approach for simple single-team CRUD systems with low integration risk.
- Split contracts by bounded context; avoid a single shared mega-spec.
- Treat contract changes as product changes and apply semantic versioning.

## Guardrails
- Do not start provider implementation before agreeing on a contract.
- Do not maintain separate human docs that diverge from executable contracts.
- Do not share internal domain entities directly across bounded contexts.
- Do not ship breaking contract changes without migration timelines and compatibility tests.

## Prompt Template
Apply `domain-contract-api-development` for `[feature/domain]`: model bounded contexts, define contracts first, generate executable contract tests and mocks, then propose a red -> green -> refactor implementation path.
