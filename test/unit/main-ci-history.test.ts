import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { recordMainCiAttempt } = createRequire(import.meta.url)('../../.github/record-main-ci.cjs');
const repository = { owner: 'owner', repo: 'example' };
type ApiInput = Record<string, any>;
type Issue = { number: number; title: string; body: string; state: string; labels: string[]; user: { login: string } };

describe('durable main CI observations', () => {
  it('retains the actual failed attempt without declaring a failed deployment', async () => {
    const history = new CiHistory();
    await history.observe(run(100, 1, 'failure', { head_sha: 'failed-commit', run_started_at: '2026-10-05T10:00:00Z' }), [
      job(700, 'Kotlin / Windows', 'failure', '2026-10-05T10:08:00Z'),
    ]);

    expect(history.issues).toHaveLength(1);
    expect(history.records()).toEqual([expect.objectContaining({
      classification: 'CI failure', run_id: 100, run_attempt: 1, head_sha: 'failed-commit',
      run_started_at: '2026-10-05T10:00:00Z', workflow_completed_at: null,
      last_job_completed_at: '2026-10-05T10:08:00Z', deployment_failure: null,
      failed_jobs: [expect.objectContaining({ id: 700, name: 'Kotlin / Windows', conclusion: 'failure' })],
    })]);
    expect(history.issues[0]!.body).toContain('not a deployment failure');
  });

  it('handles repeated failure delivery once, including after the issue was closed', async () => {
    const history = new CiHistory();
    const failed = run(100, 1, 'failure');
    await history.observe(failed);
    history.issues[0]!.state = 'closed';
    await history.deliver(failed);
    expect(history.issues).toHaveLength(1);
    expect(history.records()).toHaveLength(1);
    expect(history.issues[0]!.state).toBe('closed');
  });

  it('retains each failed retry and reads delayed events from their original attempt', async () => {
    const history = new CiHistory();
    const first = run(100, 1, 'failure');
    await history.observe(first, [job(701, 'Initial failure', 'failure', '2026-10-05T10:10:00Z')]);
    await history.observe(run(100, 2, 'failure'), [job(702, 'Retry failure', 'failure', '2026-10-05T10:20:00Z')]);
    await history.deliver(first);
    expect(history.issues).toHaveLength(1);
    expect(history.records().map(record => [record.run_attempt, record.failed_jobs[0].name]))
      .toEqual([[1, 'Initial failure'], [2, 'Retry failure']]);
  });

  it('does not record pull request checks even when their branch is main', async () => {
    const history = new CiHistory();
    await history.observe(run(100, 1, 'failure', { event: 'pull_request' }));
    expect(history.issues).toEqual([]);
  });

  it('does not record another repository or workflow as main CI', async () => {
    const history = new CiHistory();
    await history.observe(run(100, 1, 'failure', { head_repository: { full_name: 'someone/example' } }));
    await history.observe(run(101, 1, 'failure', { path: '.github/workflows/other.yml' }));
    expect(history.issues).toEqual([]);
  });

  it('does not classify cancellation or an uneventful success as failure', async () => {
    const history = new CiHistory();
    await history.observe(run(100, 1, 'cancelled'));
    await history.observe(run(101, 1, 'success'));
    expect(history.issues).toEqual([]);
  });

  it('records a successful retry once without claiming causal resolution', async () => {
    const history = new CiHistory();
    await history.observe(run(100, 1, 'failure'));
    const green = run(100, 2, 'success', { run_started_at: '2026-10-05T10:15:00Z' });
    await history.observe(green, [job(702, 'Core', 'success', '2026-10-05T10:20:00Z')]);
    await history.deliver(green);
    expect(history.records()).toHaveLength(2);
    expect(history.records()[1]).toMatchObject({
      classification: 'Later successful main observation', run_id: 100, run_attempt: 2,
      observed_after_attempt: 1, relation: 'same commit', last_job_completed_at: '2026-10-05T10:20:00Z',
    });
    expect(history.issues[0]!.state).toBe('open');
  });

  it('records a proven descendant succeeding after main failed', async () => {
    const history = new CiHistory();
    await history.observe(run(100, 1, 'failure', { head_sha: 'broken' }));
    history.comparisons.set('broken...repaired', 'ahead');
    await history.observe(run(101, 1, 'success', { head_sha: 'repaired' }), [job(702, 'Core', 'success', '2026-10-05T11:00:00Z')]);
    expect(history.records()[1]).toMatchObject({ run_id: 101, head_sha: 'repaired', relation: 'descendant commit' });
  });

  it('does not mistake an older or unrelated green run for later success', async () => {
    const history = new CiHistory();
    await history.observe(run(100, 1, 'failure', { head_sha: 'broken' }));
    history.comparisons.set('broken...old', 'ahead');
    await history.observe(run(99, 1, 'success', { head_sha: 'old' }), [job(701, 'Core', 'success', '2026-10-05T09:00:00Z')]);
    await history.observe(run(101, 1, 'success', { head_sha: 'unrelated' }), [job(702, 'Core', 'success', '2026-10-05T11:00:00Z')]);
    expect(history.records()).toHaveLength(1);
  });

  it('finds an actual later success when its failure event arrives late', async () => {
    const history = new CiHistory();
    history.comparisons.set('broken...repaired', 'ahead');
    await history.observe(run(101, 1, 'success', { head_sha: 'repaired' }), [job(702, 'Core', 'success', '2026-10-05T11:00:00Z')]);
    await history.observe(run(100, 1, 'failure', { head_sha: 'broken' }));
    expect(history.records().map(record => [record.run_id, record.classification])).toEqual([
      [100, 'CI failure'], [101, 'Later successful main observation'],
    ]);
  });

  it('retains another later green attempt after the same run fails again', async () => {
    const history = new CiHistory();
    await history.observe(run(100, 1, 'failure'));
    await history.observe(run(100, 2, 'success'), [job(702, 'Core', 'success', '2026-10-05T10:20:00Z')]);
    await history.observe(run(100, 3, 'failure'), [job(703, 'Core', 'failure', '2026-10-05T10:30:00Z')]);
    await history.observe(run(100, 4, 'success'), [job(704, 'Core', 'success', '2026-10-05T10:40:00Z')]);
    expect(history.records().map(record => record.run_attempt)).toEqual([1, 2, 3, 4]);
    expect(history.records()[3].observed_after_attempt).toBe(3);
  });

  it('reconciles the newest failure when an older failure event is delivered again', async () => {
    const history = new CiHistory();
    const initial = run(100, 1, 'failure');
    await history.observe(initial);
    await history.observe(run(100, 2, 'success'), [job(702, 'Core', 'success', '2026-10-05T10:20:00Z')]);
    await history.observe(run(100, 3, 'failure'), [job(703, 'Core', 'failure', '2026-10-05T10:30:00Z')]);
    history.runs.set('100:4', run(100, 4, 'success'));
    history.jobs.set('100:4', [job(704, 'Core', 'success', '2026-10-05T10:40:00Z')]);
    await history.deliver(initial);
    expect(history.records().map(record => record.run_attempt)).toEqual([1, 2, 3, 4]);
  });

  it('keeps missing job completion and workflow completion times unknown', async () => {
    const history = new CiHistory();
    await history.observe(run(100, 1, 'failure', { run_started_at: null }), [
      job(701, 'Failure', 'failure', '2026-10-05T10:10:00Z'), job(702, 'Incomplete metadata', 'failure', null),
    ]);
    expect(history.records()[0]).toMatchObject({ run_started_at: null, last_job_completed_at: null, workflow_completed_at: null });
    expect(history.records()[0].failed_jobs[1].completed_at).toBeNull();
  });

  it('reports a failed write instead of claiming evidence was retained', async () => {
    const history = new CiHistory();
    history.rejectWrites = true;
    await expect(history.observe(run(100, 1, 'failure'))).rejects.toThrow('GitHub write unavailable');
    expect(history.issues).toEqual([]);
  });

  it('does not let another commenter replace an actual later success observation', async () => {
    const history = new CiHistory();
    await history.observe(run(100, 1, 'failure'));
    history.someoneClaimsRecovery();
    await history.observe(run(100, 2, 'success'), [job(702, 'Core', 'success', '2026-10-05T10:20:00Z')]);
    expect(history.records().at(-1)).toMatchObject({ run_id: 100, run_attempt: 2 });
  });
});

function run(id: number, attempt: number, conclusion: string, extra: ApiInput = {}) {
  return {
    id, run_attempt: attempt, run_number: id, workflow_id: 12,
    name: 'Build and test', path: '.github/workflows/ci.yml', event: 'push',
    head_branch: 'main', head_sha: `commit-${id}`, status: 'completed', conclusion,
    head_repository: { full_name: 'owner/example' },
    html_url: `https://github.com/owner/example/actions/runs/${id}`,
    run_started_at: '2026-10-05T10:00:00Z', updated_at: '2026-10-05T10:10:00Z', ...extra,
  };
}

function job(id: number, name: string, conclusion: string, completed: string | null) {
  return { id, name, conclusion, started_at: '2026-10-05T10:00:00Z', completed_at: completed,
    html_url: `https://github.com/owner/example/actions/runs/100/job/${id}` };
}

class CiHistory {
  issues: Issue[] = [];
  comments = new Map<number, { body: string; user: { login: string } }[]>();
  runs = new Map<string, ReturnType<typeof run>>();
  jobs = new Map<string, ReturnType<typeof job>[]>();
  comparisons = new Map<string, string>();
  rejectWrites = false;
  github = {
    rest: {
      actions: {
        getWorkflowRunAttempt: async ({ run_id, attempt_number }: ApiInput) => ({ data: this.runs.get(`${run_id}:${attempt_number}`) }),
        listJobsForWorkflowRunAttempt: async ({ run_id, attempt_number }: ApiInput) => ({ data: { jobs: this.jobs.get(`${run_id}:${attempt_number}`) ?? [] } }),
        listWorkflowRuns: async () => ({ data: { workflow_runs: [...this.runs.values()].filter(value => value.conclusion === 'success') } }),
      },
      issues: {
        getLabel: async () => ({ data: { name: 'main-ci-failure' } }),
        createLabel: async () => ({ data: { name: 'main-ci-failure' } }),
        listForRepo: async () => ({ data: this.issues }),
        listComments: async ({ issue_number }: ApiInput) => ({ data: this.comments.get(issue_number) ?? [] }),
        create: async ({ title, body, labels }: ApiInput) => {
          if (this.rejectWrites) throw new Error('GitHub write unavailable');
          const issue = { number: this.issues.length + 1, title, body, labels, state: 'open', user: { login: 'github-actions[bot]' } };
          this.issues.push(issue); return { data: issue };
        },
        createComment: async ({ issue_number, body }: ApiInput) => {
          if (this.rejectWrites) throw new Error('GitHub write unavailable');
          const comments = this.comments.get(issue_number) ?? [];
          comments.push({ body, user: { login: 'github-actions[bot]' } }); this.comments.set(issue_number, comments); return { data: { body } };
        },
      },
      repos: {
        compareCommitsWithBasehead: async ({ basehead }: ApiInput) => ({ data: { status: this.comparisons.get(basehead) ?? 'diverged' } }),
      },
    },
    paginate: async (method: (input: ApiInput) => Promise<{ data: any }>, input: ApiInput) => {
      const { data } = await method(input); return Array.isArray(data) ? data : data.jobs ?? data.workflow_runs;
    },
  };

  async observe(source: ReturnType<typeof run>, jobs: ReturnType<typeof job>[] = [job(700, 'Core', source.conclusion, '2026-10-05T10:10:00Z')]) {
    this.runs.set(`${source.id}:${source.run_attempt}`, source);
    this.jobs.set(`${source.id}:${source.run_attempt}`, jobs);
    await this.deliver(source);
  }

  async deliver(source: ReturnType<typeof run>) {
    await recordMainCiAttempt({ github: this.github, context: {
      repo: repository, sha: 'recorder-commit', payload: { workflow_run: source },
    } });
  }

  someoneClaimsRecovery() {
    const claim = { run_id: 999, run_attempt: 1, conclusion: 'success', observed_after_attempt: 999 };
    this.comments.set(1, [{ user: { login: 'someone-else' },
      body: `<!-- expec-main-ci-record:999:1 -->\n\`\`\`json\n${JSON.stringify(claim)}\n\`\`\``,
    }]);
  }

  records() {
    return this.issues.flatMap(issue => [issue.body, ...(this.comments.get(issue.number) ?? []).map(comment => comment.body)])
      .flatMap(body => [...body.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]!)));
  }
}
