import { describe, expect, test } from "vitest";
import { calculateMetrics } from "../../scripts/metrics/calculate.js";
import type { DeliveryRecord, IncidentRecord, MetricsInput } from "../../scripts/metrics/calculate.js";

const window = { from: "2026-01-01T00:00:00Z", to: "2026-01-11T00:00:00Z" };
function delivery(id: string, availableAt: string, overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return { id, environment: "package-delivery", availableAt, deliveryKind: "planned", incidentIds: [], commitInventoryComplete: true, commits: [], ...overrides };
}
function incident(id: string, deploymentId: string, overrides: Partial<IncidentRecord> = {}): IncidentRecord {
  return {
    id, deploymentIds: [deploymentId], impactStartedAt: "2026-01-02T10:00:00Z", detectedAt: "2026-01-02T10:30:00Z",
    requiresImmediateIntervention: true, recoveredAt: null, recoveryVerified: false, recoveryDeploymentId: null, ...overrides,
  };
}
function records(deployments: DeliveryRecord[], incidents: IncidentRecord[] = []): MetricsInput {
  return { schemaVersion: 1, deployments, incidents, coverage: { deployments: window, incidents: window } };
}

describe("delivery metrics describe evidence rather than optimistic defaults", () => {
  test("uses commit-to-availability durations and only package deployments in the half-open window", () => {
    const report = calculateMetrics(records([
      delivery("one", "2026-01-02T12:00:00Z", { commits: [{ sha: "a", committedAt: "2026-01-02T06:00:00Z" }, { sha: "b", committedAt: "2026-01-02T10:00:00Z" }] }),
      delivery("two", "2026-01-06T12:00:00Z", { commits: [{ sha: "c", committedAt: "2026-01-06T08:00:00Z" }] }),
      delivery("docs", "2026-01-05T00:00:00Z", { environment: "specification-delivery" }),
      delivery("boundary", window.to),
    ]), window);
    expect(report.deploymentFrequency).toEqual({ perDay: 0.2, deployments: 2, windowDays: 10, coverageComplete: true });
    expect(report.changeLeadTime).toMatchObject({ medianHours: 4, samples: 3, missingCommitTimes: 0 });
    expect(report.data.excludedEnvironmentRecords).toBe(1);
  });

  test("deduplicates records and deployed commits instead of inflating delivery or lead-time samples", () => {
    const first = delivery("one", "2026-01-02T12:00:00Z", { commits: [{ sha: "same", committedAt: "2026-01-02T10:00:00Z" }] });
    const report = calculateMetrics(records([first, structuredClone(first), delivery("two", "2026-01-03T12:00:00Z", { commits: first.commits })]), window);
    expect(report.deploymentFrequency.deployments).toBe(2);
    expect(report.data.duplicateDeliveryRecords).toBe(1);
    expect(report.changeLeadTime).toMatchObject({ medianHours: 2, samples: 1 });
  });

  test("keeps repeated incident reports as one failed deployment and includes its still-open failure", () => {
    const report = calculateMetrics(records([delivery("failed", "2026-01-02T09:00:00Z"), delivery("okay", "2026-01-03T09:00:00Z")], [
      incident("i1", "failed"), incident("i2", "failed"),
    ]), window);
    expect(report.changeFailRate).toMatchObject({ ratio: 0.5, failedDeployments: 1, deployments: 2 });
    expect(report.failedDeploymentRecoveryTime).toEqual({ medianHours: null, samples: 0, censoredDeployments: 1, unknownDurationDeployments: 0 });
  });

  test("recovery duration starts at known impact and ends at verified recovery, not incident creation or detection", () => {
    const report = calculateMetrics(records([delivery("failed", "2026-01-02T09:00:00Z")], [
      incident("i1", "failed", { recoveredAt: "2026-01-02T14:00:00Z", recoveryVerified: true, recoveryDeploymentId: "fix" }),
      incident("i2", "failed", { impactStartedAt: "2026-01-02T11:00:00Z", detectedAt: "2026-01-02T12:00:00Z", recoveredAt: "2026-01-02T16:00:00Z", recoveryVerified: true, recoveryDeploymentId: "fix" }),
    ]), window);
    expect(report.failedDeploymentRecoveryTime).toEqual({ medianHours: 6, samples: 1, censoredDeployments: 0, unknownDurationDeployments: 0 });
  });

  test("missing impact time does not become detection time and recovery after the cutoff stays censored", () => {
    const report = calculateMetrics(records([delivery("unknown", "2026-01-02T09:00:00Z"), delivery("later", "2026-01-03T09:00:00Z")], [
      incident("unknown-time", "unknown", { impactStartedAt: null, recoveredAt: "2026-01-02T14:00:00Z", recoveryVerified: true }),
      incident("late-recovery", "later", { recoveredAt: "2026-01-12T00:00:00Z", recoveryVerified: true }),
    ]), window);
    expect(report.failedDeploymentRecoveryTime).toMatchObject({ medianHours: null, samples: 0, censoredDeployments: 1, unknownDurationDeployments: 1 });
    expect(report.changeFailRate.failedDeployments).toBe(2);
  });

  test("missing inventories and incident coverage yield unknown rates instead of zero percent", () => {
    const input = records([delivery("one", "2026-01-02T12:00:00Z", { deliveryKind: null, commitInventoryComplete: false, commits: [{ sha: "a", committedAt: null }] })]);
    input.coverage = { deployments: null, incidents: null };
    const report = calculateMetrics(input, window);
    expect(report.deploymentFrequency.perDay).toBeNull();
    expect(report.changeFailRate.ratio).toBeNull();
    expect(report.deploymentReworkRate.ratio).toBeNull();
    expect(report.changeLeadTime).toMatchObject({ medianHours: null, samples: 0, missingCommitTimes: 1, missingCommitInventories: 1, coverageComplete: false });
  });

  test("counts only explicitly classified, incident-linked rework and reports unknown classifications", () => {
    const incidentRecord = incident("i", "original");
    const good = records([delivery("planned", "2026-01-02T09:00:00Z"), delivery("fix", "2026-01-03T09:00:00Z", { deliveryKind: "incident-recovery", incidentIds: ["i"] })], [incidentRecord]);
    expect(calculateMetrics(good, window).deploymentReworkRate).toMatchObject({ ratio: 0.5, reworkDeployments: 1, unclassifiedDeployments: 0 });
    good.deployments.push(delivery("unlinked", "2026-01-04T09:00:00Z", { deliveryKind: "incident-recovery" }));
    expect(calculateMetrics(good, window).deploymentReworkRate).toMatchObject({ ratio: null, reworkDeployments: 1, unclassifiedDeployments: 1 });
  });

  test("an empty complete window has zero frequency but no invented rate or duration denominators", () => {
    const report = calculateMetrics(records([]), window);
    expect(report.deploymentFrequency.perDay).toBe(0);
    expect(report.changeFailRate.ratio).toBeNull();
    expect(report.deploymentReworkRate.ratio).toBeNull();
    expect(report.changeLeadTime.medianHours).toBeNull();
    expect(report.failedDeploymentRecoveryTime.medianHours).toBeNull();
  });

  test("unknown failure classification or missing detection time prevents a complete failure-rate claim", () => {
    const report = calculateMetrics(records([delivery("one", "2026-01-02T09:00:00Z")], [
      incident("unclassified", "one", { requiresImmediateIntervention: null }),
      incident("undated", "one", { detectedAt: null }),
    ]), window);
    expect(report.changeFailRate).toMatchObject({ ratio: null, unclassifiedIncidents: 2, coverageComplete: false });
  });

  test("an unattributed incident cannot disappear into a zero failure rate", () => {
    const input = records([delivery("one", "2026-01-02T09:00:00Z")], [
      incident("unlinked", "one", { deploymentIds: [] }),
    ]);
    expect(calculateMetrics(input, window).changeFailRate).toMatchObject({ ratio: null, unclassifiedIncidents: 1, coverageComplete: false });
    input.incidents[0]!.deploymentIds = ["not-in-the-inventory"];
    expect(calculateMetrics(input, window).changeFailRate.ratio).toBeNull();
    input.deployments.push(delivery("not-in-the-inventory", "2025-12-20T00:00:00Z"));
    expect(calculateMetrics(input, window).changeFailRate).toMatchObject({ ratio: 0, unclassifiedIncidents: 0, coverageComplete: true });
  });

  test("rejects invalid timestamps, backwards windows, conflicting duplicate IDs, and negative lead times", () => {
    expect(() => calculateMetrics(records([]), { from: window.to, to: window.from })).toThrow();
    expect(() => calculateMetrics(records([delivery("a", "2026-02-30T00:00:00Z")]), window)).toThrow();
    expect(() => calculateMetrics(records([delivery("same", "2026-01-02T00:00:00Z"), delivery("same", "2026-01-03T00:00:00Z")]), window)).toThrow();
    expect(() => calculateMetrics(records([delivery("a", "2026-01-02T00:00:00Z", { commits: [{ sha: "future", committedAt: "2026-01-03T00:00:00Z" }] })]), window)).toThrow();
  });

  test("malformed JSON cannot turn text into verified recovery or guessed delivery classification", () => {
    const input = records([delivery("one", "2026-01-02T09:00:00Z")], [incident("i", "one", { recoveredAt: "2026-01-02T14:00:00Z" })]);
    const malformed: unknown = { ...input, incidents: [{ ...input.incidents[0], recoveryVerified: "false" }] };
    expect(() => calculateMetrics(malformed as MetricsInput, window)).toThrow(/recoveryVerified/);
    expect(() => calculateMetrics({ ...input, deployments: [{ ...input.deployments[0], deliveryKind: "maybe" }] } as unknown as MetricsInput, window)).toThrow(/deliveryKind/);
    expect(() => calculateMetrics({ ...input, incidents: [{ ...input.incidents[0], deploymentIds: [2] }] } as unknown as MetricsInput, window)).toThrow(/deploymentIds/);
  });
});
