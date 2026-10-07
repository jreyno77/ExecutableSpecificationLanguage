import { describe, expect, it } from 'vitest';
import { PythonProject, type ProjectSnapshot } from '../../../../src/index.js';

describe('Python project query prerequisites', () => {
  it('explains an incomplete supplied capture before native analysis', async () => {
    const project = new PythonProject({ outputId: 'python' }, []);
    const snapshot: ProjectSnapshot = { root: { path: process.cwd(), identity: 'caller' }, complete: false, problems: [], files: [], excluded: [], excludeNames: [] };
    const result = await project.search('game', snapshot);
    expect(result.incoming.coverage.complete).toBe(false);
    expect(result.problems.map(problem => problem.code)).toContain('incomplete-project');
  });
});
