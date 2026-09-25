# Delivery and incident evidence

The user is the architect and consumer; the development assistant implements the agreed outcomes, demonstrates them, and maintains delivery evidence. The consumer reports observed problems and verifies recovery. These roles do not change repository permissions or authorize unrelated publication.

For this project, a **compiler deployment** occurs when a built package artifact is available from a release and that availability has been verified. Its GitHub Deployment environment is `package-delivery`. A merged PR, successful unit test, local build, or drafted release is not that event. Publishing to npm is not required or implied. Specification bundles use `specification-delivery` and are measured separately.

## Work through delivery

1. Select the Notion task and its consumer outcome. Before starting its specification, test, or implementation work, create the task branch and a task-start commit naming the task ID and Notion link. An empty commit is acceptable when no files have changed. Push it promptly and retain its SHA and original timestamp. Then refine the relevant examples into independent executable expectations; identify what remains unfinished.
2. Implement and run the real checks. Keep the task's compact Hypothesis / Testlist / Learnings body current; detailed specifications stay in the repository.
3. Open a PR using the [PR template](../.github/pull_request_template.md). Supply the task ID, actual Notion link, changed behavior, executed validation, remaining limits, and learning. Record `Delivery-kind: planned` or `Delivery-kind: incident-recovery`; the latter requires linked incidents and means unplanned work responding to an incident.
4. Follow the repository's review and merge policy. The delivery workflow builds and exposes the artifact, verifies availability, and records the release/deployment and `delivery.json`. A failed workflow before availability is build/release-process evidence, not a successful package delivery.
5. The consumer exercises the delivered artifact. A discovered failure enters the incident process below. The developer updates evidence and task learning rather than changing expected results merely to obtain green tests.

The machine-readable PR lines are `Notion-task:`, `Notion-link:`, `Delivery-kind:`, and `Incidents:`. An incident list looks like `#12, #34`; a planned change without an incident uses `none`. Missing classification remains unknown. A release can be available successfully while its behavior later proves faulty; that is how a delivered change enters the failure numerator.

Link the task-start commit in the PR's Behavior section. Its original commit record is retained by the release's `source.commits` inventory even when the PR is squash-merged. Preserve that record before rewriting history. Continuing or resuming the same task does not create a new start time. The task-start-to-delivery duration is a separate task-level observation; the existing DORA calculator still reports its documented per-commit lead-time measure and does not yet calculate task duration.

CORE-01 and CORE-18 began before this convention was adopted. Their first commits were made after work had started; the original task-start times are unknown. Do not backdate replacement commits or use today's process-update commit as their original start. Later tasks should have a start commit created before the work.

## Incident and recovery cycle

Use the [consumer incident form](../.github/ISSUE_TEMPLATE/incident.yml) for the affected release/artifact, originating PR or deployment when known, expected versus observed behavior, impact, impact start, and detection time. UTC timestamps end in `Z`. Unknown times stay unknown; neither issue creation nor PR merge time fills a missing impact or detection timestamp.

Triage whether the delivered change requires immediate intervention, such as a rollback or urgent repair. Record Yes, No, or Unknown explicitly. An ordinary backlog improvement does not automatically become a failed deployment. Preserve the original incident and affected deployment links even if several reports describe the same failed delivery.

An unplanned recovery PR uses `Delivery-kind: incident-recovery` and links its incidents. Deliver the repair or rollback artifact through the same recorded process. After the consumer verifies restored behavior, update the original incident's recovery timestamp, verification evidence, recovery release/deployment, and learning. Closing an issue or merging a fix alone does not establish recovery. Do not create example incidents in the live tracker merely to populate a dashboard.

## Five measurements and this project's conventions

DORA's current five measurements cover change lead time, deployment frequency, failed deployment recovery time, change fail rate, and deployment rework rate. They distinguish getting changes to consumers from the instability those changes cause. We use them to improve this application's delivery process, not to rank the developer or create output quotas. [DORA's metric definitions](https://dora.dev/guides/dora-metrics/).

| Measurement | Local operational definition |
| --- | --- |
| Change lead time | Median hours from each original commit's `committedAt` to its first recorded package availability. This is not PR creation-to-merge time. |
| Deployment frequency | Available package deployments in the reporting window, plus count divided by window days. |
| Failed deployment recovery time | Median hours from evidenced impact start to verified restoration, for recovered failed deployments in the cohort. |
| Change fail rate | Unique delivered deployments requiring immediate intervention divided by delivered deployments. |
| Deployment rework rate | Explicitly classified, incident-linked unplanned recovery deliveries divided by delivered deployments. |

These are project reporting conventions, not additional DORA requirements. Windows are `[from, to)` in UTC and use one environment. Incident observations and recoveries must precede the cutoff. A later report can revise the same delivery cohort with better evidence; keep the input snapshot with the report.

Multiple incidents affecting one deployment count once in the failure numerator. Its recovery duration spans the earliest known impact start through the last verified recovery of its qualifying incidents. If any remain open at the cutoff, that failed deployment is **censored**: excluded from the recovery median and counted separately, while remaining in the failure numerator. Verified recovery with unknown timing is also excluded from duration samples. Missing recovery-release links are reported. An incident's detection time is retained but is not a substitute for impact start.

Commit SHAs and deployment IDs are deduplicated. Include earlier delivery records when a package contains a previously delivered commit: lead time uses the first supplied delivery for that commit in the selected environment. Keep complete commit inventories, including original pre-squash commits. Repeated artifacts do not create additional change-lead-time samples for the same commit. Conflicting records and impossible timestamps are errors to repair, not values to average.

## Record input and run a report

The calculator takes explicit normalized JSON; it does not scrape GitHub or infer outcomes. Start from [records.example.json](../scripts/metrics/records.example.json), whose empty records and unknown coverage make no delivery or consumer claims. Keep actual record snapshots as reporting artifacts. The input contract is in [calculate.ts](../scripts/metrics/calculate.ts).

Normalize each successful delivery's `delivery.json` as follows:

| Normalized deployment field | Recorded source |
| --- | --- |
| `id` | `deployment.id`, converted to a string |
| `environment` | `deployment.environment` |
| `availableAt` | `deployment.deliveredAt`; retain `null` if absent |
| `deliveryKind` | `pullRequest.deliveryKind`; absent remains `null` |
| `incidentIds` | `pullRequest.incidentNumbers`, qualified consistently as `owner/repo#number` |
| `commits` | `source.commits` mapped to `sha` and `committedAt` |
| `commitInventoryComplete` | `source.commitsComplete`; absent becomes `false` |

Only successful, verified artifact deliveries belong in this inventory. Retain release URLs, artifact hashes, workflow URLs, and source metadata in their original `delivery.json` alongside the normalized snapshot for audit. A specification artifact can stay in the snapshot; environment filtering excludes it from package metrics.

Each incident record has `id`, `deploymentIds`, `impactStartedAt`, `detectedAt`, `requiresImmediateIntervention`, `recoveredAt`, `recoveryVerified`, and `recoveryDeploymentId`. Resolve affected release links to actual deployment IDs; do not substitute a PR number. Use `null` for unknown timestamps, classification, or recovery deployment, and `false` while recovery is unverified. Follow-up edits populate verified facts, not guessed times.

`coverage.deployments` and `coverage.incidents` are each either `null` or a `{ "from": "...Z", "to": "...Z" }` interval. Mark an interval covered only after checking the release inventory and relevant incident records through that cutoff. An empty incident list alone does not establish coverage. If a release cannot yet be linked to an incident, retain the incident with an empty or unresolved deployment list; the calculator reports incomplete failure coverage until reconciled. Only supplied evidence placing its affected deployments outside this cohort/environment permits exclusion.

With the documented Node 24 development runtime:

```sh
node scripts/metrics/report.mjs --input records.json --from 2026-09-01T00:00:00Z --to 2026-10-01T00:00:00Z
node scripts/metrics/report.mjs --input records.json --from 2026-09-01T00:00:00Z --to 2026-10-01T00:00:00Z --format json
```

The CLI writes its report to standard output and exits nonzero for malformed input. `--environment specification-delivery` produces a separate specification report. No scheduled monitoring or external writes occur.

Every report includes denominators, sample counts, missing times, missing inventories, classification gaps, and censored recoveries. Unknown inventory or incident coverage prevents a complete failure-rate claim; unknown delivery kind or missing incident links prevents a complete rework-rate claim. An empty complete window has zero deployment frequency but undefined percentage and duration denominators. Missing data is **unknown**, not 0%. Duration medians may summarize available samples with incomplete coverage visibly reported.

Review the evidence at task or release checkpoints: which delay or failure mattered to the consumer, what change might improve it, and what subsequent observation would test that hypothesis? Record the learning in the existing task. Automated GitHub record ingestion can be added later; the explicit records and CLI already support the full reporting loop without claiming any real incident outcome today.
