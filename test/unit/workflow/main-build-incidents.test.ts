import { describe, expect, it } from 'vitest';
import { recordMainFailure, resolveMainFailure } from '../../../.github/ci/main-build-incidents.js';
import { MainBuildExamples, failedSha, fixSha, recoveredSha, repository } from '../../driver/workflow/main-build-incidents.js';

const failureCount = (incidents: MainBuildExamples) => (incidents.allEvidence().match(/<!-- expec-main-build-failure /g) ?? []).length;
const recoveryCount = (incidents: MainBuildExamples) => (incidents.allEvidence().match(/<!-- expec-main-build-recovery /g) ?? []).length;

describe('main build failure evidence', () => {
  it('records the exact failed attempt once', async () => {
    const incidents = new MainBuildExamples();
    incidents.mainAttempt(700, 1, failedSha);
    await incidents.recordFailure();
    await incidents.recordFailure();
    expect(incidents.issues).toHaveLength(1);
    expect(incidents.issue().state).toBe('open');
    expect(failureCount(incidents)).toBe(1);
    expect(incidents.allEvidence()).toContain(failedSha);
    expect(incidents.allEvidence()).toContain('Windows tests');
    expect(incidents.allEvidence()).toContain('/actions/runs/700/attempts/1');
    expect(incidents.allEvidence()).toContain('2026-10-06T01:12:00Z');
    expect(incidents.allEvidence()).toContain('"actual_recovery_at":null');
    expect(incidents.labelExists).toBe(true);
  });

  it('records a timed-out main attempt as a CI failure', async () => {
    const incidents = new MainBuildExamples();
    incidents.mainAttempt(700, 1, failedSha, 'timed_out');
    await incidents.recordFailure();
    expect(incidents.allEvidence()).toContain('"conclusion":"timed_out"');
    expect(incidents.allEvidence()).toContain('not a failed-deployment claim');
  });

  it('appends a second failed attempt to the original issue', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.mainAttempt(700, 2);
    await incidents.recordFailure(700, 2);
    await incidents.recordFailure(700, 2);
    expect(incidents.issues).toHaveLength(1);
    expect(failureCount(incidents)).toBe(2);
    expect(incidents.comments()).toHaveLength(1);
    expect(incidents.comments()[0]).toContain('"run_attempt":2');
  });

  it('retains a delayed failure when its current retry is green', async () => {
    const incidents = new MainBuildExamples();
    incidents.mainAttempt(700, 1);
    incidents.mainAttempt(700, 2, failedSha, 'success');
    await incidents.recordFailure(700, 1);
    expect(incidents.allEvidence()).toContain('"run_attempt":1');
    expect(incidents.allEvidence()).not.toContain('"run_attempt":2');
    expect(incidents.issue().state).toBe('open');
    expect(incidents.calls.some(call => call.route.endsWith('/runs/{run_id}'))).toBe(false);
  });

  it('keeps an unexplained failure open after another successful main run', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.mainAttempt(702, 1, recoveredSha, 'success');
    await incidents.recordFailure(702, 1);
    expect(incidents.issue().state).toBe('open');
    expect(recoveryCount(incidents)).toBe(0);
  });

  it('ignores partial pull request checks', async () => {
    const incidents = new MainBuildExamples();
    incidents.mainAttempt(700, 1, failedSha, 'failure', { event: 'pull_request' });
    await incidents.recordFailure();
    expect(incidents.calls).toHaveLength(0);
  });

  it('ignores another repository even when its branch is main', async () => {
    const incidents = new MainBuildExamples();
    incidents.mainAttempt(700, 1, failedSha, 'failure', { head_repository: { full_name: 'outside/repository' } });
    await incidents.recordFailure();
    expect(incidents.issues).toHaveLength(0);
  });

  it('ignores a different branch', async () => {
    const incidents = new MainBuildExamples();
    incidents.mainAttempt(700, 1, failedSha, 'failure', { head_branch: 'feature' });
    await incidents.recordFailure();
    expect(incidents.issues).toHaveLength(0);
  });

  it('ignores a different workflow with the same display name', async () => {
    const incidents = new MainBuildExamples();
    incidents.mainAttempt(700, 1, failedSha, 'failure', { path: '.github/workflows/other.yml' });
    await incidents.recordFailure();
    expect(incidents.issues).toHaveLength(0);
  });

  it('does not equate cancellation with a failed build', async () => {
    const incidents = new MainBuildExamples();
    incidents.mainAttempt(700, 1, failedSha, 'cancelled');
    await incidents.recordFailure();
    expect(incidents.issues).toHaveLength(0);
  });

  it('does not record an unfinished attempt', async () => {
    const incidents = new MainBuildExamples();
    incidents.mainAttempt(700, 1, failedSha, 'failure', { status: 'in_progress' });
    await incidents.recordFailure();
    expect(incidents.issues).toHaveLength(0);
  });

  it('refuses an exact-attempt response for a different commit', async () => {
    const incidents = new MainBuildExamples();
    const triggeringRun = { ...incidents.mainAttempt(700, 1) };
    incidents.mainAttempt(700, 1, recoveredSha);
    await expect(recordMainFailure(incidents.github, { repository, workflowRun: triggeringRun })).rejects.toThrow('differs');
    expect(incidents.issues).toHaveLength(0);
  });

  it('rejects job evidence for a different run', async () => {
    const incidents = new MainBuildExamples();
    incidents.mainAttempt(700, 1);
    incidents.jobs.get('700:1')![0]!.run_id = 701;
    await expect(incidents.recordFailure()).rejects.toThrow('Job evidence');
    expect(incidents.issues).toHaveLength(0);
  });

  it('rejects job evidence for a different head SHA', async () => {
    const incidents = new MainBuildExamples();
    incidents.mainAttempt(700, 1);
    incidents.jobs.get('700:1')![0]!.head_sha = recoveredSha;
    await expect(incidents.recordFailure()).rejects.toThrow('Job evidence');
    expect(incidents.issues).toHaveLength(0);
  });

  it('waits for complete job evidence instead of recording a partial list as complete', async () => {
    const incidents = new MainBuildExamples();
    incidents.mainAttempt(700, 1);
    incidents.jobs.get('700:1')![0]!.status = 'in_progress';
    await expect(incidents.recordFailure()).rejects.toThrow('Job evidence');
    expect(incidents.issues).toHaveLength(0);
  });

  it('records a workflow-level failure without inventing a failed job or timestamp', async () => {
    const incidents = new MainBuildExamples();
    const run = incidents.mainAttempt(700, 1, failedSha, 'failure', { run_started_at: null });
    Object.assign(run, { updated_at: '2099-01-01T00:00:00Z' });
    incidents.jobs.set('700:1', []);
    await incidents.recordFailure();
    expect(incidents.allEvidence()).toContain('"jobs":[]');
    expect(incidents.allEvidence()).toContain('"last_job_completed_at":null');
    expect(incidents.allEvidence()).toContain('"run_completed_at":null');
    expect(incidents.allEvidence()).not.toContain('2099');
    expect(incidents.allEvidence()).toContain('Failed jobs: none reported');
  });

  it('leaves completion unknown when one observed job has no completion timestamp', async () => {
    const incidents = new MainBuildExamples();
    incidents.mainAttempt(700, 1);
    incidents.jobs.get('700:1')![0]!.completed_at = null;
    await incidents.recordFailure();
    expect(incidents.allEvidence()).toContain('"last_job_completed_at":null');
  });

  it('retains jobs and duplicate evidence found on later API pages', async () => {
    const incidents = new MainBuildExamples();
    incidents.pageSize = 1;
    incidents.mainAttempt(700, 1);
    const first = incidents.jobs.get('700:1')![0]!;
    incidents.jobs.get('700:1')!.push({ ...first, id: 81, name: 'Linux tests', completed_at: '2026-10-06T01:15:00Z' });
    await incidents.recordFailure();
    incidents.mainAttempt(700, 2);
    await incidents.recordFailure(700, 2);
    incidents.mainAttempt(700, 3);
    await incidents.recordFailure(700, 3);
    await incidents.recordFailure(700, 3);
    expect(failureCount(incidents)).toBe(3);
    expect(incidents.issue().body).toContain('Linux tests');
    expect(incidents.issue().body).toContain('"last_job_completed_at":"2026-10-06T01:15:00Z"');
    expect(incidents.calls).toContainEqual({
      route: 'GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs',
      parameters: { owner: 'jreyno77', repo: 'ExecutableSpecificationLanguage', run_id: 700, attempt_number: 1, per_page: 100 },
    });
    expect(incidents.calls.find(call => call.route === 'GET /repos/{owner}/{repo}/issues')?.parameters.state).toBe('all');
  });

  it('does not let a human comment impersonate recorded attempt evidence', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.mainAttempt(700, 2);
    await incidents.recordFailure(700, 2);
    incidents.issue().comments[0]!.user = { login: 'someone', type: 'User' };
    await incidents.recordFailure(700, 2);
    expect(incidents.issue().comments.filter(comment => comment.user.login === 'github-actions[bot]')).toHaveLength(1);
  });

  it('rejects ambiguous duplicate managed issues instead of modifying both', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.issues.push({ ...incidents.issue(), number: 101 });
    incidents.mainAttempt(700, 2);
    await expect(incidents.recordFailure(700, 2)).rejects.toThrow('Multiple');
  });
});

describe('reviewed fixes for recorded main failures', () => {
  it('links a distinct code fix and exact successful main attempt before closing', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    const original = incidents.issue().body;
    incidents.reviewedRecovery();
    await incidents.resolve();
    expect(incidents.issue().state).toBe('closed');
    expect(incidents.issue().state_reason).toBe('completed');
    expect(incidents.issue().body).toBe(original);
    expect(recoveryCount(incidents)).toBe(1);
    expect(incidents.comments()[0]).toContain('/commit/' + fixSha);
    expect(incidents.comments()[0]).toContain('/actions/runs/702/attempts/1');
    expect(incidents.comments()[0]).toContain('delivery-reviewer');
    expect(incidents.comments()[0]).toContain('Release the fixture handle');
    expect(incidents.comments()[0]).toContain('"covered_attempt":1');
    expect(incidents.comments()[0]).toContain('"actual_recovery_at":null');
    const writes = incidents.calls.filter(call => /^(POST|PATCH)/.test(call.route));
    expect(writes.at(-2)?.route).toContain('/comments');
    expect(writes.at(-1)?.parameters).toMatchObject({ state: 'closed', state_reason: 'completed' });
  });

  it('accepts recovery at the fix commit itself', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.reviewedRecovery();
    incidents.mainAttempt(702, 1, fixSha, 'success');
    await incidents.resolve();
    expect(incidents.issue().state).toBe('closed');
  });

  it('refuses a same-head retry as proof of a code fix', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.mainAttempt(700, 2, failedSha, 'success');
    await expect(incidents.resolve(700, 700, failedSha)).rejects.toThrow('distinct code fix');
    expect(incidents.issue().state).toBe('open');
  });

  it('refuses a fix outside the failed main history', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.reviewedRecovery();
    incidents.comparisons.set(failedSha + '...' + fixSha, 'diverged');
    await expect(incidents.resolve()).rejects.toThrow('descend');
    expect(recoveryCount(incidents)).toBe(0);
    expect(incidents.issue().state).toBe('open');
  });

  it('refuses a green recovery that does not contain the fix', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.reviewedRecovery();
    incidents.comparisons.set(fixSha + '...' + recoveredSha, 'behind');
    await expect(incidents.resolve()).rejects.toThrow('descend');
    expect(incidents.issue().state).toBe('open');
  });

  it('refuses a green PR run as full main verification', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.reviewedRecovery();
    incidents.mainAttempt(702, 1, recoveredSha, 'success', { event: 'pull_request' });
    await expect(incidents.resolve()).rejects.toThrow('completed main build');
    expect(recoveryCount(incidents)).toBe(0);
  });

  it('refuses incomplete recovery job evidence', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.reviewedRecovery();
    incidents.jobs.set('702:1', []);
    await expect(incidents.resolve()).rejects.toThrow('missing or inconsistent');
    expect(incidents.issue().state).toBe('open');
  });

  it('allows a reviewed descendant fix when exact completion timestamps are unknown', async () => {
    const incidents = new MainBuildExamples();
    incidents.mainAttempt(700, 1);
    incidents.jobs.set('700:1', []);
    await incidents.recordFailure();
    incidents.reviewedRecovery();
    incidents.jobs.get('702:1')![0]!.completed_at = null;
    await incidents.resolve();
    expect(incidents.issue().state).toBe('closed');
    expect(incidents.comments()[0]).toContain('"last_job_completed_at":null');
    expect(incidents.comments()[0]).toContain('"actual_recovery_at":null');
  });

  it('retries a failed close using the recorded successful attempt after another retry fails', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.reviewedRecovery();
    incidents.failClose = true;
    await expect(incidents.resolve()).rejects.toThrow('Close failed');
    expect(incidents.issue().state).toBe('open');
    expect(recoveryCount(incidents)).toBe(1);
    incidents.mainAttempt(702, 2, recoveredSha, 'failure');
    const callBoundary = incidents.calls.length;
    await incidents.resolve();
    expect(incidents.issue().state).toBe('closed');
    expect(recoveryCount(incidents)).toBe(1);
    expect(incidents.calls.slice(callBoundary).some(call => call.route.endsWith('/runs/{run_id}'))).toBe(false);
    expect(incidents.calls.slice(callBoundary)).toContainEqual({
      route: 'GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}',
      parameters: { owner: 'jreyno77', repo: 'ExecutableSpecificationLanguage', run_id: 702, attempt_number: 1 },
    });
  });

  it('keeps the incident open if its recovery comment could not be written', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.reviewedRecovery();
    incidents.failComment = true;
    await expect(incidents.resolve()).rejects.toThrow('Comment write failed');
    expect(incidents.issue().state).toBe('open');
    expect(recoveryCount(incidents)).toBe(0);
    await incidents.resolve();
    expect(recoveryCount(incidents)).toBe(1);
    expect(incidents.issue().state).toBe('closed');
  });

  it('does not duplicate a completed resolution', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.reviewedRecovery();
    await incidents.resolve();
    const writesBefore = incidents.calls.filter(call => /^(POST|PATCH)/.test(call.route)).length;
    await incidents.resolve();
    expect(recoveryCount(incidents)).toBe(1);
    expect(incidents.calls.filter(call => /^(POST|PATCH)/.test(call.route))).toHaveLength(writesBefore);
  });

  it('rejects a different resolution of the same recorded failure boundary', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.reviewedRecovery();
    await incidents.resolve();
    await expect(incidents.resolve(700, 703)).rejects.toThrow('Conflicting resolution');
    expect(recoveryCount(incidents)).toBe(1);
  });

  it('reopens before appending a new higher failed attempt', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.reviewedRecovery();
    await incidents.resolve();
    incidents.mainAttempt(700, 2);
    const boundary = incidents.calls.length;
    await incidents.recordFailure(700, 2);
    expect(incidents.issue().state).toBe('open');
    const writes = incidents.calls.slice(boundary).filter(call => /^(POST|PATCH)/.test(call.route));
    expect(writes[0]?.parameters.state).toBe('open');
    expect(writes[1]?.route).toContain('/comments');
    expect(failureCount(incidents)).toBe(2);
    expect(recoveryCount(incidents)).toBe(1);
  });

  it('does not lose the required reopen when its first API request fails', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.reviewedRecovery();
    await incidents.resolve();
    incidents.mainAttempt(700, 2);
    incidents.failReopen = true;
    await expect(incidents.recordFailure(700, 2)).rejects.toThrow('Reopen failed');
    expect(failureCount(incidents)).toBe(1);
    expect(incidents.issue().state).toBe('closed');
    await incidents.recordFailure(700, 2);
    expect(incidents.issue().state).toBe('open');
    expect(failureCount(incidents)).toBe(2);
  });

  it('appends delayed older evidence without reopening an already covered history', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.mainAttempt(700, 3);
    await incidents.recordFailure(700, 3);
    incidents.reviewedRecovery();
    await incidents.resolve(700, 702, fixSha, 'Reviewed repair covers all three recorded attempts.', 3);
    incidents.mainAttempt(700, 2);
    await incidents.recordFailure(700, 2);
    await incidents.recordFailure(700, 1);
    expect(failureCount(incidents)).toBe(3);
    expect(recoveryCount(incidents)).toBe(1);
    expect(incidents.issue().state).toBe('closed');
  });

  it('appends older unrecorded evidence without undoing a reviewed manual closure', async () => {
    const incidents = new MainBuildExamples();
    incidents.mainAttempt(700, 3);
    await incidents.recordFailure(700, 3);
    incidents.issue().state = 'closed';
    incidents.issue().state_reason = 'completed';
    incidents.mainAttempt(700, 2);
    await incidents.recordFailure(700, 2);
    expect(failureCount(incidents)).toBe(2);
    expect(incidents.comments()[0]).toContain('"run_attempt":2');
    expect(incidents.issue().state).toBe('closed');
  });
  it('covers only failed attempts actually recorded in the issue', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.mainAttempt(700, 4);
    incidents.reviewedRecovery();
    await incidents.resolve();
    expect(incidents.comments()[0]).toContain('"covered_attempt":1');
    await incidents.recordFailure(700, 4);
    expect(incidents.issue().state).toBe('open');
  });

  it('refuses an old resolution request after another failed attempt is recorded', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.reviewedRecovery();
    await incidents.resolve();
    incidents.mainAttempt(700, 2);
    await incidents.recordFailure(700, 2);
    await expect(incidents.resolve()).rejects.toThrow('reviewed failed attempt');
    expect(incidents.issue().state).toBe('open');
    expect(recoveryCount(incidents)).toBe(1);
  });
  it('permits another reviewed resolution after a higher recorded failure', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.reviewedRecovery();
    await incidents.resolve();
    incidents.mainAttempt(700, 2);
    await incidents.recordFailure(700, 2);
    await incidents.resolve(700, 702, fixSha, 'Fresh review explicitly covers the second failed attempt.', 2);
    expect(recoveryCount(incidents)).toBe(2);
    expect(incidents.comments().at(-1)).toContain('"covered_attempt":2');
    expect(incidents.issue().state).toBe('closed');
  });

  it('does not adopt an ordinary bug report such as the unresolved cleanup incident', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.issue().body = 'Cleanup hook timeout; root cause unknown.';
    await expect(resolveMainFailure(incidents.github, {
      repository, issueNumber: 100, failedAttempt: 1, fixSha, recoveryRunId: 702, rationale: 'A later build passed.', actor: 'delivery-reviewer',
    })).rejects.toThrow('Only a managed');
    expect(incidents.issues[0]!.state).toBe('open');
  });

  it('requires an explicit cause and fix rationale', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    await expect(incidents.resolve(700, 702, fixSha, ' ')).rejects.toThrow('rationale');
    expect(incidents.issue().state).toBe('open');
  });

  it('keeps rationale markup from impersonating trusted evidence markers', async () => {
    const incidents = new MainBuildExamples();
    await incidents.openFailure();
    incidents.reviewedRecovery();
    await incidents.resolve(700, 702, fixSha, 'Fixed handle. <!-- expec-main-build-failure {} -->');
    expect(failureCount(incidents)).toBe(1);
    await incidents.resolve();
    expect(recoveryCount(incidents)).toBe(1);
  });
});
