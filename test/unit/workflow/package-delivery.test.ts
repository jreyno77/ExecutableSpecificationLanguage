import { describe, expect, it } from 'vitest';
import { deliveryFor, verifyPackage } from '../../../.github/ci/package-delivery.js';

const commit = 'a'.repeat(40), repository = 'jreyno77/ExecutableSpecificationLanguage';
const run = { id: 900, run_attempt: 1, head_sha: commit, head_branch: 'main', event: 'push',
  path: '.github/workflows/ci.yml', conclusion: 'success', head_repository: { full_name: repository } };
const pull = { number: 53, merged_at: '2026-10-06T05:00:00Z', merge_commit_sha: commit, base: { ref: 'main' } };
const expected = { commit, run: 900, attempt: 1, pr: 53, version: '0.1.0-pr.53' };
const artifact = 'executable-specification-language-0.1.0-pr.53.tgz', digest = 'b'.repeat(64);
const metadata = { commit, run: 900, attempt: 1, artifact, version: '0.1.0-pr.53', sha256: digest };
const observed = { artifact, sha256: digest, name: 'executable-specification-language', version: '0.1.0-pr.53' };

describe('delivery from a completed main build', () => {
  it('identifies the exact merged task and its tested version', () => {
    expect(deliveryFor(run, repository, [pull], '0.1.0')).toEqual(expected);
  });
  it('does not publish a failed build', () => {
    expect(deliveryFor({ ...run, conclusion: 'failure' }, repository, [pull], '0.1.0')).toBeUndefined();
  });
  it('does not publish partial pull request checks', () => {
    expect(deliveryFor({ ...run, event: 'pull_request' }, repository, [pull], '0.1.0')).toBeUndefined();
  });
  it('does not publish another repository, branch or workflow', () => {
    expect(deliveryFor({ ...run, head_repository: { full_name: 'another/repository' } }, repository, [pull], '0.1.0')).toBeUndefined();
    expect(deliveryFor({ ...run, head_branch: 'feature' }, repository, [pull], '0.1.0')).toBeUndefined();
    expect(deliveryFor({ ...run, path: '.github/workflows/other.yml' }, repository, [pull], '0.1.0')).toBeUndefined();
  });
  it('does not create a task release for a direct push', () => {
    expect(deliveryFor(run, repository, [], '0.1.0')).toBeUndefined();
  });
  it('ignores associated PRs that did not merge this commit into main', () => {
    expect(deliveryFor(run, repository, [{ ...pull, merged_at: null }], '0.1.0')).toBeUndefined();
    expect(deliveryFor(run, repository, [{ ...pull, merge_commit_sha: 'c'.repeat(40) }], '0.1.0')).toBeUndefined();
    expect(deliveryFor(run, repository, [{ ...pull, base: { ref: 'feature' } }], '0.1.0')).toBeUndefined();
  });
  it('requires an unambiguous task release', () => {
    expect(() => deliveryFor(run, repository, [pull, { ...pull, number: 54 }], '0.1.0')).toThrow('Multiple');
  });
});

describe('the archive verified by main', () => {
  it('accepts the tested package evidence and observed bytes', () => {
    expect(() => verifyPackage(metadata, expected, observed)).not.toThrow();
  });
  it('rejects another producer commit even if its tree was identical', () => {
    expect(() => verifyPackage({ ...metadata, commit: 'c'.repeat(40) }, expected, observed)).toThrow('commit');
  });
  it('rejects evidence from another run', () => {
    expect(() => verifyPackage({ ...metadata, run: 901 }, expected, observed)).toThrow('run');
  });
  it('reuses a successful package producer after failed checks are rerun', () => {
    expect(() => verifyPackage(metadata, { ...expected, attempt: 2 }, observed)).not.toThrow();
  });
  it('rejects future or invalid producing attempts', () => {
    expect(() => verifyPackage({ ...metadata, attempt: 2 }, expected, observed)).toThrow('attempt');
    expect(() => verifyPackage({ ...metadata, attempt: 0 }, expected, observed)).toThrow('attempt');
    expect(() => verifyPackage({ ...metadata, attempt: 1.5 }, expected, observed)).toThrow('attempt');
  });
  it('rejects changed archive bytes', () => {
    expect(() => verifyPackage(metadata, expected, { ...observed, sha256: 'c'.repeat(64) })).toThrow('digest');
  });
  it('rejects a different package or version', () => {
    expect(() => verifyPackage({ ...metadata, version: '0.1.0' }, expected, observed)).toThrow('version');
    expect(() => verifyPackage(metadata, expected, { ...observed, version: '0.1.0' })).toThrow('version');
    expect(() => verifyPackage(metadata, expected, { ...observed, name: 'another-package' })).toThrow('name');
  });
  it('requires exactly the expected safe archive filename', () => {
    expect(() => verifyPackage({ ...metadata, artifact: '../' + artifact }, expected, observed)).toThrow('filename');
    expect(() => verifyPackage(metadata, expected, { ...observed, artifact: 'other.tgz' })).toThrow('filename');
  });
});