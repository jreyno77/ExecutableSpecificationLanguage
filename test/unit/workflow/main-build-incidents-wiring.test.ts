import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../../../.github/workflows/main-build-incidents.yml', import.meta.url), 'utf8');

describe('native main-build incident workflow', () => {
  it('accepts completed main runs and explicit reviewed-fix inputs', () => {
    expect(workflow).toContain('workflows: [Build and test]');
    expect(workflow).toContain('types: [completed]');
    expect(workflow).toContain('branches: [main]');
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    expect(workflow).toContain('github.event.workflow_run.head_repository.full_name == github.repository');
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'timed_out'");
    for (const input of ['issue', 'failed_attempt', 'fix_sha', 'recovery_run', 'rationale'])
      expect(workflow).toMatch(new RegExp('      ' + input + ':\\n        description: [^\\n]+\\n        type: string\\n        required: true'));
  });

  it('uses trusted main code with limited native permissions and a non-replacing queue', () => {
    expect(workflow).toContain("context.eventName === 'workflow_dispatch' && context.ref !== 'refs/heads/main'");
    expect(workflow).toContain('ref: main');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).not.toContain('ref: ${{ github.event.workflow_run.head_sha }}');
    expect(workflow).toContain('permissions:\n  contents: read\n  actions: read\n  issues: write');
    expect(workflow).toContain('group: main-build-incidents\n  cancel-in-progress: false\n  queue: max');
    expect(workflow).not.toMatch(/deployments:|contents: write|npm |setup-java|setup-node/);
    expect(workflow).toContain('actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3');
  });

  it('calls the reviewed operations with data inputs and the authenticated actor', () => {
    expect(workflow).toContain("/.github/ci/main-build-incidents.ts");
    expect(workflow).toContain('await recordMainFailure(github, { repository, workflowRun: context.payload.workflow_run })');
    expect(workflow).toContain('await resolveMainFailure(github, {');
    expect(workflow).toContain('issueNumber: Number(process.env.INCIDENT_ISSUE)');
    expect(workflow).toContain('failedAttempt: Number(process.env.FAILED_ATTEMPT)');
    expect(workflow).toContain('fixSha: process.env.FIX_SHA, recoveryRunId: Number(process.env.RECOVERY_RUN)');
    expect(workflow).toContain('rationale: process.env.RATIONALE, actor: context.actor');
    const script = workflow.split('      - name: Record failure or reviewed recovery')[1]!.split('          script: |')[1]!;
    expect(script).not.toContain('${{');
  });
});
