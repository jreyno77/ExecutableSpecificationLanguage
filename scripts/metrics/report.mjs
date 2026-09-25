#!/usr/bin/env node
import fs from "node:fs";
import { calculateMetrics } from "./calculate.ts";

const usage = "node scripts/metrics/report.mjs --input records.json --from <UTC> --to <UTC> [--format markdown|json] [--environment package-delivery]";
try {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index];
    const value = process.argv[index + 1];
    if (!["--input", "--from", "--to", "--format", "--environment"].includes(name) || !value || args.has(name)) throw new Error(`Invalid or repeated option ${name}`);
    args.set(name, value);
  }
  if (!["--input", "--from", "--to"].every((name) => args.has(name))) throw new Error(usage);
  const format = args.get("--format") ?? "markdown";
  if (format !== "markdown" && format !== "json") throw new Error("Format must be markdown or json");
  const input = JSON.parse(fs.readFileSync(args.get("--input"), "utf8").replace(/^\uFEFF/, ""));
  const report = calculateMetrics(input, { from: args.get("--from"), to: args.get("--to") }, args.get("--environment") ?? "package-delivery");
  if (format === "json") process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    const number = (value) => value === null ? "unknown" : Number(value.toFixed(3)).toString();
    const percent = (value) => value === null ? "unknown" : `${number(value * 100)}%`;
    const complete = (value) => value ? "complete" : "incomplete";
    const d = report.deploymentFrequency;
    const l = report.changeLeadTime;
    const r = report.failedDeploymentRecoveryTime;
    const f = report.changeFailRate;
    const w = report.deploymentReworkRate;
    process.stdout.write([
      `# Delivery evidence: ${report.environment}`,
      "",
      `Window: ${report.window.from} inclusive to ${report.window.to} exclusive; incident observations stop at that cutoff.`,
      "",
      "| Metric | Value | Evidence and coverage |",
      "| --- | --- | --- |",
      `| Deployment frequency | ${number(d.perDay)} / day | ${d.deployments} deployments / ${number(d.windowDays)} days; inventory ${complete(d.coverageComplete)} |`,
      `| Change lead time | ${number(l.medianHours)} hours median | ${l.samples} commit samples; ${l.missingCommitTimes} missing times; ${l.missingCommitInventories} incomplete commit inventories; coverage ${complete(l.coverageComplete)} |`,
      `| Failed deployment recovery time | ${number(r.medianHours)} hours median | ${r.samples} recovered deployments; ${r.censoredDeployments} still open at cutoff; ${r.unknownDurationDeployments} missing duration data |`,
      `| Change fail rate | ${percent(f.ratio)} | ${f.failedDeployments} known failed / ${f.deployments} deployments; ${f.unclassifiedIncidents} unclassified incidents; coverage ${complete(f.coverageComplete)} |`,
      `| Deployment rework rate | ${percent(w.ratio)} | ${w.reworkDeployments} confirmed incident-recovery / ${w.deployments} deployments; ${w.unclassifiedDeployments} unclassified; coverage ${complete(w.coverageComplete)} |`,
      "",
      `Input: ${report.data.suppliedDeployments} delivery records; ${report.data.duplicateDeliveryRecords} duplicate records; ${report.data.excludedEnvironmentRecords} records outside this environment; ${report.data.missingDeploymentTimes} missing availability timestamps; ${report.data.relevantIncidents} relevant incidents; ${report.data.unlinkedIncidents} incidents with unknown deployment linkage; ${report.data.missingRecoveryReleaseLinks} recovered deployments missing recovery-release links.`,
      "",
      "Unknown values are not zero. Duration medians describe observed samples; open failures remain in the failure numerator and are excluded from recovery-duration samples. These records describe delivery evidence, not individual productivity.",
      "",
    ].join("\n"));
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
