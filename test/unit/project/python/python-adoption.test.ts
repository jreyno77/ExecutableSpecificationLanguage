import { afterEach, describe, expect, it } from 'vitest';
import { pythonOutput, type ArtifactLocator } from '../../../../src/index.js';
import { PythonOutputDriver } from '../../../driver/project/python/python-output.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const projects: PythonOutputDriver[] = [];
afterEach(async () => { for (const project of projects.splice(0)) await project.dispose(); });
async function adoption(value: ArtifactLocator['value'], format = 'python-symbol-1') {
  const project = new PythonOutputDriver(); projects.push(project); await project.initialize(); project.source('class StoreGame {}');
  const store = [...project.current.specification.inspection.query('class')][0]!;
  const selected = project.identity.withArtifacts(project.current, [{ specId: project.current.id(store.id), locator: { outputId: 'python', format, value } }]);
  if (!selected.value) throw new Error(JSON.stringify(selected));
  return pythonOutput.open({ module: 'store.contracts', adoptExisting: true }).plan({ operation: 'create', current: selected.value }, await project.context.readSnapshot());
}

describe('explicit Python adoption selectors', () => {
  it('rejects whole-file selectors in saved declaration ownership before native analysis', async () => {
    const project = new PythonOutputDriver(); projects.push(project); await project.initialize(); project.source('class StoreGame {}'); await project.build();
    expect(project.written.problems).toEqual([]);
    const path = '.expec/outputs/707974686f6e.json', state = JSON.parse(await fs.readFile(join(project.root, path), 'utf8'));
    state.artifacts[0].locator = { outputId: 'python', format: 'python-file-1', value: { file: 'src/store/contracts.py' } };
    await project.file(path, JSON.stringify(state));
    const planned = await pythonOutput.open({ module: 'store.contracts' }).plan({ operation: 'create', current: project.current }, await project.context.readSnapshot());
    expect(planned.value).toBeUndefined(); expect(planned.problems.map(problem => problem.code)).toContain('invalid-output-state');
  });
  it('does not replace an explicitly selected declaration with a same-file name guess', async () => {
    const planned = await adoption({ file: 'src/store.py', declaration: [{ kind: 'class', name: 'Other' }] });
    expect(planned.value).toBeUndefined(); expect(planned.problems.map(problem => problem.code)).toContain('invalid-native-mapping');
  });
  it('does not treat a whole-file association as an exact class declaration', async () => {
    const planned = await adoption({ file: 'src/store.py' }, 'python-file-1');
    expect(planned.value).toBeUndefined(); expect(planned.problems.map(problem => problem.code)).toContain('invalid-native-mapping');
  });
});
