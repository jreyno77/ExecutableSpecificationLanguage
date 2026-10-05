import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  releasePullRequest, verifyReleasePackage,
  type DeliveryRun, type MergedPullRequest,
} from '../../.github/scripts/release-package.js';

const repository = 'jreyno77/ExecutableSpecificationLanguage';
const commit = '1111111111111111111111111111111111111111';
const otherCommit = '2222222222222222222222222222222222222222';
const source = { commit, run: 907, attempt: 2, pullRequest: 42 };
const successfulMainRun: DeliveryRun = {
  id: 907, run_attempt: 2, path: '.github/workflows/ci.yml', status: 'completed',
  conclusion: 'success', event: 'push', head_branch: 'main', head_sha: commit,
  head_repository: { full_name: repository },
};

function mergedPullRequest(number = 42, sha = commit): MergedPullRequest {
  return { number, html_url: `https://github.com/${repository}/pull/${number}`,
    merged_at: '2026-10-05T12:00:00Z', merge_commit_sha: sha,
    base: { ref: 'main', repo: { full_name: repository } } };
}

async function packageDelivery(
  metadata: Record<string, unknown> = {},
  manifest: Record<string, unknown> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'expec-release-test-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'package'));
  await writeFile(join(directory, 'package', 'package.json'), JSON.stringify({
    name: 'executable-specification-language', version: '0.1.0-pr.42', ...manifest,
  }));
  const archive = join(directory, 'executable-specification-language-0.1.0-pr.42.tgz');
  await promisify(execFile)('tar', ['-czf', archive, '-C', directory, 'package/package.json'], { windowsHide: true });
  const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(join(directory, 'delivery.json'), JSON.stringify({
    artifact: 'executable-specification-language-0.1.0-pr.42.tgz',
    version: '0.1.0-pr.42', sha256, commit, run: 907, attempt: 2, platform: 'linux', ...metadata,
  }));
  return {
    directory,
    replaceArchive: (contents: string) => writeFile(archive, contents),
    removeArchive: () => rm(archive),
  };
}

describe('release source', () => {
  it('selects the merged pull request for the successful main run', () => {
    expect(releasePullRequest(successfulMainRun, [mergedPullRequest()], repository)?.number).toBe(42);
  });

  it('ignores a direct push with no merged pull request', () => {
    expect(releasePullRequest(successfulMainRun, [], repository)).toBeUndefined();
  });

  it('ignores a pull request whose merge commit differs from the run', () => {
    expect(releasePullRequest(successfulMainRun, [mergedPullRequest(42, otherCommit)], repository)).toBeUndefined();
  });

  it('ignores an unmerged pull request associated with the commit', () => {
    const pullRequest = { ...mergedPullRequest(), merged_at: null };
    expect(releasePullRequest(successfulMainRun, [pullRequest], repository)).toBeUndefined();
  });

  it('ignores pull requests merged into a different branch', () => {
    const pullRequest = { ...mergedPullRequest(), base: { ref: 'feature', repo: { full_name: repository } } };
    expect(releasePullRequest(successfulMainRun, [pullRequest], repository)).toBeUndefined();
  });

  it('ignores a pull request run even when its commit has since merged', () => {
    const run = { ...successfulMainRun, event: 'pull_request' };
    expect(releasePullRequest(run, [mergedPullRequest()], repository)).toBeUndefined();
  });

  it('ignores a failed main run', () => {
    const run = { ...successfulMainRun, conclusion: 'failure' };
    expect(releasePullRequest(run, [mergedPullRequest()], repository)).toBeUndefined();
  });

  it('ignores a main run that has not completed', () => {
    const run = { ...successfulMainRun, status: 'in_progress' };
    expect(releasePullRequest(run, [mergedPullRequest()], repository)).toBeUndefined();
  });

  it('ignores a successful feature branch run', () => {
    const run = { ...successfulMainRun, head_branch: 'feature' };
    expect(releasePullRequest(run, [mergedPullRequest()], repository)).toBeUndefined();
  });

  it('ignores a successful run in a fork', () => {
    const run = { ...successfulMainRun, head_repository: { full_name: 'someone/fork' } };
    expect(releasePullRequest(run, [mergedPullRequest()], repository)).toBeUndefined();
  });

  it('ignores a different workflow with the same display name', () => {
    const run = { ...successfulMainRun, path: '.github/workflows/other.yml' };
    expect(releasePullRequest(run, [mergedPullRequest()], repository)).toBeUndefined();
  });

  it('rejects ambiguous merged pull request provenance', () => {
    expect(() => releasePullRequest(successfulMainRun, [mergedPullRequest(42), mergedPullRequest(43)], repository))
      .toThrow('Multiple merged pull requests');
  });
});

describe('verified release package', () => {
  it('returns the exact PR package from the verified source run and attempt', async () => {
    const delivery = await packageDelivery();
    expect(await verifyReleasePackage(delivery.directory, source)).toEqual({
      artifact: 'executable-specification-language-0.1.0-pr.42.tgz', version: '0.1.0-pr.42',
    });
  });

  it('rejects a package from a different source commit', async () => {
    const delivery = await packageDelivery({ commit: otherCommit });
    await expect(verifyReleasePackage(delivery.directory, source)).rejects.toThrow('source commit');
  });

  it('rejects a package from a different workflow run', async () => {
    const delivery = await packageDelivery({ run: 906 });
    await expect(verifyReleasePackage(delivery.directory, source)).rejects.toThrow('workflow run');
  });

  it('releases the retained package when failed jobs pass on a later attempt of the same run', async () => {
    const delivery = await packageDelivery({ run: 907, attempt: 1 });
    const successfulRetry = { ...source, run: 907, attempt: 2 };
    expect(await verifyReleasePackage(delivery.directory, successfulRetry)).toEqual({
      artifact: 'executable-specification-language-0.1.0-pr.42.tgz', version: '0.1.0-pr.42',
    });
  });

  it('rejects a package produced after the successful validating attempt', async () => {
    const delivery = await packageDelivery({ attempt: 3 });
    await expect(verifyReleasePackage(delivery.directory, source)).rejects.toThrow('run attempt');
  });

  it('rejects a producer attempt below one', async () => {
    const delivery = await packageDelivery({ attempt: 0 });
    await expect(verifyReleasePackage(delivery.directory, source)).rejects.toThrow('run attempt');
  });

  it('rejects a fractional producer attempt', async () => {
    const delivery = await packageDelivery({ attempt: 1.5 });
    await expect(verifyReleasePackage(delivery.directory, source)).rejects.toThrow('run attempt');
  });

  it('rejects a producer attempt represented as text', async () => {
    const delivery = await packageDelivery({ attempt: '1' });
    await expect(verifyReleasePackage(delivery.directory, source)).rejects.toThrow('run attempt');
  });

  it('rejects a package built on another platform', async () => {
    const delivery = await packageDelivery({ platform: 'win32' });
    await expect(verifyReleasePackage(delivery.directory, source)).rejects.toThrow('Linux');
  });

  it('rejects bytes changed after verification', async () => {
    const delivery = await packageDelivery();
    await delivery.replaceArchive('changed bytes');
    await expect(verifyReleasePackage(delivery.directory, source)).rejects.toThrow('digest');
  });

  it('rejects a missing package', async () => {
    const delivery = await packageDelivery();
    await delivery.removeArchive();
    await expect(verifyReleasePackage(delivery.directory, source)).rejects.toThrow();
  });

  it('rejects a package for a different pull request', async () => {
    const delivery = await packageDelivery({ version: '0.1.0-pr.43' });
    await expect(verifyReleasePackage(delivery.directory, source)).rejects.toThrow('PR version');
  });

  it('rejects an archive name that differs from the product and version', async () => {
    const delivery = await packageDelivery({ artifact: 'another-product-0.1.0-pr.42.tgz' });
    await expect(verifyReleasePackage(delivery.directory, source)).rejects.toThrow('artifact name');
  });

  it('rejects an archive path outside the downloaded artifact', async () => {
    const delivery = await packageDelivery({ artifact: '../executable-specification-language-0.1.0-pr.42.tgz' });
    await expect(verifyReleasePackage(delivery.directory, source)).rejects.toThrow('artifact name');
  });

  it('rejects a package whose actual manifest has another version', async () => {
    const delivery = await packageDelivery({}, { version: '0.1.0' });
    await expect(verifyReleasePackage(delivery.directory, source)).rejects.toThrow('package manifest');
  });

  it('rejects a package whose actual manifest names another product', async () => {
    const delivery = await packageDelivery({}, { name: 'another-product' });
    await expect(verifyReleasePackage(delivery.directory, source)).rejects.toThrow('package manifest');
  });
});
