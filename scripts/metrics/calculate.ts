export type Interval = { from: string; to: string };
export type DeliveryRecord = {
  id: string;
  environment: string;
  availableAt: string | null;
  deliveryKind: "planned" | "incident-recovery" | null;
  incidentIds: string[];
  commitInventoryComplete: boolean;
  commits: { sha: string; committedAt: string | null }[];
};
export type IncidentRecord = {
  id: string;
  deploymentIds: string[];
  impactStartedAt: string | null;
  detectedAt: string | null;
  requiresImmediateIntervention: boolean | null;
  recoveredAt: string | null;
  recoveryVerified: boolean;
  recoveryDeploymentId: string | null;
};
export type MetricsInput = {
  schemaVersion: 1;
  deployments: DeliveryRecord[];
  incidents: IncidentRecord[];
  coverage: { deployments: Interval | null; incidents: Interval | null };
};
export type MetricsReport = {
  environment: string;
  window: Interval;
  deploymentFrequency: { perDay: number | null; deployments: number; windowDays: number; coverageComplete: boolean };
  changeLeadTime: { medianHours: number | null; samples: number; missingCommitTimes: number; missingCommitInventories: number; coverageComplete: boolean };
  failedDeploymentRecoveryTime: { medianHours: number | null; samples: number; censoredDeployments: number; unknownDurationDeployments: number };
  changeFailRate: { ratio: number | null; failedDeployments: number; deployments: number; unclassifiedIncidents: number; coverageComplete: boolean };
  deploymentReworkRate: { ratio: number | null; reworkDeployments: number; deployments: number; unclassifiedDeployments: number; coverageComplete: boolean };
  data: { suppliedDeployments: number; duplicateDeliveryRecords: number; excludedEnvironmentRecords: number; missingDeploymentTimes: number; relevantIncidents: number; unlinkedIncidents: number; missingRecoveryReleaseLinks: number };
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function instant(value: string, label: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new Error(`${label} must be a UTC timestamp ending in Z`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== value.slice(0, 19)) throw new Error(`${label} is an invalid timestamp`);
  return time;
}

function optionalInstant(value: string | null, label: string): number | null {
  return value === null ? null : instant(value, label);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function covered(interval: Interval | null, from: number, to: number): boolean {
  if (interval === null) return false;
  const start = instant(interval.from, "coverage.from");
  const end = instant(interval.to, "coverage.to");
  if (start >= end) throw new Error("Coverage interval must have positive duration");
  return start <= from && end >= to;
}

function uniqueById<T extends { id: string }>(records: T[], label: string) {
  const byId = new Map<string, T>();
  let duplicates = 0;
  for (const record of records) {
    if (!record.id) throw new Error(`${label} is missing an id`);
    const existing = byId.get(record.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error(`Conflicting ${label} records for ${record.id}`);
      duplicates++;
    } else byId.set(record.id, record);
  }
  return { records: [...byId.values()], duplicates };
}

function requireText(value: unknown, label: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a nonempty string`);
}

function requireTextList(value: unknown, label: string): void {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of strings`);
  value.forEach((item) => requireText(item, label));
}

function validateRecords(input: MetricsInput): void {
  if (!input || input.schemaVersion !== 1) throw new Error("Unsupported metrics schemaVersion");
  if (!Array.isArray(input.deployments) || !Array.isArray(input.incidents) || !input.coverage) throw new Error("Deployment, incident, and coverage records are required");
  for (const record of input.deployments) {
    if (!record || typeof record !== "object") throw new Error("Deployment must be an object");
    requireText(record.id, "deployment.id");
    requireText(record.environment, `${record.id}.environment`);
    optionalInstant(record.availableAt, `${record.id}.availableAt`);
    if (![null, "planned", "incident-recovery"].includes(record.deliveryKind)) throw new Error(`${record.id}.deliveryKind must be planned, incident-recovery, or null`);
    requireTextList(record.incidentIds, `${record.id}.incidentIds`);
    if (typeof record.commitInventoryComplete !== "boolean") throw new Error(`${record.id}.commitInventoryComplete must be boolean`);
    if (!Array.isArray(record.commits)) throw new Error(`${record.id}.commits must be an array`);
    for (const commit of record.commits) {
      if (!commit || typeof commit !== "object") throw new Error(`${record.id}.commits needs objects`);
      requireText(commit.sha, `${record.id}.commit.sha`);
      optionalInstant(commit.committedAt, `${commit.sha}.committedAt`);
    }
  }
  for (const record of input.incidents) {
    if (!record || typeof record !== "object") throw new Error("Incident must be an object");
    requireText(record.id, "incident.id");
    requireTextList(record.deploymentIds, `${record.id}.deploymentIds`);
    optionalInstant(record.detectedAt, `${record.id}.detectedAt`);
    optionalInstant(record.impactStartedAt, `${record.id}.impactStartedAt`);
    optionalInstant(record.recoveredAt, `${record.id}.recoveredAt`);
    if (record.requiresImmediateIntervention !== null && typeof record.requiresImmediateIntervention !== "boolean") throw new Error(`${record.id}.requiresImmediateIntervention must be boolean or null`);
    if (typeof record.recoveryVerified !== "boolean") throw new Error(`${record.id}.recoveryVerified must be boolean`);
    if (record.recoveryDeploymentId !== null) requireText(record.recoveryDeploymentId, `${record.id}.recoveryDeploymentId`);
  }
}

export function calculateMetrics(input: MetricsInput, window: Interval, environment = "package-delivery"): MetricsReport {
  validateRecords(input);
  requireText(environment, "environment");
  const from = instant(window.from, "window.from");
  const to = instant(window.to, "window.to");
  if (from >= to) throw new Error("Reporting window must have positive duration");
  const deliveries = uniqueById(input.deployments, "deployment");
  const incidents = uniqueById(input.incidents, "incident").records;
  const incidentIds = new Set(incidents.map((record) => record.id));
  const inEnvironment = deliveries.records.filter((record) => record.environment === environment);
  const dated = inEnvironment.map((record) => ({ record, time: optionalInstant(record.availableAt, `${record.id}.availableAt`) }));
  const missingDeploymentTimes = dated.filter((entry) => entry.time === null).length;
  const cohort = dated.filter((entry): entry is { record: DeliveryRecord; time: number } => entry.time !== null && entry.time >= from && entry.time < to);
  const cohortIds = new Set(cohort.map((entry) => entry.record.id));
  const allDeliveryIds = new Set(deliveries.records.map((record) => record.id));
  const deploymentCoverage = covered(input.coverage.deployments, from, to) && missingDeploymentTimes === 0;
  const incidentCoverage = covered(input.coverage.incidents, from, to);

  // A commit contributes once, at its first supplied delivery in this environment.
  const firstCommits = new Map<string, { deployedAt: number; committedAt: number | null }>();
  for (const { record, time } of dated.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity))) {
    if (time === null) continue;
    if (!Array.isArray(record.commits) || typeof record.commitInventoryComplete !== "boolean") throw new Error(`${record.id} needs explicit commit inventory coverage`);
    for (const commit of record.commits) {
      if (!commit.sha) throw new Error(`${record.id} has a commit without a SHA`);
      const committedAt = optionalInstant(commit.committedAt, `${commit.sha}.committedAt`);
      if (committedAt !== null && committedAt > time) throw new Error(`${commit.sha} was committed after its delivery`);
      const previous = firstCommits.get(commit.sha);
      if (previous && previous.committedAt !== committedAt) throw new Error(`Conflicting timestamps for commit ${commit.sha}`);
      if (!previous) firstCommits.set(commit.sha, { deployedAt: time, committedAt });
    }
  }
  const cohortCommits = [...firstCommits.values()].filter((commit) => commit.deployedAt >= from && commit.deployedAt < to);
  const leadTimes = cohortCommits.flatMap((commit) => commit.committedAt === null ? [] : [(commit.deployedAt - commit.committedAt) / HOUR]);
  const missingCommitTimes = cohortCommits.filter((commit) => commit.committedAt === null).length;
  const missingCommitInventories = cohort.filter((entry) => !entry.record.commitInventoryComplete).length;

  const failures = new Map<string, IncidentRecord[]>();
  let relevantIncidents = 0;
  let unclassifiedIncidents = 0;
  let unlinkedIncidents = 0;
  for (const incident of incidents) {
    if (!Array.isArray(incident.deploymentIds)) throw new Error(`${incident.id} needs affected deployment IDs`);
    const affected = [...new Set(incident.deploymentIds)].filter((id) => cohortIds.has(id));
    const unknownLink = incident.deploymentIds.length === 0 || incident.deploymentIds.some((id) => !allDeliveryIds.has(id));
    if (!affected.length && !unknownLink) continue;
    const detected = optionalInstant(incident.detectedAt, `${incident.id}.detectedAt`);
    if (detected !== null && detected >= to) continue;
    relevantIncidents++;
    if (unknownLink) unlinkedIncidents++;
    if (detected === null || incident.requiresImmediateIntervention === null || unknownLink) unclassifiedIncidents++;
    if (detected === null || incident.requiresImmediateIntervention === null) continue;
    if (typeof incident.requiresImmediateIntervention !== "boolean") throw new Error(`${incident.id} needs explicit failure classification or null`);
    if (!incident.requiresImmediateIntervention) continue;
    for (const id of affected) failures.set(id, [...(failures.get(id) ?? []), incident]);
  }

  const recoveryTimes: number[] = [];
  let censoredDeployments = 0;
  let unknownDurationDeployments = 0;
  let missingRecoveryReleaseLinks = 0;
  for (const related of failures.values()) {
    const starts = related.map((incident) => optionalInstant(incident.impactStartedAt, `${incident.id}.impactStartedAt`));
    const ends = related.map((incident) => optionalInstant(incident.recoveredAt, `${incident.id}.recoveredAt`));
    if (related.some((incident, index) => !incident.recoveryVerified || (ends[index] !== null && ends[index]! >= to))) {
      censoredDeployments++;
      continue;
    }
    if (related.some((incident) => !incident.recoveryDeploymentId)) missingRecoveryReleaseLinks++;
    if (starts.some((time) => time === null) || ends.some((time) => time === null)) {
      unknownDurationDeployments++;
      continue;
    }
    for (let index = 0; index < starts.length; index++) {
      if (ends[index]! < starts[index]!) throw new Error("Verified recovery precedes impact start");
    }
    recoveryTimes.push((Math.max(...(ends as number[])) - Math.min(...(starts as number[]))) / HOUR);
  }

  let reworkDeployments = 0;
  let unclassifiedDeployments = 0;
  for (const { record } of cohort) {
    if (!Array.isArray(record.incidentIds)) throw new Error(`${record.id} needs an incidentIds list`);
    if (record.deliveryKind === "planned") continue;
    if (record.deliveryKind === "incident-recovery" && record.incidentIds.length > 0 && record.incidentIds.every((id) => incidentIds.has(id))) reworkDeployments++;
    else unclassifiedDeployments++;
  }
  const failureCoverage = deploymentCoverage && incidentCoverage && unclassifiedIncidents === 0;
  const reworkCoverage = deploymentCoverage && unclassifiedDeployments === 0;
  const windowDays = (to - from) / DAY;
  return {
    environment, window: { ...window },
    deploymentFrequency: { perDay: deploymentCoverage ? cohort.length / windowDays : null, deployments: cohort.length, windowDays, coverageComplete: deploymentCoverage },
    changeLeadTime: {
      medianHours: median(leadTimes), samples: leadTimes.length, missingCommitTimes, missingCommitInventories,
      coverageComplete: deploymentCoverage && missingCommitTimes === 0 && missingCommitInventories === 0,
    },
    failedDeploymentRecoveryTime: { medianHours: median(recoveryTimes), samples: recoveryTimes.length, censoredDeployments, unknownDurationDeployments },
    changeFailRate: { ratio: failureCoverage && cohort.length > 0 ? failures.size / cohort.length : null, failedDeployments: failures.size, deployments: cohort.length, unclassifiedIncidents, coverageComplete: failureCoverage },
    deploymentReworkRate: { ratio: reworkCoverage && cohort.length > 0 ? reworkDeployments / cohort.length : null, reworkDeployments, deployments: cohort.length, unclassifiedDeployments, coverageComplete: reworkCoverage },
    data: {
      suppliedDeployments: input.deployments.length, duplicateDeliveryRecords: deliveries.duplicates,
      excludedEnvironmentRecords: deliveries.records.length - inEnvironment.length, missingDeploymentTimes, relevantIncidents, unlinkedIncidents, missingRecoveryReleaseLinks,
    },
  };
}
