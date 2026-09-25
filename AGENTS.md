# Working on .expec

- The user is the designer/architect and initial consumer. Implement agreed needs, surface discoveries, and keep proposed design choices distinguishable from evidence.
- Use one pull request per Notion construction task. Link its Task ID and Notion page. Continue that PR through the task's iterations; keep incomplete work visibly draft. Do not merge merely because tests pass.
- Work from consumer-facing acceptance examples. Run a new expectation and observe its failure before implementing the behavior; add focused unit tests as responsibilities emerge. Then implement, refactor, and run the relevant checks. Vitest is the test runner.
- Acceptance helpers invoke the real public API and inspect actual results. Do not derive expected answers by reparsing source or using the implementation under test. Unbound examples and unsupported features must remain explicit.
- Relationships derive from dependencies, construction parameters, capability/function inputs and outputs, and typed fields. Do not add separate relationship syntax or infer ownership, lifetime, or runtime calls from references.
- The compiler core reads supplied source and metadata. File discovery, package installation, project mutation, and scenario execution have separate boundaries.
- Each merged task PR to the default branch produces a verified artifact, release, and deployment record. Package delivery is the current deployment boundary; publishing to npm is future work. Never mark a failed build/upload as a successful deployment or duplicate a successful delivery on retry.
- Preserve original commit timestamps, deployment IDs, artifact hashes, incident linkage, and actual impact/recovery times for delivery metrics. Missing evidence is unknown, not zero. Do not use issue-close time as a guessed recovery time.
- Keep Notion task bodies compact: Hypothesis, Test list, Learnings. Detailed specifications and implementation evidence belong in linked documents. Readiness and passing tests do not establish the whole task is complete.
