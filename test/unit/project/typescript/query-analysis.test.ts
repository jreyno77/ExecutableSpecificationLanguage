import { afterEach, describe, expect, it } from 'vitest';
import { QueryAnalysis } from '../../../dsl/project/typescript/query-analysis.js';

afterEach(() => QueryAnalysis.clean());
const source = 'export class Store {}';

function questions(bytes: Uint8Array = Buffer.from(source)): QueryAnalysis {
  const project = new QueryAnalysis({ 'store.ts': bytes });
  project.selectClass('store', 'store.ts', 'Store'); project.observePreparation(); return project;
}

describe('exact captured inputs for native query preparation', () => {
  it('reuses equal visible Buffer and Uint8Array slices with different backing bytes', async () => {
    const first = Buffer.from('prefix' + source + 'suffix').subarray(6, 6 + Buffer.byteLength(source));
    const project = questions(first);
    await project.read('store'); project.expectCompleteRead();

    const next = new Uint8Array(Buffer.from('other-prefix' + source + 'other-suffix')).subarray(12, 12 + Buffer.byteLength(source));
    project.driver.replaceBytes('store.ts', next);
    await project.read('store'); project.expectCompleteRead();
    project.expectReadFile('store.ts', source);

    project.expectPreparations(1);
  });

  it('prepares changed visible bytes despite an unchanged declared version', async () => {
    const project = questions();
    await project.read('store'); project.expectCompleteRead();

    project.driver.replaceBytes('store.ts', Buffer.from('paddingexport class Changed {}tail').subarray(7, 7 + Buffer.byteLength('export class Changed {}')), true);
    await project.read('store');
    project.expectProblem('missing-project-symbol', 'store.ts');

    project.expectPreparations(2);
  });

  it('normalizes accepted class metadata like structuredClone without copying body identity into the key', async () => {
    class Note { constructor(readonly value: string) {} method(): string { return 'not captured'; } }
    const project = questions();
    Object.assign(project.driver.snapshot, { note: new Note('one') });
    await project.read('store'); project.expectCompleteRead();

    Object.assign(project.driver.snapshot, { note: { value: 'one' } });
    await project.read('store'); project.expectCompleteRead();
    project.expectReadFile('store.ts', source);

    project.expectPreparations(1);
  });

  it('distinguishes missing metadata from an explicitly undefined property', async () => {
    const project = questions();
    await project.read('store'); project.expectCompleteRead();

    Object.assign(project.driver.snapshot, { note: undefined });
    await project.read('store'); project.expectCompleteRead();

    project.expectPreparations(2);
  });

  it('rechecks changed root, exclusions, native facts and declared provenance', async () => {
    const project = questions();
    await project.read('store'); project.expectCompleteRead();

    project.driver.snapshot = { ...project.driver.snapshot, root: { ...project.driver.snapshot.root, identity: 'other-root' } };
    await project.read('store'); project.expectCompleteRead(); project.expectPreparations(2);
    project.driver.snapshot = { ...project.driver.snapshot, excluded: ['unavailable'], excludeNames: ['generated'] };
    await project.read('store'); project.expectCompleteRead(); project.expectPreparations(3);
    project.driver.snapshot = { ...project.driver.snapshot, nativeInputs: [{ uri: 'file:///declared-input', version: '1'.repeat(64) }] };
    await project.read('store'); project.expectCompleteRead(); project.expectPreparations(4);
    project.driver.snapshot = { ...project.driver.snapshot, files: project.driver.snapshot.files.map(file => ({ ...file, version: '2'.repeat(64) })) };
    await project.read('store'); project.expectCompleteRead();
    expect(project.driver.readResult.artifacts[0]!.file.version).toBe('2'.repeat(64));
    project.expectPreparations(5);
  });

  it('retains invalid read-only hash rejection after an earlier successful query', async () => {
    const project = questions();
    project.driver.nativeDeclaration('node_modules/catalog/index.d.ts', 'export interface Book { copies: number }');
    await project.read('store'); project.expectCompleteRead();

    project.driver.nativeDeclaration('node_modules/catalog/index.d.ts', 'export interface Book { copies: string }', true);
    await expect(project.read('store')).rejects.toThrow(TypeError);

    project.driver.nativeDeclaration('node_modules/catalog/index.d.ts', 'export interface Book { copies: string }');
    await project.read('store'); project.expectCompleteRead();
    project.expectReadFile('store.ts', source);
  });
});
