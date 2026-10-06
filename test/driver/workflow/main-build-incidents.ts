import { recordMainFailure, resolveMainFailure } from '../../../.github/ci/main-build-incidents.js';

export const repository = 'jreyno77/ExecutableSpecificationLanguage';
export const failedSha = '1'.repeat(40), fixSha = '2'.repeat(40), recoveredSha = '3'.repeat(40);
type Run = Parameters<typeof recordMainFailure>[1]['workflowRun'];
export type Job = {
  id: number; run_id: number; head_sha: string; name: string; status: string; conclusion: string | null;
  html_url: string; started_at: string | null; completed_at: string | null;
};
type Comment = { id: number; body: string; user: { login: string; type: string } };
export type Issue = {
  number: number; body: string; title: string; state: string; state_reason: string | null;
  labels: { name: string }[]; user: { login: string; type: string }; comments: Comment[];
  pull_request?: object;
};
const bot = { login: 'github-actions[bot]', type: 'Bot' };

export class MainBuildExamples {
  readonly attempts = new Map<string, Run>();
  readonly jobs = new Map<string, Job[]>();
  readonly issues: Issue[] = [];
  readonly calls: { route: string; parameters: Record<string, unknown> }[] = [];
  readonly comparisons = new Map<string, string>();
  labelExists = false;
  failClose = false;
  failReopen = false;
  failComment = false;
  pageSize = 100;

  mainAttempt(id: number, attempt: number, sha = failedSha, conclusion = 'failure', changes: Partial<Run> = {}): Run {
    const run = { id, run_attempt: attempt, head_sha: sha, head_branch: 'main', event: 'push', name: 'Build and test',
      path: '.github/workflows/ci.yml', status: 'completed', conclusion, head_repository: { full_name: repository },
      html_url: 'https://github.com/' + repository + '/actions/runs/' + id,
      run_started_at: '2026-10-06T01:00:00Z', ...changes };
    this.attempts.set(id + ':' + attempt, run);
    this.jobs.set(id + ':' + attempt, [{ id: 80, run_id: id, head_sha: sha, name: 'Windows tests',
      status: 'completed', conclusion, html_url: 'https://github.com/' + repository + '/actions/runs/' + id + '/job/80',
      started_at: '2026-10-06T01:01:00Z', completed_at: '2026-10-06T01:12:00Z' }]);
    return run;
  }
  issue(run = 700): Issue {
    const issue = this.issues.find(issue => issue.body.includes('expec-main-build-run ' + repository + '#' + run));
    if (!issue) throw new Error('Expected incident for run ' + run);
    return issue;
  }
  comments(run = 700): string[] { return this.issue(run).comments.map(comment => comment.body); }
  allEvidence(run = 700): string { return [this.issue(run).body, ...this.comments(run)].join('\n'); }
  recordFailure(run = 700, attempt = 1): Promise<void> {
    return recordMainFailure(this.github, { repository, workflowRun: this.attempts.get(run + ':' + attempt)! });
  }
  resolve(run = 700, recoveryRun = 702, sha = fixSha, rationale = 'Release the fixture handle before deleting its directory.', failedAttempt = 1): Promise<void> {
    return resolveMainFailure(this.github, { repository, issueNumber: this.issue(run).number, failedAttempt, fixSha: sha,
      recoveryRunId: recoveryRun, rationale, actor: 'delivery-reviewer' });
  }
  async openFailure(): Promise<void> { this.mainAttempt(700, 1); await this.recordFailure(); }
  reviewedRecovery(): void {
    this.mainAttempt(702, 1, recoveredSha, 'success');
    this.comparisons.set(failedSha + '...' + fixSha, 'ahead');
    this.comparisons.set(fixSha + '...' + recoveredSha, 'ahead');
  }
  private missing(): never { throw Object.assign(new Error('Not found'), { status: 404 }); }
  readonly github = {
    request: async (route: string, parameters: Record<string, unknown>): Promise<{ data: unknown }> => {
      this.calls.push({ route, parameters: { ...parameters } });
      const run = Number(parameters.run_id), attempt = Number(parameters.attempt_number);
      const issue = this.issues.find(issue => issue.number === parameters.issue_number);
      if (route === 'GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}')
        return { data: this.attempts.get(run + ':' + attempt) ?? this.missing() };
      if (route === 'GET /repos/{owner}/{repo}/actions/runs/{run_id}') {
        const attempts = [...this.attempts.values()].filter(item => item.id === run).sort((a, b) => b.run_attempt - a.run_attempt);
        return { data: attempts[0] ?? this.missing() };
      }
      if (route === 'GET /repos/{owner}/{repo}/labels/{name}') {
        if (!this.labelExists) this.missing();
        return { data: { name: parameters.name } };
      }
      if (route === 'POST /repos/{owner}/{repo}/labels') {
        this.labelExists = true; return { data: { name: parameters.name } };
      }
      if (route === 'POST /repos/{owner}/{repo}/issues') {
        const created: Issue = { number: 100 + this.issues.length, body: String(parameters.body), title: String(parameters.title),
          state: 'open', state_reason: null, user: bot, labels: (parameters.labels as string[]).map(name => ({ name })), comments: [] };
        this.issues.push(created); return { data: created };
      }
      if (route === 'GET /repos/{owner}/{repo}/issues/{issue_number}') return { data: issue ?? this.missing() };
      if (route === 'POST /repos/{owner}/{repo}/issues/{issue_number}/comments') {
        if (this.failComment) { this.failComment = false; throw new Error('Comment write failed'); }
        if (!issue) this.missing();
        const comment = { id: issue.comments.length + 1, body: String(parameters.body), user: bot };
        issue.comments.push(comment); return { data: comment };
      }
      if (route === 'PATCH /repos/{owner}/{repo}/issues/{issue_number}') {
        if (!issue) this.missing();
        if (parameters.state === 'closed' && this.failClose) { this.failClose = false; throw new Error('Close failed'); }
        if (parameters.state === 'open' && this.failReopen) { this.failReopen = false; throw new Error('Reopen failed'); }
        issue.state = String(parameters.state);
        issue.state_reason = parameters.state_reason ? String(parameters.state_reason) : null;
        return { data: issue };
      }
      if (route === 'GET /repos/{owner}/{repo}/compare/{basehead}') {
        const base = String(parameters.basehead).split('...')[0];
        return { data: { status: this.comparisons.get(String(parameters.basehead)) ?? 'diverged',
          base_commit: { sha: base }, merge_base_commit: { sha: base } } };
      }
      throw new Error('Unexpected GitHub route: ' + route);
    },
    paginate: async (route: string, parameters: Record<string, unknown>): Promise<unknown[]> => {
      this.calls.push({ route, parameters: { ...parameters } });
      let items: unknown[];
      if (route === 'GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs')
        items = this.jobs.get(parameters.run_id + ':' + parameters.attempt_number) ?? this.missing();
      else if (route === 'GET /repos/{owner}/{repo}/issues')
        items = this.issues.filter(issue => parameters.state === 'all' || issue.state === parameters.state);
      else if (route === 'GET /repos/{owner}/{repo}/issues/{issue_number}/comments')
        items = this.issues.find(issue => issue.number === parameters.issue_number)?.comments ?? this.missing();
      else throw new Error('Unexpected paginated GitHub route: ' + route);
      const pages = [];
      for (let index = 0; index < items.length; index += this.pageSize) pages.push(items.slice(index, index + this.pageSize));
      return pages.flat();
    },
  };
}
