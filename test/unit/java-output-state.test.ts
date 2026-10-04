import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Compiler, SpecificationIdentity, javaOutput, type ProjectSnapshot } from '../../src/index.js';

const generated = 'package store; public class Store {}\n';
const artifact = { specId: 'store', locator: { outputId: 'java', format: 'java-symbol-1', value: { file: 'src/main/java/store/Store.java', type: 'store.Store' } } };
const record = { path: 'src/main/java/store/Store.java', generated, hash: createHash('sha256').update(generated).digest('hex'), artifacts: [artifact] };
async function plan(recording: Record<string, unknown>) {
  const checked = new Compiler().compile({ locator: 'main', source: { sourceId: 'main.expec', text: 'class Store {}' }, dependencies: { modules: [], packages: [] } });
  if (!checked.value) throw new Error(JSON.stringify(checked));
  const current = new SpecificationIdentity(() => 'store').associate(checked.value);
  if (!current.value) throw new Error(JSON.stringify(current));
  const bytes = Buffer.from(JSON.stringify({ format: 1, options: { package: 'store' }, files: [recording] }));
  const snapshot: ProjectSnapshot = { root: { path: join(tmpdir(), 'java-state'), identity: 'fixture' }, complete: true, problems: [], excludeNames: [], excluded: [],
    files: [{ path: '.expec/outputs/java.json', bytes, version: createHash('sha256').update(bytes).digest('hex') }] };
  return javaOutput.open({ package: 'store' }).plan({ operation: 'create', current: current.value }, snapshot);
}
async function expectRefused(recording: Record<string, unknown>) {
  const result = await plan(recording);
  expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('invalid-output-state');
}
describe('Java recorded native ownership', () => {
  it('refuses an unsupported native selector in recorded ownership', async () => {
    await expectRefused({ ...record, artifacts: [{ ...artifact, locator: { ...artifact.locator, format: 'future-java-9' } }] });
  });
  it('refuses two different identities claiming the same native declaration', async () => {
    await expectRefused({ ...record, artifacts: [artifact, { ...artifact, specId: 'another-store' }] });
  });
  it('refuses a malformed parameter claim without a callable', async () => {
    await expectRefused({ ...record, artifacts: [{ ...artifact, locator: { ...artifact.locator, value: { ...artifact.locator.value, parameter: 0 } } }] });
  });
  it('refuses a foreign output in the generated comparison baseline', async () => {
    await expectRefused({ ...record, renderedArtifacts: [{ ...artifact, locator: { ...artifact.locator, outputId: 'typescript' } }] });
  });
  it('refuses an adopted identity absent from its recorded native declarations', async () => {
    await expectRefused({ ...record, adopted: ['unowned-method'] });
  });
  it('refuses generated text whose saved digest no longer matches', async () => {
    await expectRefused({ ...record, generated: generated + '// changed' });
  });
});
