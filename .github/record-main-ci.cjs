const label = 'main-ci-failure';
const failures = new Set(['failure', 'timed_out', 'startup_failure']);
const issueMarker = id => `<!-- expec-main-ci-run:${id} -->`;
const recordMarker = record => `<!-- expec-main-ci-record:${record.run_id}:${record.run_attempt} -->`;
const recordBlock = record => `${recordMarker(record)}\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\``;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;

function isMainCi(run, repo) {
  return run?.event === 'push' && run.head_branch === 'main' && run.status === 'completed'
    && run.name === 'Build and test' && run.path === '.github/workflows/ci.yml'
    && run.head_repository?.full_name?.toLowerCase() === `${repo.owner}/${repo.repo}`.toLowerCase();
}

// The caller serializes recorder runs. Only GitHub metadata is consumed; no CI artifact is executed.
async function recordMainCiAttempt({ github, context }) {
  const repo = context.repo;
  const source = context.payload.workflow_run;
  if (!isMainCi(source, repo) || (!failures.has(source.conclusion) && source.conclusion !== 'success')) return;
  const snapshotCache = new Map();
  async function snapshot(run) {
    const key = `${run.id}:${run.run_attempt}`;
    if (snapshotCache.has(key)) return snapshotCache.get(key);
    const input = { ...repo, run_id: run.id, attempt_number: run.run_attempt };
    const { data: actual } = await github.rest.actions.getWorkflowRunAttempt(input);
    if (!isMainCi(actual, repo) || actual.id !== run.id || actual.run_attempt !== run.run_attempt
      || actual.head_sha !== run.head_sha || actual.conclusion !== run.conclusion) {
      throw new Error(`Run attempt ${key} does not match the completed main CI observation.`);
    }
    const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt, { ...input, per_page: 100 });
    const ends = jobs.map(job => timestamp(job.completed_at));
    const record = {
      classification: failures.has(actual.conclusion) ? 'CI failure' : 'Later successful main observation',
      deployment_failure: null,
      run_id: actual.id, run_attempt: actual.run_attempt, workflow_id: actual.workflow_id,
      head_sha: actual.head_sha, conclusion: actual.conclusion,
      run_url: `${actual.html_url}/attempts/${actual.run_attempt}`,
      run_started_at: timestamp(actual.run_started_at), run_updated_at: timestamp(actual.updated_at),
      workflow_completed_at: timestamp(actual.completed_at),
      // This is the last job's end, not an invented workflow completion or incident recovery time.
      last_job_completed_at: ends.length && ends.every(Boolean)
        ? ends.reduce((latest, end) => Date.parse(end) > Date.parse(latest) ? end : latest) : null,
      failed_jobs: jobs.filter(job => failures.has(job.conclusion)).map(job => ({
        id: job.id, name: job.name, conclusion: job.conclusion, url: job.html_url,
        started_at: timestamp(job.started_at), completed_at: timestamp(job.completed_at),
      })),
    };
    snapshotCache.set(key, record);
    return record;
  }

  const observation = await snapshot(source);
  if (failures.has(source.conclusion)) {
    try { await github.rest.issues.getLabel({ ...repo, name: label }); }
    catch (error) {
      if (error.status !== 404) throw error;
      await github.rest.issues.createLabel({ ...repo, name: label, color: 'b60205', description: 'Recorded main CI failure; deployment impact is not inferred.' });
    }
  }
  const issues = (await github.paginate(github.rest.issues.listForRepo, { ...repo, state: 'all', labels: label, per_page: 100 }))
    .filter(issue => !issue.pull_request && issue.user?.login === 'github-actions[bot]' && issue.body?.includes('<!-- expec-main-ci-run:'));
  const recordCache = new Map();
  async function records(issue) {
    if (!recordCache.has(issue.number)) {
      const comments = await github.paginate(github.rest.issues.listComments, { ...repo, issue_number: issue.number, per_page: 100 });
      recordCache.set(issue.number, [issue, ...comments].filter(item => item.user?.login === 'github-actions[bot]').flatMap(item =>
        [...(item.body ?? '').matchAll(/<!-- expec-main-ci-record:\d+:\d+ -->\n```json\n([\s\S]*?)\n```/g)]
          .map(match => JSON.parse(match[1]))));
    }
    return recordCache.get(issue.number);
  }
  async function append(issue, record) {
    const previous = await records(issue);
    if (previous.some(value => value.run_id === record.run_id && value.run_attempt === record.run_attempt)) return;
    await github.rest.issues.createComment({ ...repo, issue_number: issue.number, body: recordBlock(record) });
    previous.push(record);
  }
  async function observeSuccess(issue, success) {
    const previous = await records(issue);
    const failed = previous.filter(record => failures.has(record.conclusion)).sort((a, b) => b.run_attempt - a.run_attempt)[0];
    if (!failed || previous.some(record => record.observed_after_attempt >= failed.run_attempt)) return;
    if (!failed.last_job_completed_at || !success.last_job_completed_at
      || Date.parse(success.last_job_completed_at) <= Date.parse(failed.last_job_completed_at)) return;
    if (success.run_id === failed.run_id && success.run_attempt <= failed.run_attempt) return;
    if (success.head_sha !== failed.head_sha) {
      const comparison = await github.rest.repos.compareCommitsWithBasehead({ ...repo, basehead: `${failed.head_sha}...${success.head_sha}` });
      if (comparison.data.status !== 'ahead') return;
    }
    await append(issue, { ...success, observed_after_attempt: failed.run_attempt,
      relation: success.head_sha === failed.head_sha ? 'same commit' : 'descendant commit' });
  }

  if (failures.has(source.conclusion)) {
    const matching = issues.filter(issue => issue.body.includes(issueMarker(source.id)));
    if (matching.length > 1) throw new Error(`Multiple main CI history issues exist for run ${source.id}.`);
    let issue = matching[0];
    if (!issue) {
      issue = (await github.rest.issues.create({ ...repo, labels: [label],
        title: `Main CI failure: Build and test run ${source.id}`,
        body: `${issueMarker(source.id)}\nCI failure evidence, not a deployment failure. Deployment impact and causal recovery remain unknown.\n\nLater successful main observations do not automatically resolve this issue. Issue closure time is never recovery time.\n\n${recordBlock(observation)}`,
      })).data;
    } else await append(issue, observation);
    const latestFailedAttempt = Math.max(...(await records(issue)).filter(record => failures.has(record.conclusion)).map(record => record.run_attempt));
    // A success event may have been handled before this delayed failure event.
    const successful = await github.paginate(github.rest.actions.listWorkflowRuns, {
      ...repo, workflow_id: source.workflow_id, branch: 'main', event: 'push', status: 'success', per_page: 100,
    });
    for (const run of successful) {
      if (!isMainCi(run, repo) || run.conclusion !== 'success') continue;
      await observeSuccess(issue, await snapshot(run));
      if ((await records(issue)).some(record => record.observed_after_attempt >= latestFailedAttempt)) break;
    }
  } else {
    for (const issue of issues) await observeSuccess(issue, observation);
  }
}

module.exports = { recordMainCiAttempt };
