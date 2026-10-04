import { afterEach, describe, expect, it } from 'vitest';
import { pythonOutput, type ArtifactLocator } from '../../src/index.js';
import { PythonOutputDriver } from '../driver/python-output.js';

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
  it('does not replace an explicitly selected declaration with a same-file name guess', async () => {
    const planned = await adoption({ file: 'src/store.py', declaration: [{ kind: 'class', name: 'Other' }] });
    expect(planned.value).toBeUndefined(); expect(planned.problems.map(problem => problem.code)).toContain('invalid-native-mapping');
  });
  it('does not treat a whole-file association as an exact class declaration', async () => {
    const planned = await adoption({ file: 'src/store.py' }, 'python-file-1');
    expect(planned.value).toBeUndefined(); expect(planned.problems.map(problem => problem.code)).toContain('invalid-native-mapping');
  });
});
