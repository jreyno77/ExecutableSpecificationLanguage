import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { ConfigurationReader, ProjectConnector, ProjectInitializer, TypeScriptContext, TypeScriptProject } from '../../../../src/index.js';

async function chosenProject(excludePaths: readonly string[]) {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'expec-policy-starter-')));
  onTestFinished(async () => {
    if (await fs.realpath(directory) !== directory || !directory.startsWith(await fs.realpath(tmpdir()) + sep)) throw Error('Unexpected cleanup root.');
    await fs.rm(directory, { recursive: true, force: true });
  });
  const read = new ConfigurationReader([]).read({ sourceId: 'settings', text: JSON.stringify({ formatVersion: 1,
    version: '0.1.0', project: { root: 'project', excludePaths }, build: { entries: ['book.expec'] } }) });
  if (!read.value) throw Error(JSON.stringify(read.problems));
  return { directory, configuration: read.value, manifest: join(directory, 'expec.json'), root: join(directory, 'project') };
}

describe('capture policy in a chosen TypeScript project', () => {
  it('keeps the configured artifact folders in an independent TypeScript starter preview', async () => {
    const { configuration, directory, manifest } = await chosenProject(['dist', 'generation/tooling']);
    const before = structuredClone(configuration);
    const prepared = await new ProjectInitializer(manifest, configuration).prepare({ root: 'new-project', target: 'typescript' });
    expect(prepared.problems).toEqual([]);
    expect(prepared.value?.configuration.project).toEqual({ root: 'new-project', excludePaths: ['dist', 'generation/tooling'] });
    expect(configuration).toEqual(before);
    await expect(fs.lstat(join(directory, 'new-project'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports its created root but applies no starter files when src is excluded', async () => {
    const { configuration, manifest, root } = await chosenProject(['src']);
    const initializer = new ProjectInitializer(manifest, configuration);
    const prepared = await initializer.prepare({ root: 'project', target: 'typescript' });
    expect(prepared.problems).toEqual([]);
    expect(prepared.value?.configuration.project).toEqual({ root: 'project', excludePaths: ['src'] });
    const result = await initializer.apply(prepared.value!, true);
    expect(result.status).toBe('stopped');
    expect(result.value).toBeUndefined();
    expect(result.createdRoot).toBe(root);
    expect((await fs.lstat(root)).isDirectory()).toBe(true);
    expect(result.write?.status).toBe('stopped');
    expect(result.write?.problems.map(problem => problem.code)).toContain('invalid-change');
    expect(result.write?.outcomes.map(outcome => outcome.state)).toEqual(['not-applied', 'not-applied', 'not-applied', 'not-applied']);
    await expect(fs.lstat(join(root, 'src/index.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(join(root, 'package.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(join(root, 'tsconfig.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports an excluded selected tsconfig as unavailable instead of using default settings', async () => {
    const { configuration, manifest, root } = await chosenProject(['tsconfig.json']);
    await fs.mkdir(root);
    const book = 'export interface Book { title: string }\n';
    const settings = '{ "compilerOptions": { "strict": true }, "files": ["book.ts"] }\n';
    await fs.writeFile(join(root, 'book.ts'), book);
    await fs.writeFile(join(root, 'tsconfig.json'), settings);
    const connected = await new ProjectConnector(manifest).connect(configuration);
    expect(connected.problems).toEqual([]);
    if (connected.value?.status !== 'connected') throw Error('Expected the chosen project to connect.');
    const snapshot = await new TypeScriptContext(connected.value.context, { configFile: 'tsconfig.json' }).readSnapshot();
    expect(snapshot.excludePaths).toEqual(['tsconfig.json']);
    expect(snapshot.files.map(file => file.path)).toEqual(['book.ts']);
    expect(snapshot.excluded).toEqual(['tsconfig.json']);
    expect(snapshot.complete).toBe(false);
    expect(snapshot.problems).toContainEqual(expect.objectContaining({ code: 'native-input-unavailable', message: 'The configured TypeScript file was not captured.' }));
    const query = new TypeScriptProject({ outputId: 'typescript', configFile: 'tsconfig.json' }, [{ specId: 'book', locator: {
      outputId: 'typescript', format: 'typescript-symbol-1', value: { file: 'book.ts', declaration: [{ kind: 'interface', name: 'Book' }] },
    } }]);
    const read = query.read('book', snapshot);
    expect(read.coverage.complete).toBe(false);
    expect(read.problems.map(problem => problem.code)).toContain('missing-project-config');
    expect(read.coverage.scope).toContainEqual(expect.objectContaining({ format: 'typescript-scope-1', value: expect.objectContaining({ configFile: 'tsconfig.json', excludePaths: ['tsconfig.json'] }) }));
    expect(await fs.readFile(join(root, 'book.ts'), 'utf8')).toBe(book);
    expect(await fs.readFile(join(root, 'tsconfig.json'), 'utf8')).toBe(settings);
  });
});
