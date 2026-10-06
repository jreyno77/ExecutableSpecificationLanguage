import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BuildRun {
  id: number; run_attempt: number; head_sha: string; head_branch: string; event: string;
  path: string; conclusion: string | null; head_repository: { full_name: string };
}
export interface MergedPull {
  number: number; merged_at: string | null; merge_commit_sha: string; base: { ref: string };
}
export interface Delivery { commit: string; run: number; attempt: number; pr: number; version: string }
export interface PackageEvidence { commit: string; run: number; attempt: number; artifact: string; version: string; sha256: string }
export interface Archive { artifact: string; sha256: string; name: string; version: string }

export function deliveryFor(run: BuildRun, repository: string, pulls: readonly MergedPull[], baseVersion: string): Delivery | undefined {
  if (run.conclusion !== 'success' || run.event !== 'push' || run.head_branch !== 'main'
    || run.head_repository.full_name !== repository || run.path !== '.github/workflows/ci.yml') return;
  const matching = pulls.filter(pull => pull.merged_at && pull.merge_commit_sha === run.head_sha && pull.base.ref === 'main');
  if (matching.length > 1) throw new Error('Multiple merged pull requests match the commit.');
  const pull = matching[0];
  if (pull) return { commit: run.head_sha, run: run.id, attempt: run.run_attempt, pr: pull.number,
    version: baseVersion.split('-')[0] + '-pr.' + pull.number };
}

export function verifyPackage(metadata: PackageEvidence, expected: Delivery, observed: Archive): void {
  if (metadata.commit !== expected.commit) throw new Error('Package commit differs from the verified main commit.');
  if (metadata.run !== expected.run) throw new Error('Package run differs from the verified main run.');
  if (!Number.isInteger(metadata.attempt) || metadata.attempt < 1 || metadata.attempt > expected.attempt)
    throw new Error('Package attempt is not a successful producer from this run.');
  if (metadata.version !== expected.version || observed.version !== expected.version) throw new Error('Package version differs.');
  if (observed.name !== 'executable-specification-language') throw new Error('Package name differs.');
  if (metadata.artifact !== 'executable-specification-language-' + expected.version + '.tgz'
    || observed.artifact !== metadata.artifact) throw new Error('Package filename differs.');
  if (metadata.sha256 !== observed.sha256) throw new Error('Package digest differs from the tested bytes.');
}

export function inspectArchive(directory: string): Archive {
  const files = readdirSync(directory).filter(file => file.endsWith('.tgz'));
  if (files.length !== 1) throw new Error('Expected one package archive.');
  const path = join(directory, files[0]!);
  const manifest = JSON.parse(execFileSync('tar', ['-xzOf', path, 'package/package.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
  return { artifact: basename(path), sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    name: manifest.name, version: manifest.version };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [command, directory] = process.argv.slice(2);
  if (!directory || !['record', 'verify'].includes(command!)) throw new Error('Use record|verify with a package directory.');
  const expected: Delivery = { commit: process.env.MERGE_SHA!, run: Number(process.env.BUILD_RUN),
    attempt: Number(process.env.BUILD_ATTEMPT), pr: Number(process.env.PR_NUMBER), version: process.env.PACKAGE_VERSION! };
  if (!/^[a-f0-9]{40}$/.test(expected.commit ?? '') || !Number.isInteger(expected.run) || expected.run < 1
    || !Number.isInteger(expected.attempt) || expected.attempt < 1 || !Number.isInteger(expected.pr) || expected.pr < 1
    || !expected.version?.endsWith('-pr.' + expected.pr)) throw new Error('Missing trusted delivery context.');
  const observed = inspectArchive(directory), metadata = join(directory, 'provenance.json');
  if (command === 'record') {
    const evidence = { commit: expected.commit, run: expected.run, attempt: expected.attempt,
      artifact: observed.artifact, version: observed.version, sha256: observed.sha256 };
    verifyPackage(evidence, expected, observed);
    writeFileSync(metadata, JSON.stringify(evidence, null, 2) + '\n');
  } else verifyPackage(JSON.parse(readFileSync(metadata, 'utf8')), expected, observed);
}