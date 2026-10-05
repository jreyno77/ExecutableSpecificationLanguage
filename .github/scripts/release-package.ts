import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

export interface DeliveryRun {
  id: number;
  run_attempt: number;
  path: string;
  status: string;
  conclusion: string | null;
  event: string;
  head_branch: string;
  head_sha: string;
  head_repository: { full_name: string } | null;
}
export interface MergedPullRequest {
  number: number;
  html_url: string;
  merged_at: string | null;
  merge_commit_sha: string | null;
  base: { ref: string; repo: { full_name: string } | null };
}
export interface DeliverySource {
  commit: string;
  run: number;
  attempt: number;
  pullRequest: number;
}

export function releasePullRequest(run: DeliveryRun, pullRequests: MergedPullRequest[], repository: string): MergedPullRequest | undefined {
  if (run.status !== 'completed' || run.conclusion !== 'success' || run.event !== 'push' ||
      run.head_branch !== 'main' || run.head_repository?.full_name !== repository ||
      run.path !== '.github/workflows/ci.yml') return undefined;
  const matching = pullRequests.filter(pullRequest =>
    pullRequest.merged_at && pullRequest.merge_commit_sha === run.head_sha &&
    pullRequest.base.ref === 'main' && pullRequest.base.repo?.full_name === repository);
  if (matching.length > 1) throw new Error('Multiple merged pull requests match the source commit.');
  return matching[0];
}

export async function verifyReleasePackage(directory: string, source: DeliverySource): Promise<{ artifact: string; version: string }> {
  const delivery = JSON.parse(await readFile(join(directory, 'delivery.json'), 'utf8'));
  if (delivery.commit !== source.commit) throw new Error('Delivered source commit differs from the verified run.');
  if (delivery.run !== source.run) throw new Error('Delivered workflow run differs from the verified run.');
  // Retrying failed jobs keeps artifacts from producers that already succeeded in this run.
  if (!Number.isSafeInteger(delivery.attempt) || delivery.attempt < 1 || delivery.attempt > source.attempt) {
    throw new Error('Delivered run attempt is not valid for the successful validating attempt.');
  }
  if (delivery.platform !== 'linux') throw new Error('Release requires the verified Linux package.');
  if (typeof delivery.version !== 'string' ||
      !/^\d+\.\d+\.\d+-pr\.[1-9]\d*$/.test(delivery.version) ||
      !delivery.version.endsWith(`-pr.${source.pullRequest}`)) {
    throw new Error('Delivered PR version differs from the merged pull request.');
  }
  const artifact = `executable-specification-language-${delivery.version}.tgz`;
  if (delivery.artifact !== artifact) throw new Error('Delivered artifact name differs from the product and PR version.');
  const archive = join(directory, artifact);
  if (!(await lstat(archive)).isFile()) throw new Error('Delivered artifact must be an ordinary package file.');
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
  if (delivery.sha256 !== digest) throw new Error('Delivered package digest differs from the verified artifact.');
  const { stdout } = await promisify(execFile)('tar', ['-xOf', archive, 'package/package.json'], {
    windowsHide: true, maxBuffer: 1024 * 1024,
  });
  const manifest = JSON.parse(stdout);
  if (manifest.name !== 'executable-specification-language' || manifest.version !== delivery.version) {
    throw new Error('Delivered package manifest differs from the product and PR version.');
  }
  return { artifact, version: delivery.version };
}
