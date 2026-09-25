import { createHash } from "node:crypto";
import { artifactKind, buildArtifact } from "./build-artifact.mjs";
import { assertCommitIdentity, assertUploadedAsset, describeCommitInventory, readPullRequestMetadata } from "./metadata.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

async function maybe(operation) {
  try { return (await operation()).data; }
  catch (error) { if (error.status === 404) return null; throw error; }
}

/** One immutable delivery per merged task PR. All API values are structured data. */
export async function deliverMergedPullRequest({ github, context, core, workspace = process.env.GITHUB_WORKSPACE, build = buildArtifact }) {
  const { owner, repo } = context.repo;
  const repository = { owner, repo };
  const event = context.payload;
  if (!event.pull_request?.merged || event.pull_request.base.ref !== event.repository.default_branch) {
    core.info("Only a merged task PR targeting the default branch is a delivery.");
    return null;
  }
  const pull = (await github.rest.pulls.get({ ...repository, pull_number: event.pull_request.number })).data;
  const mergeSha = pull.merge_commit_sha;
  assertCommitIdentity(mergeSha, event.pull_request.merge_commit_sha, "Merged pull request");
  if (!pull.merged || pull.base.ref !== event.repository.default_branch) throw new Error("The pull request is no longer the expected merged default-branch PR.");
  const metadata = readPullRequestMetadata(pull.body);
  const tag = `pr-${pull.number}`;
  const kind = artifactKind(workspace);
  const environment = kind === "compiler-package" ? "package-delivery" : "specification-delivery";
  const workflowUrl = `${event.repository.html_url}/actions/runs/${context.runId}`;

  const verifyTag = async () => {
    const ref = await maybe(() => github.rest.git.getRef({ ...repository, ref: `tags/${tag}` }));
    if (!ref) return false;
    let object = ref.object;
    for (let depth = 0; object.type === "tag" && depth < 8; depth += 1) {
      object = (await github.rest.git.getTag({ ...repository, tag_sha: object.sha })).data.object;
    }
    if (object.type !== "commit") throw new Error("Release tag does not resolve directly to a commit.");
    assertCommitIdentity(object.sha, mergeSha, `Existing tag ${tag}`);
    return true;
  };
  const hasTag = await verifyTag();
  let release = await maybe(() => github.rest.repos.getReleaseByTag({ ...repository, tag }));
  if (release && (!hasTag || release.tag_name !== tag)) throw new Error("Existing release has no matching immutable tag.");

  const deployments = await github.paginate(github.rest.repos.listDeployments, { ...repository, sha: mergeSha, environment, per_page: 100 });
  const matching = deployments.filter((item) => item.payload?.expec?.pullNumber === pull.number && item.payload.expec.tag === tag);
  if (matching.length > 1) throw new Error("Multiple delivery records exist for this PR; refusing to count another delivery.");
  let deployment = matching[0];
  if (deployment) assertCommitIdentity(deployment.sha, mergeSha, "Existing deployment");
  let success = deployment
    ? (await github.paginate(github.rest.repos.listDeploymentStatuses, { ...repository, deployment_id: deployment.id, per_page: 100 })).find((item) => item.state === "success")
    : null;

  const listAssets = async () => github.paginate(github.rest.repos.listReleaseAssets, { ...repository, release_id: release.id, per_page: 100 });
  const readAsset = async (asset) => {
    const response = await github.rest.repos.getReleaseAsset({ ...repository, asset_id: asset.id, headers: { accept: "application/octet-stream" } });
    const bytes = Buffer.from(response.data);
    assertUploadedAsset(asset, { size: bytes.length, sha256: digest(bytes) });
    return bytes;
  };
  if (release && success) {
    if (release.draft) throw new Error("A successful deployment cannot refer to a draft release.");
    const assets = await listAssets();
    const manifestAsset = assets.find((item) => item.name === "delivery.json");
    if (manifestAsset?.state === "uploaded") {
      const manifest = JSON.parse((await readAsset(manifestAsset)).toString("utf8"));
      assertCommitIdentity(manifest.source.mergeSha, mergeSha, "Existing delivery manifest");
      if (manifest.pullRequest.number !== pull.number || manifest.deployment.id !== deployment.id || manifest.deployment.deliveredAt !== success.created_at || manifest.artifact.kind !== kind) {
        throw new Error("Existing delivery manifest does not describe this PR and deployment.");
      }
      const asset = assets.find((item) => item.name === manifest.artifact.name);
      if (!asset) throw new Error("The delivered artifact is missing from the release.");
      assertUploadedAsset(asset, manifest.artifact);
      await readAsset(asset);
      const sums = assets.find((item) => item.name === "SHA256SUMS");
      if (!sums || (await readAsset(sums)).toString("utf8") !== `${manifest.artifact.sha256}  ${manifest.artifact.name}\n`) {
        throw new Error("The delivered artifact checksum record is missing or inconsistent.");
      }
      core.info(`Verified existing delivery ${deployment.id}; no new release or deployment was created.`);
      return manifest;
    }
    core.warning("Artifact delivery already succeeded; repairing only its missing delivery manifest.");
  }

  if (!deployment) {
    const commits = await github.paginate(github.rest.pulls.listCommits, { ...repository, pull_number: pull.number, per_page: 100 });
    const source = { mergeSha, ...describeCommitInventory(commits, pull.commits) };
    if (!source.commitsComplete) core.warning("Original PR commit inventory is incomplete; delivery metadata will expose that gap.");
    const snapshot = {
      pullRequest: { number: pull.number, url: pull.html_url, title: pull.title, createdAt: pull.created_at, mergedAt: pull.merged_at, ...metadata },
      source,
    };
    deployment = (await github.rest.repos.createDeployment({
      ...repository, ref: mergeSha, environment, auto_merge: false, required_contexts: [],
      production_environment: true, transient_environment: false,
      description: `Deliver ${tag}: ${metadata.taskIds[0]}`,
      payload: { expec: { schemaVersion: 1, pullNumber: pull.number, tag, kind, snapshot } },
    })).data;
    if (!deployment.id) throw new Error("GitHub did not create a deployment record.");
    assertCommitIdentity(deployment.sha, mergeSha, "New deployment");
  }
  const snapshot = deployment.payload?.expec?.snapshot;
  if (!snapshot || deployment.payload.expec.kind !== kind) throw new Error("Deployment lacks its original immutable metadata snapshot.");
  assertCommitIdentity(snapshot.source.mergeSha, mergeSha, "Deployment source snapshot");

  const status = async (state, extra = {}) => (await github.rest.repos.createDeploymentStatus({
    ...repository, deployment_id: deployment.id, state, auto_inactive: false,
    log_url: workflowUrl, environment, ...extra,
  })).data;
  if (!success) await status("in_progress", { description: "Building and verifying the delivery artifact." });
  try {
    const artifact = await build({ workspace, mergeSha, pullNumber: pull.number });
    if (artifact.kind !== kind || artifact.size !== artifact.bytes.length || artifact.sha256 !== digest(artifact.bytes)) throw new Error("Build result does not describe its artifact bytes.");
    if (!hasTag) await github.rest.git.createRef({ ...repository, ref: `refs/tags/${tag}`, sha: mergeSha });
    await verifyTag();
    if (!release) {
      release = (await github.rest.repos.createRelease({
        ...repository, tag_name: tag, target_commitish: mergeSha, draft: true, prerelease: kind === "compiler-package",
        name: `PR #${pull.number} — ${snapshot.pullRequest.title}`,
        body: [
          `Task: ${snapshot.pullRequest.taskIds.join(", ")}`,
          `Pull request: ${snapshot.pullRequest.url}`,
          `Merged commit: ${mergeSha}`,
          `Created: ${snapshot.pullRequest.createdAt}`,
          `Merged: ${snapshot.pullRequest.mergedAt}`,
          `Artifact: ${kind}; GitHub deployment environment: ${environment}.`,
          "Original commit timestamps and delivery evidence are recorded in delivery.json.",
        ].join("\n\n"),
      })).data;
    }
    const upload = async (name, bytes, contentType) => {
      let existing = (await listAssets()).find((item) => item.name === name);
      // GitHub may leave a zero-byte starter asset after an interrupted upload.
      // Only this incomplete state is removable; uploaded mismatches remain immutable conflicts.
      if (existing?.state === "starter") {
        await github.rest.repos.deleteReleaseAsset({ ...repository, asset_id: existing.id });
        existing = null;
      }
      const asset = existing ?? (await github.rest.repos.uploadReleaseAsset({
        ...repository, release_id: release.id, name, data: bytes,
        headers: { "content-type": contentType, "content-length": bytes.length },
      })).data;
      const verified = (await github.rest.repos.getReleaseAsset({ ...repository, asset_id: asset.id })).data;
      assertUploadedAsset(verified, { size: bytes.length, sha256: digest(bytes) });
      return verified;
    };
    const asset = await upload(artifact.name, artifact.bytes, kind === "compiler-package" ? "application/gzip" : "application/zip");
    await upload("SHA256SUMS", Buffer.from(`${artifact.sha256}  ${artifact.name}\n`), "text/plain");
    if (release.draft) release = (await github.rest.repos.updateRelease({ ...repository, release_id: release.id, draft: false })).data;
    if (release.draft) throw new Error("GitHub has not published the release.");
    await readAsset(asset);
    if (!success) {
      success = await status("success", { description: "Verified artifact is attached to its published release.", environment_url: asset.browser_download_url });
    }
    const manifest = {
      schemaVersion: 1, repository: `${owner}/${repo}`, ...snapshot,
      artifact: { kind, name: artifact.name, version: artifact.version, size: artifact.size, sha256: artifact.sha256, url: asset.browser_download_url },
      release: { id: release.id, tag, url: release.html_url },
      deployment: { id: deployment.id, environment, productionEnvironment: true, status: "success", deliveredAt: success.created_at, artifactUrl: asset.browser_download_url },
      workflow: { runId: context.runId, runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? "1"), url: workflowUrl },
    };
    await upload("delivery.json", jsonBytes(manifest), "application/json");
    core.info(`Delivered ${artifact.name} as ${tag}; deployment ${deployment.id}.`);
    return manifest;
  } catch (error) {
    // An artifact already delivered remains a real delivery if its evidence upload needs a retry.
    if (!success) {
      try {
        success = (await github.paginate(github.rest.repos.listDeploymentStatuses, { ...repository, deployment_id: deployment.id, per_page: 100 })).find((item) => item.state === "success");
      } catch (lookupError) { core.error(`Could not reconcile deployment status: ${lookupError.message}`); }
    }
    if (!success) {
      try { await status("failure", { description: "Delivery failed before a verified artifact became available." }); }
      catch (statusError) { core.error(`Could not record deployment failure: ${statusError.message}`); }
    }
    throw error;
  }
}
