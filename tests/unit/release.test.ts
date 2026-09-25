import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { deliverMergedPullRequest } from "../../scripts/release/deliver.mjs";
import {
  readPullRequestMetadata,
  assertCommitIdentity,
  assertUploadedAsset,
  describeCommitInventory,
} from "../../scripts/release/metadata.mjs";

describe("release metadata and immutable delivery guards", () => {
  it("requires an explicit task and keeps missing delivery classification unknown", () => {
    expect(readPullRequestMetadata("Notion-task: CORE-18\n")).toEqual({
      taskIds: ["CORE-18"], deliveryKind: null, incidentNumbers: [],
    });
    expect(() => readPullRequestMetadata("Related work: CORE-18")).toThrow("Notion-task");
  });

  it("reads deliberate planned or incident-recovery classifications", () => {
    expect(readPullRequestMetadata("Notion-task: CORE-01\nDelivery-kind: planned\nIncidents: none").deliveryKind).toBe("planned");
    expect(readPullRequestMetadata("Notion-task: PROJECT-11\nDelivery-kind: incident-recovery\nIncidents: #12, #34")).toEqual({
      taskIds: ["PROJECT-11"], deliveryKind: "incident-recovery", incidentNumbers: [12, 34],
    });
  });

  it("rejects ambiguous or fabricated classifications", () => {
    expect(() => readPullRequestMetadata("Notion-task: CORE-18\nDelivery-kind: maybe")).toThrow("Delivery-kind");
    expect(() => readPullRequestMetadata("Notion-task: CORE-18\nDelivery-kind: incident-recovery")).toThrow("incident");
    expect(() => readPullRequestMetadata("Notion-task: CORE-18\nNotion-task: CORE-01")).toThrow("Notion-task");
  });

  it("permits an identical rerun but refuses to move an existing tag", () => {
    const sha = "a".repeat(40);
    expect(() => assertCommitIdentity(sha, sha, "tag pr-2")).not.toThrow();
    expect(() => assertCommitIdentity("b".repeat(40), sha, "tag pr-2")).toThrow("different commit");
    expect(() => assertCommitIdentity("a".repeat(7), sha, "tag pr-2")).toThrow("full commit");
  });

  it("requires an uploaded asset with matching size and SHA-256", () => {
    const digest = "d".repeat(64);
    const asset = { state: "uploaded", size: 123, digest: `sha256:${digest}`, browser_download_url: "https://github.com/o/r/releases/download/pr-2/package.tgz" };
    expect(() => assertUploadedAsset(asset, { size: 123, sha256: digest })).not.toThrow();
    expect(() => assertUploadedAsset({ ...asset, state: "starter" }, { size: 123, sha256: digest })).toThrow("uploaded");
    expect(() => assertUploadedAsset(asset, { size: 124, sha256: digest })).toThrow("size");
    expect(() => assertUploadedAsset({ ...asset, digest: `sha256:${"e".repeat(64)}` }, { size: 123, sha256: digest })).toThrow("digest");
  });

  it("exposes incomplete commit inventories and missing timestamps", () => {
    const commits = [{ sha: "a".repeat(40), html_url: "https://github.com/o/r/commit/a", commit: { author: { date: "2026-09-25T01:00:00Z" }, committer: { date: null } } }];
    expect(describeCommitInventory(commits, 2)).toEqual({
      commitsComplete: false, expectedCommitCount: 2, observedCommitCount: 1,
      commits: [{ sha: "a".repeat(40), url: "https://github.com/o/r/commit/a", authoredAt: "2026-09-25T01:00:00Z", committedAt: null }],
    });
  });
});

function deliveryFixture() {
  const sha = "a".repeat(40);
  const bytes = Buffer.from("verified compiler package fixture");
  const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
  type Asset = { id: number; name: string; state: string; size: number; digest: string; browser_download_url: string; bytes: Buffer };
  type Deployment = { id: number; sha: string; payload: unknown };
  type Status = { state: string; created_at: string };
  const assets: Asset[] = [];
  const deployments: Deployment[] = [];
  const statuses: Status[] = [];
  const calls: string[] = [];
  const controls = { failAssetOnce: "", downloadFails: false, keepDraft: false };
  let tag: { object: { type: string; sha: string } } | null = null;
  let release: { id: number; tag_name: string; draft: boolean; html_url: string } | null = null;
  const notFound = () => { throw Object.assign(new Error("Not found"), { status: 404 }); };
  const context = {
    repo: { owner: "owner", repo: "repo" }, runId: 10,
    payload: {
      pull_request: { merged: true, number: 2, merge_commit_sha: sha, base: { ref: "main" } },
      repository: { default_branch: "main", html_url: "https://github.com/owner/repo" },
    },
  };
  const github = {
    // API boundary fake: behavior assertions below concern delivery side effects and ordering.
    async paginate(operation: Function, parameters: unknown) { return (await operation(parameters)).data; },
    rest: {
      pulls: {
        async get() { return { data: { ...context.payload.pull_request, body: "Notion-task: CORE-18\nDelivery-kind: planned", title: "Compiler", commits: 1, html_url: "https://github.com/owner/repo/pull/2", created_at: "2026-09-25T01:00:00Z", merged_at: "2026-09-25T02:00:00Z" } }; },
        async listCommits() { return { data: [{ sha, html_url: "https://github.com/owner/repo/commit/a", commit: { author: { date: "2026-09-25T01:00:00Z" }, committer: { date: "2026-09-25T01:01:00Z" } } }] }; },
      },
      git: {
        async getRef() { return { data: tag ?? notFound() }; },
        async getTag() { return notFound(); },
        async createRef(input: { sha: string }) { tag = { object: { type: "commit", sha: input.sha } }; return { data: tag }; },
      },
      repos: {
        async getReleaseByTag() { return { data: release ?? notFound() }; },
        async listDeployments() { return { data: deployments }; },
        async listDeploymentStatuses() { return { data: [...statuses].reverse() }; },
        async createDeployment(input: { ref: string; payload: unknown }) {
          calls.push("deployment:create");
          const result = { id: 1, sha: input.ref, payload: input.payload };
          deployments.push(result); return { data: result };
        },
        async createDeploymentStatus(input: { state: string }) {
          calls.push(`status:${input.state}`);
          const result = { state: input.state, created_at: "2026-09-25T03:00:00Z" };
          statuses.push(result); return { data: result };
        },
        async createRelease(input: { tag_name: string; draft: boolean }) {
          calls.push("release:create");
          release = { id: 1, tag_name: input.tag_name, draft: input.draft, html_url: "https://github.com/owner/repo/releases/tag/pr-2" };
          return { data: release };
        },
        async updateRelease(input: { draft: boolean }) {
          if (!release) return notFound();
          calls.push("release:publish");
          if (!controls.keepDraft) release.draft = input.draft;
          return { data: release };
        },
        async listReleaseAssets() { return { data: assets }; },
        async uploadReleaseAsset(input: { name: string; data: Buffer }) {
          calls.push(`upload:${input.name}`);
          const asset = { id: assets.reduce((largest, item) => Math.max(largest, item.id), 0) + 1, name: input.name, state: "uploaded", size: input.data.length, digest: `sha256:${hash(input.data)}`, browser_download_url: `https://github.com/owner/repo/releases/download/pr-2/${input.name}`, bytes: input.data };
          assets.push(asset);
          if (controls.failAssetOnce === input.name) { controls.failAssetOnce = ""; asset.state = "starter"; throw new Error("Upload interrupted"); }
          return { data: asset };
        },
        async getReleaseAsset(input: { asset_id: number; headers?: unknown }) {
          const asset = assets.find((item) => item.id === input.asset_id) ?? notFound();
          if (input.headers) {
            calls.push(`download:${asset.name}`);
            if (controls.downloadFails && asset.name.endsWith(".tgz")) throw new Error("Artifact unavailable");
            return { data: asset.bytes };
          }
          return { data: asset };
        },
        async deleteReleaseAsset(input: { asset_id: number }) {
          const index = assets.findIndex((item) => item.id === input.asset_id);
          const asset = assets[index];
          if (!asset) return notFound();
          calls.push(`delete:${asset.name}`); assets.splice(index, 1); return { data: undefined };
        },
      },
    },
  };
  const build = vi.fn(async () => ({ kind: "compiler-package" as const, name: "compiler.tgz", version: "0.1.0-pr.2", bytes, size: bytes.length, sha256: hash(bytes) }));
  const deliver = () => deliverMergedPullRequest({ github, context, core: { info: vi.fn(), warning: vi.fn(), error: vi.fn() }, workspace: process.cwd(), build });
  return { deliver, build, github, context, controls, calls, assets, deployments, statuses };
}

describe("merged task delivery", () => {
  it("observes artifact availability before success and reuses a complete delivery", async () => {
    const fixture = deliveryFixture();
    const initial = await fixture.deliver();
    expect(fixture.calls.indexOf("download:compiler.tgz")).toBeGreaterThanOrEqual(0);
    expect(fixture.calls.indexOf("download:compiler.tgz")).toBeLessThan(fixture.calls.indexOf("status:success"));
    expect(await fixture.deliver()).toEqual(initial);
    expect(fixture.build).toHaveBeenCalledTimes(1);
    expect(fixture.deployments).toHaveLength(1);
    expect(fixture.statuses.filter((item) => item.state === "success")).toHaveLength(1);
    expect(fixture.calls.filter((item) => item === "release:create")).toHaveLength(1);
  });

  it("does not deliver a stacked PR merged into a temporary branch", async () => {
    const fixture = deliveryFixture();
    fixture.context.payload.pull_request.base.ref = "codex/grammar";
    expect(await fixture.deliver()).toBeNull();
    expect(fixture.build).not.toHaveBeenCalled();
    expect(fixture.deployments).toHaveLength(0);
  });

  it("records a failed build without publishing an artifact or claiming success", async () => {
    const fixture = deliveryFixture();
    fixture.build.mockRejectedValueOnce(new Error("Compiler tests failed"));
    await expect(fixture.deliver()).rejects.toThrow("Compiler tests failed");
    expect(fixture.statuses.map((item) => item.state)).toEqual(["in_progress", "failure"]);
    expect(fixture.assets).toHaveLength(0);
    expect(fixture.calls).not.toContain("release:create");
  });

  it("does not claim success for an unavailable artifact or an unpublished release", async () => {
    for (const control of ["downloadFails", "keepDraft"] as const) {
      const fixture = deliveryFixture();
      fixture.controls[control] = true;
      await expect(fixture.deliver()).rejects.toThrow();
      expect(fixture.statuses.some((item) => item.state === "success")).toBe(false);
      expect(fixture.statuses.at(-1)?.state).toBe("failure");
    }
  });

  it("retries a starter artifact upload without duplicating deployment records", async () => {
    const fixture = deliveryFixture();
    fixture.controls.failAssetOnce = "compiler.tgz";
    await expect(fixture.deliver()).rejects.toThrow("Upload interrupted");
    await fixture.deliver();
    expect(fixture.calls).toContain("delete:compiler.tgz");
    expect(fixture.deployments).toHaveLength(1);
    expect(fixture.statuses.filter((item) => item.state === "success")).toHaveLength(1);
  });

  it("repairs a starter manifest without counting the real artifact delivery twice", async () => {
    const fixture = deliveryFixture();
    fixture.controls.failAssetOnce = "delivery.json";
    await expect(fixture.deliver()).rejects.toThrow("Upload interrupted");
    const originalSuccess = fixture.statuses.find((item) => item.state === "success");
    expect(originalSuccess).toBeDefined();
    await fixture.deliver();
    expect(fixture.calls).toContain("delete:delivery.json");
    expect(fixture.statuses.filter((item) => item.state === "success")).toEqual([originalSuccess]);
    expect(fixture.statuses.some((item) => item.state === "failure")).toBe(false);
  });

  it("refuses to overwrite an uploaded artifact whose digest has changed", async () => {
    const fixture = deliveryFixture();
    await fixture.deliver();
    const artifact = fixture.assets.find((item) => item.name === "compiler.tgz");
    if (!artifact) throw new Error("Missing test artifact");
    artifact.digest = `sha256:${"f".repeat(64)}`;
    await expect(fixture.deliver()).rejects.toThrow("digest");
    expect(fixture.calls).not.toContain("delete:compiler.tgz");
  });
});
