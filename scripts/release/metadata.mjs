/** Deliberate PR metadata only; missing classification remains unknown. */
export function readPullRequestMetadata(body) {
  const lines = String(body ?? "").split(/\r?\n/);
  const values = (key) => lines.flatMap((line) => {
    const match = line.match(new RegExp(`^${key}:\\s*(.*?)\\s*$`, "i"));
    return match ? [match[1]] : [];
  });
  const tasks = values("Notion-task");
  if (tasks.length !== 1 || !/^(CORE|PROJECT|OUT)-\d+$/.test(tasks[0])) {
    throw new Error("Provide exactly one Notion-task: CORE-01 (or PROJECT-/OUT-) line.");
  }
  const kinds = values("Delivery-kind");
  if (kinds.length > 1 || (kinds.length === 1 && !["planned", "incident-recovery"].includes(kinds[0]))) {
    throw new Error("Delivery-kind must be a single explicit planned or incident-recovery value.");
  }
  const incidentLines = values("Incidents");
  if (incidentLines.length > 1) throw new Error("Provide a single Incidents line.");
  const raw = incidentLines[0] ?? "";
  if (raw && raw !== "none" && !/^#\d+(?:\s*,\s*#\d+)*$/.test(raw)) {
    throw new Error("Incidents must be none or comma-separated issue numbers such as #12, #34.");
  }
  const incidentNumbers = [...new Set([...raw.matchAll(/#(\d+)/g)].map((match) => Number(match[1])))];
  if (incidentNumbers.some((number) => !Number.isSafeInteger(number) || number <= 0)) {
    throw new Error("Incident numbers must be positive integers.");
  }
  const deliveryKind = kinds[0] ?? null;
  if (deliveryKind === "incident-recovery" && incidentNumbers.length === 0) {
    throw new Error("An incident-recovery delivery must identify at least one incident.");
  }
  return { taskIds: tasks, deliveryKind, incidentNumbers };
}

export function assertCommitIdentity(actual, expected, label) {
  if (!/^[a-f0-9]{40}$/.test(actual) || !/^[a-f0-9]{40}$/.test(expected)) {
    throw new Error(`${label} must identify a full commit SHA.`);
  }
  if (actual !== expected) throw new Error(`${label} points to a different commit; refusing to overwrite it.`);
}

export function assertUploadedAsset(asset, expected) {
  if (asset.state !== "uploaded") throw new Error("Release asset is not uploaded.");
  if (asset.size !== expected.size) throw new Error("Release asset size does not match the verified bytes.");
  if (asset.digest !== `sha256:${expected.sha256}`) throw new Error("Release asset digest does not match the verified bytes.");
  if (!asset.browser_download_url?.startsWith("https://")) throw new Error("Release asset has no HTTPS download URL.");
}

export function describeCommitInventory(commits, expectedCommitCount) {
  const observedCommitCount = commits.length;
  const uniqueCount = new Set(commits.map((item) => item.sha)).size;
  return {
    commitsComplete: observedCommitCount === expectedCommitCount && uniqueCount === observedCommitCount,
    expectedCommitCount,
    observedCommitCount,
    commits: commits.map((item) => ({
      sha: item.sha,
      url: item.html_url,
      authoredAt: item.commit.author?.date ?? null,
      committedAt: item.commit.committer?.date ?? null,
    })),
  };
}
