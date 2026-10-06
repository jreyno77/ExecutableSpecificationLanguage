type GitHub = {
  request(route: string, parameters: Record<string, unknown>): Promise<{ data: unknown }>;
  paginate(route: string, parameters: Record<string, unknown>): Promise<unknown[]>;
};
type Run = {
  id: number; run_attempt: number; head_sha: string; head_branch: string; event: string;
  name: string; path: string; status: string; conclusion: string | null;
  head_repository: { full_name: string }; html_url: string; run_started_at?: string | null;
};
type Job = {
  id: number; run_id: number; head_sha: string; name: string; status: string; conclusion: string | null;
  html_url: string; started_at: string | null; completed_at: string | null;
};
type Authored = { body: string | null; user: { login: string; type: string } };
type Issue = Authored & {
  number: number; state: string; state_reason?: string | null; pull_request?: object;
  labels: (string | { name?: string })[];
};
type Evidence = {
  run_id: number; run_attempt: number; head_sha: string; workflow: string; branch: string;
  run_url: string; conclusion: string; run_started_at: string | null; jobs: Job[];
  last_job_completed_at: string | null; run_completed_at: null; actual_recovery_at: null;
};
type Recovery = Evidence & {
  issue: number; covered_attempt: number; fix_sha: string; actor: string; rationale: string;
};
type Location = { owner: string; repo: string };
const label = 'main-build-failure';
const failed = (conclusion: string | null) => conclusion === 'failure' || conclusion === 'timed_out';
const integer = (value: number) => Number.isSafeInteger(value) && value > 0;
const sha = (value: string) => /^[a-f0-9]{40}$/i.test(value);
const trusted = (item: Authored) => item.user?.login === 'github-actions[bot]' && item.user.type === 'Bot';
const runMarker = (repository: string, id: number) => '<!-- expec-main-build-run ' + repository + '#' + id + ' -->';
const text = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('|', '&#124;').replaceAll('\n', ' ');
const timestamp = (value: string | null | undefined) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;

function location(repository: string): Location {
  const parts = repository.split('/');
  if (parts.length !== 2 || !parts.every(part => /^[\w.-]+$/.test(part))) throw new Error('Expected owner/repository.');
  return { owner: parts[0]!, repo: parts[1]! };
}
async function request<T>(github: GitHub, route: string, parameters: Record<string, unknown>): Promise<T> {
  return (await github.request(route, parameters)).data as T;
}
function main(run: Run, repository: string): boolean {
  return run?.head_repository?.full_name === repository && run.head_branch === 'main' && run.event === 'push'
    && run.path === '.github/workflows/ci.yml' && run.name === 'Build and test' && run.status === 'completed';
}
async function exactAttempt(github: GitHub, repository: string, id: number, attempt: number): Promise<Run> {
  if (!integer(id) || !integer(attempt)) throw new Error('A valid run ID and attempt are required.');
  const run = await request<Run>(github, 'GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}',
    { ...location(repository), run_id: id, attempt_number: attempt });
  if (run.id !== id || run.run_attempt !== attempt || !sha(run.head_sha) || !main(run, repository))
    throw new Error('Run attempt does not identify a completed main build.');
  return run;
}
async function evidence(github: GitHub, repository: string, run: Run): Promise<Evidence> {
  const jobs = await github.paginate('GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs',
    { ...location(repository), run_id: run.id, attempt_number: run.run_attempt, per_page: 100 }) as Job[];
  if (new Set(jobs.map(job => job.id)).size !== jobs.length || jobs.some(job =>
    !integer(job.id) || job.run_id !== run.id || job.head_sha !== run.head_sha || job.status !== 'completed'))
    throw new Error('Job evidence does not match the completed run attempt.');
  if (run.conclusion === 'success' && (!jobs.length || jobs.some(job => !['success', 'skipped', 'neutral'].includes(job.conclusion ?? ''))))
    throw new Error('Successful recovery has missing or inconsistent job evidence.');
  const observed = jobs.map(job => ({ id: job.id, run_id: job.run_id, head_sha: job.head_sha,
    name: job.name, status: job.status, conclusion: job.conclusion, html_url: job.html_url,
    started_at: timestamp(job.started_at), completed_at: timestamp(job.completed_at) }));
  const completions = observed.map(job => job.completed_at);
  const last = completions.length && completions.every((value): value is string => value !== null)
    ? completions.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest) : null;
  return { run_id: run.id, run_attempt: run.run_attempt, head_sha: run.head_sha, workflow: run.path, branch: run.head_branch,
    run_url: run.html_url + '/attempts/' + run.run_attempt, conclusion: run.conclusion!,
    run_started_at: timestamp(run.run_started_at), jobs: observed, last_job_completed_at: last,
    run_completed_at: null, actual_recovery_at: null };
}
function marker(kind: 'failure' | 'recovery', record: Evidence | Recovery): string {
  const json = JSON.stringify(record).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
  return '<!-- expec-main-build-' + kind + ' ' + json + ' -->';
}
function records<T extends Evidence>(items: Authored[], kind: 'failure' | 'recovery'): T[] {
  const found: T[] = [];
  for (const item of items.filter(trusted)) {
    for (const match of (item.body ?? '').matchAll(new RegExp('<!-- expec-main-build-' + kind + ' (\\{[^\\n]*\\}) -->', 'g'))) {
      const record = JSON.parse(match[1]!) as T;
      if (!integer(record.run_id) || !integer(record.run_attempt) || !sha(record.head_sha))
        throw new Error('Invalid managed incident evidence.');
      found.push(record);
    }
  }
  return found;
}
async function incident(github: GitHub, repository: string, issueNumber: number) {
  const issue = await request<Issue>(github, 'GET /repos/{owner}/{repo}/issues/{issue_number}',
    { ...location(repository), issue_number: issueNumber });
  const prefix = '<!-- expec-main-build-run ' + repository + '#';
  const match = issue.body?.split(prefix)[1]?.match(/^(\d+) -->/);
  if (!trusted(issue) || issue.pull_request || !match || !issue.labels.some(item => (typeof item === 'string' ? item : item.name) === label))
    throw new Error('Only a managed main-build incident can be resolved or updated.');
  const run = Number(match[1]);
  const comments = await github.paginate('GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
    { ...location(repository), issue_number: issueNumber, per_page: 100 }) as Authored[];
  const failures = records<Evidence>([issue, ...comments], 'failure');
  if (!integer(run) || !failures.length || failures.some(item => item.run_id !== run || !failed(item.conclusion)
    || item.head_sha !== failures[0]!.head_sha))
    throw new Error('Managed incident has inconsistent failure evidence.');
  const recoveries = records<Recovery>(comments, 'recovery');
  if (recoveries.some(item => item.issue !== issueNumber || !integer(item.covered_attempt)
    || !sha(item.fix_sha) || item.conclusion !== 'success'))
    throw new Error('Managed incident has inconsistent recovery evidence.');
  return { issue, run, failures, recoveries, covered: Math.max(...failures.map(item => item.run_attempt)) };
}
function details(record: Evidence): string {
  const failedJobs = record.jobs.filter(job => failed(job.conclusion));
  return [
    '[Run ' + record.run_id + ', attempt ' + record.run_attempt + '](' + record.run_url + ')',
    'Head SHA: `' + record.head_sha + '`. Conclusion: `' + record.conclusion + '`.',
    'Run started at: ' + (record.run_started_at ?? 'unknown') + '.',
    'Last job completed at: ' + (record.last_job_completed_at ?? 'unknown') + '.',
    'Exact workflow completion and actual recovery time: unknown.',
    'Failed jobs: ' + (failedJobs.length ? failedJobs.map(job => '[' + text(job.name) + '](' + job.html_url + ')').join(', ') : 'none reported') + '.',
    '| Job | Conclusion | Started | Completed |', '| --- | --- | --- | --- |',
    ...record.jobs.map(job => '| [' + text(job.name) + '](' + job.html_url + ') | ' + text(job.conclusion ?? 'unknown')
      + ' | ' + (job.started_at ?? 'unknown') + ' | ' + (job.completed_at ?? 'unknown') + ' |'),
  ].join('\n');
}
function failureBody(record: Evidence): string {
  return '## Failed main build — attempt ' + record.run_attempt + '\n\n'
    + 'This is CI failure evidence, not a failed-deployment claim.\n\n' + details(record) + '\n\n' + marker('failure', record);
}
async function close(github: GitHub, repository: string, issue: Issue): Promise<void> {
  if (issue.state !== 'closed' || issue.state_reason !== 'completed')
    await github.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}',
      { ...location(repository), issue_number: issue.number, state: 'closed', state_reason: 'completed' });
}

/** Preserve the triggering failed attempt; a later green run never supplies a fix. */
export async function recordMainFailure(github: GitHub, input: { repository: string; workflowRun: Run }): Promise<void> {
  const { repository, workflowRun: event } = input;
  if (!main(event, repository) || !failed(event.conclusion)) return;
  const run = await exactAttempt(github, repository, event.id, event.run_attempt);
  if (run.head_sha !== event.head_sha || run.conclusion !== event.conclusion)
    throw new Error('Triggering failure differs from its exact run attempt.');
  const observed = await evidence(github, repository, run);
  const repo = location(repository);
  const issues = await github.paginate('GET /repos/{owner}/{repo}/issues',
    { ...repo, state: 'all', labels: label, per_page: 100 }) as Issue[];
  const matching = issues.filter(issue => trusted(issue) && !issue.pull_request && issue.body?.includes(runMarker(repository, run.id)));
  if (matching.length > 1) throw new Error('Multiple managed issues identify the same failed run.');
  if (!matching.length) {
    try { await github.request('GET /repos/{owner}/{repo}/labels/{name}', { ...repo, name: label }); }
    catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
      await github.request('POST /repos/{owner}/{repo}/labels',
        { ...repo, name: label, color: 'b60205', description: 'Failed main CI builds and reviewed fixes; not deployment incidents.' });
    }
    await github.request('POST /repos/{owner}/{repo}/issues', { ...repo,
      title: 'Main build failed: run ' + run.id, labels: [label],
      body: runMarker(repository, run.id) + '\n\n' + failureBody(observed) });
    return;
  }
  const current = await incident(github, repository, matching[0]!.number);
  if (current.failures.some(item => item.run_attempt === run.run_attempt)) return;
  if (current.failures[0]!.head_sha !== run.head_sha) throw new Error('A run cannot change its head SHA between attempts.');
  const covered = Math.max(current.covered, ...current.recoveries.map(item => item.covered_attempt));
  // Reopen first: a failed PATCH must never leave a deduplication marker that suppresses retry.
  if (current.issue.state === 'closed' && run.run_attempt > covered)
    await github.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}',
      { ...repo, issue_number: current.issue.number, state: 'open' });
  await github.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
    { ...repo, issue_number: current.issue.number, body: failureBody(observed) });
}
async function descendant(github: GitHub, repo: Location, base: string, head: string): Promise<void> {
  const comparison = await request<{ status: string; base_commit: { sha: string }; merge_base_commit: { sha: string } }>(
    github, 'GET /repos/{owner}/{repo}/compare/{basehead}', { ...repo, basehead: base + '...' + head });
  if (comparison.status !== 'ahead' || comparison.base_commit.sha !== base || comparison.merge_base_commit.sha !== base)
    throw new Error('The fix and recovery must descend from the failed main history.');
}

/** Resolve a managed incident only after an explicit reviewed code fix and full main verification. */
export async function resolveMainFailure(github: GitHub, input: {
  repository: string; issueNumber: number; failedAttempt: number; fixSha: string; recoveryRunId: number; rationale: string; actor: string;
}): Promise<void> {
  const { repository, issueNumber, failedAttempt, recoveryRunId, rationale, actor } = input;
  const fix = input.fixSha.toLowerCase();
  if (!integer(issueNumber) || !integer(failedAttempt) || !integer(recoveryRunId) || !sha(fix) || !rationale.trim() || !actor.trim())
    throw new Error('Resolution requires an issue, reviewed failed attempt, full fix SHA, recovery run, rationale and actor.');
  const repo = location(repository);
  const current = await incident(github, repository, issueNumber);
  if (failedAttempt !== current.covered) throw new Error('The reviewed failed attempt must equal the highest recorded failure.');
  const existing = current.recoveries.filter(item => item.covered_attempt === current.covered);
  if (existing.length > 1 || existing.some(item => item.fix_sha !== fix || item.run_id !== recoveryRunId))
    throw new Error('Conflicting resolution for the same failed-attempt boundary.');
  const prior = existing[0];
  const failedHead = current.failures[0]!.head_sha;
  if (fix === failedHead) throw new Error('A distinct code fix is required; a same-head retry is not a reviewed repair.');
  // An interrupted close reuses its recorded successful attempt, even after another retry starts.
  const latest = prior ? null : await request<Run>(github, 'GET /repos/{owner}/{repo}/actions/runs/{run_id}',
    { ...repo, run_id: recoveryRunId });
  const run = await exactAttempt(github, repository, recoveryRunId, prior?.run_attempt ?? latest!.run_attempt);
  if (run.conclusion !== 'success' || (prior && run.head_sha !== prior.head_sha)
    || (latest && (latest.id !== run.id || latest.head_sha !== run.head_sha || latest.conclusion !== 'success')))
    throw new Error('Recovery must be an exact successful main build.');
  const observed = await evidence(github, repository, run);
  await descendant(github, repo, failedHead, fix);
  if (run.head_sha !== fix) await descendant(github, repo, fix, run.head_sha);
  const refreshed = await incident(github, repository, issueNumber);
  if (refreshed.covered !== current.covered || refreshed.failures[0]!.head_sha !== failedHead
    || refreshed.recoveries.length !== current.recoveries.length)
    throw new Error('Incident changed during review; review its current failed attempts.');
  if (!prior) {
    const recovery: Recovery = { ...observed, issue: issueNumber, covered_attempt: current.covered,
      fix_sha: fix, actor, rationale: rationale.trim() };
    const body = '## Reviewed code fix and verified main build\n\n'
      + '[' + fix + '](https://github.com/' + repository + '/commit/' + fix + ') fixes the reviewed cause.\n\n'
      + 'Reviewed by ' + text(actor) + ': ' + text(rationale.trim()) + '\n\n'
      + 'Covers failed run ' + current.run + ' through recorded attempt ' + current.covered + '.\n\n'
      + details(observed) + '\n\n' + marker('recovery', recovery);
    await github.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
      { ...repo, issue_number: issueNumber, body });
  }
  await close(github, repository, refreshed.issue);
}
