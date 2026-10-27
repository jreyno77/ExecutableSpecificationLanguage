import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from '../../../src/cli/cli-build.js';
import type { CheckedManifest } from '../../../src/cli/cli-check.js';
import { ConfigurationReader } from '../../../src/project/connection/configuration.js';
import type { ProjectContext, ProjectSnapshot } from '../../../src/project/connection/project-connection.js';
import { Outputs } from '../../../src/project/output/output.js';

const root = { path: join(tmpdir(), 'supplied-initial-project'), identity: 'supplied-project' };
function incomplete(code: string): ProjectSnapshot {
  return { root, complete: false, files: [], excluded: [], excludeNames: [],
    problems: [{ code, message: code, at: { kind: 'dependency', path: ['project', root.path] }, related: [] }] };
}
function initialBuild(project: ProjectContext) {
  const configuration = new ConfigurationReader([]).read({ sourceId: 'supplied-manifest', text: JSON.stringify({
    formatVersion: 1, version: '0.2.0', project: { root: '.' }, build: { entries: ['unused.expec'] },
  }) }).value!;
  const checked: CheckedManifest = { manifest: join(root.path, 'expec.json'), configuration,
    captures: [], problems: [], syntax: [], deferred: [] };
  return build(checked, project, new Outputs(), new Set(), new AbortController().signal);
}

describe('initial CLI project capture', () => {
  it('uses the supplied ordinary snapshot when no capture operation exists', async () => {
    const observed = incomplete('ordinary-snapshot-refused'), calls: string[] = [];
    const project: ProjectContext = { root, async readSnapshot() { calls.push('ordinary'); return observed; } };
    const result = await initialBuild(project);
    expect(result.exitCode).toBe(1);
    expect(result.problems).toEqual(observed.problems);
    expect(calls).toEqual(['ordinary']);
  });

  it('retains an incomplete explicit capture without falling back to an ordinary read', async () => {
    const observed = incomplete('initial-capture-refused'), calls: string[] = [];
    const project: ProjectContext & { captureSnapshot(): Promise<ProjectSnapshot> } = {
      root, async captureSnapshot() { calls.push('capture'); return observed; },
      async readSnapshot() { calls.push('ordinary'); return incomplete('would-hide-capture-failure'); },
    };
    const result = await initialBuild(project);
    expect(result.exitCode).toBe(1);
    expect(result.problems).toEqual(observed.problems);
    expect(calls).toEqual(['capture']);
  });

  it('propagates an explicit capture rejection without retrying through ordinary reads', async () => {
    const failure = Error('Capture did not produce a snapshot.'), calls: string[] = [];
    const project: ProjectContext & { captureSnapshot(): Promise<ProjectSnapshot> } = {
      root, async captureSnapshot() { calls.push('capture'); throw failure; },
      async readSnapshot() { calls.push('ordinary'); return incomplete('would-hide-capture-rejection'); },
    };
    await expect(initialBuild(project)).rejects.toBe(failure);
    expect(calls).toEqual(['capture']);
  });
});
