import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { ConfigurationReader, FileProjectWriter, ProjectInitializer, type Configuration } from '../../../../src/index.js';

async function chosenProject(packages: Configuration['packages'] = []) {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'expec-init-unit-')));
  onTestFinished(async () => {
    if (await fs.realpath(directory) !== directory || !directory.startsWith(await fs.realpath(tmpdir()) + sep)) throw new Error('Unexpected cleanup root.');
    await fs.rm(directory, { recursive: true, force: true });
  });
  const configuration = new ConfigurationReader([]).read({ sourceId: 'settings', text: JSON.stringify({ formatVersion: 1,
    version: '0.1.0', build: { entries: ['store.expec'] }, packages }) }).value!;
  return { directory, configuration, initializer: new ProjectInitializer(join(directory, 'expec.json'), configuration) };
}
describe('an initialization preview belongs to one explicit application', () => {
  it('does not report an earlier creation as an effect of a rejected repeat', async () => {
    const { initializer } = await chosenProject();
    const prepared = await initializer.prepare({ root: 'project', target: 'typescript' });
    const applied = await initializer.apply(prepared.value!, true);
    expect(applied.status).toBe('applied');
    expect(applied.createdRoot).toBeDefined();
    const repeated = await initializer.apply(prepared.value!, true);
    expect(repeated.status).toBe('stopped');
    expect(repeated.problems.map(problem => problem.code)).toContain('initialization-already-attempted');
    expect(repeated.createdRoot).toBeUndefined();
    expect(repeated.write).toBeUndefined();
  });
});

describe('initialization caller boundaries', () => {
  it('rejects a relative manifest and malformed configuration before filesystem work', async () => {
    const { directory, configuration } = await chosenProject();
    expect(() => new ProjectInitializer('expec.json', configuration)).toThrow(TypeError);
    expect(() => new ProjectInitializer(join(directory, 'expec.json'), { ...configuration, version: 42 } as unknown as Configuration)).toThrow(TypeError);
    expect(() => new ProjectInitializer(join(directory, 'expec.json'), { ...configuration, version: '0.1.0', extra: undefined } as Configuration)).toThrow(TypeError);
    expect(await fs.readdir(directory)).toEqual([]);
  });
  it('rejects an empty or invalid native destination without preparing a plan', async () => {
    const { initializer, directory } = await chosenProject();
    await expect(initializer.prepare({ root: '', target: 'typescript' })).rejects.toThrow(TypeError);
    await expect(initializer.prepare({ root: 'project\0bad', target: 'typescript' })).rejects.toThrow(TypeError);
    if (process.platform === 'win32') await expect(initializer.prepare({ root: 'C:project', target: 'typescript' })).rejects.toThrow(TypeError);
    expect(await fs.readdir(directory)).toEqual([]);
  });
  it('refuses a copied or foreign preview without consuming the genuine preview', async () => {
    const { initializer, directory, configuration } = await chosenProject();
    const plan = (await initializer.prepare({ root: 'project', target: 'typescript' })).value!;
    await expect(initializer.apply(structuredClone(plan), true)).rejects.toThrow(TypeError);
    await expect(new ProjectInitializer(join(directory, 'expec.json'), configuration).apply(plan, true)).rejects.toThrow(TypeError);
    expect(await fs.readdir(directory)).toEqual([]);
    expect((await initializer.apply(plan, true)).status).toBe('applied');
  });
  it('requires an actual boolean decision and AbortSignal', async () => {
    const { initializer, directory } = await chosenProject();
    const plan = (await initializer.prepare({ root: 'project', target: 'typescript' })).value!;
    await expect(initializer.apply(plan, 1 as unknown as boolean)).rejects.toThrow(TypeError);
    await expect(initializer.apply(plan, true, { aborted: false } as AbortSignal)).rejects.toThrow(TypeError);
    expect(await fs.readdir(directory)).toEqual([]);
  });
  it('allows acceptance after a decline and returns independent configuration data', async () => {
    const { initializer } = await chosenProject();
    const plan = (await initializer.prepare({ root: 'project', target: 'typescript' })).value!;
    const declined = await initializer.apply(plan, false);
    expect(declined).toEqual({ status: 'declined', problems: [], deferred: [] });
    const applied = await initializer.apply(plan, true);
    expect(applied.status).toBe('applied');
    Object.assign(applied.value!.configuration, { version: '9.9.9' });
    expect(plan.configuration.version).toBe('0.1.0');
    expect(declined).toEqual({ status: 'declined', problems: [], deferred: [] });
  });
  it('admits one simultaneous accepted application without duplicating effects', async () => {
    const { initializer } = await chosenProject();
    const plan = (await initializer.prepare({ root: 'project', target: 'typescript' })).value!;
    const [first, second] = await Promise.all([initializer.apply(plan, true), initializer.apply(plan, true)]);
    expect(first.status).toBe('applied');
    expect(second.status).toBe('stopped');
    expect(second.problems.map(problem => problem.code)).toContain('initialization-already-attempted');
    expect(second.createdRoot).toBeUndefined(); expect(second.write).toBeUndefined();
    expect((await first.value!.context.readSnapshot()).files.map(file => file.path)).toEqual(['.gitignore', 'package.json', 'src/index.ts', 'tsconfig.json']);
  });
});

describe('initialization checks the selected filesystem identity', () => {
  it('keeps a valid parent alias and a Unicode destination usable', async () => {
    const { initializer, directory } = await chosenProject();
    await fs.mkdir(join(directory, 'real'));
    await fs.symlink(join(directory, 'real'), join(directory, 'games'), process.platform === 'win32' ? 'junction' : 'dir');
    const plan = (await initializer.prepare({ root: 'games/Store 📚 Game', target: 'typescript' })).value!;
    const result = await initializer.apply(plan, true);
    expect(result.status).toBe('applied');
    expect(result.value!.context.root.path).toBe(await fs.realpath(join(directory, 'real', 'Store 📚 Game')));
    expect(result.createdRoot).toBe(join(directory, 'games', 'Store 📚 Game'));
  });
  it('refuses a parent alias redirected after the preview', async () => {
    const { initializer, directory } = await chosenProject();
    await fs.mkdir(join(directory, 'first')); await fs.mkdir(join(directory, 'second'));
    const route = join(directory, 'games');
    await fs.symlink(join(directory, 'first'), route, process.platform === 'win32' ? 'junction' : 'dir');
    const plan = (await initializer.prepare({ root: 'games/project', target: 'typescript' })).value!;
    await fs.unlink(route); await fs.symlink(join(directory, 'second'), route, process.platform === 'win32' ? 'junction' : 'dir');
    const result = await initializer.apply(plan, true);
    expect(result.problems.map(problem => problem.code)).toContain('destination-changed');
    expect(result.createdRoot).toBeUndefined(); expect(result.write).toBeUndefined();
    expect(await fs.readdir(join(directory, 'first'))).toEqual([]); expect(await fs.readdir(join(directory, 'second'))).toEqual([]);
  });
  it('does not invalidate a chosen child when an unrelated sibling changes', async () => {
    const { initializer, directory } = await chosenProject();
    const plan = (await initializer.prepare({ root: 'project', target: 'typescript' })).value!;
    await fs.writeFile(join(directory, 'notes.txt'), 'Keep me.');
    expect((await initializer.apply(plan, true)).status).toBe('applied');
    expect(await fs.readFile(join(directory, 'notes.txt'), 'utf8')).toBe('Keep me.');
  });
  it('refuses a directory containing only an empty child', async () => {
    const { initializer, directory } = await chosenProject();
    await fs.mkdir(join(directory, 'project', 'empty'), { recursive: true });
    const result = await initializer.prepare({ root: 'project', target: 'typescript' });
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('initialization-root-not-empty');
    expect(await fs.readdir(join(directory, 'project'))).toEqual(['empty']);
  });
  it('keeps the created directory when connecting it subsequently fails', async () => {
    const { initializer, directory } = await chosenProject();
    const plan = (await initializer.prepare({ root: 'project', target: 'typescript' })).value!;
    const realpath = fs.realpath.bind(fs), target = join(directory, 'project');
    const fault = vi.spyOn(fs, 'realpath').mockImplementation(async (...args) => {
      if (String(args[0]) === target) throw Object.assign(Error('Connection denied'), { code: 'EACCES' });
      return realpath(...args);
    });
    onTestFinished(() => fault.mockRestore());
    const result = await initializer.apply(plan, true);
    expect(result.status).toBe('stopped'); expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('initialization-connection-failed');
    expect(result.createdRoot).toBe(target); expect(result.write).toBeUndefined();
    expect(await fs.readdir(target)).toEqual([]);
  });
});

describe('initialization receipts describe actual incomplete work', () => {
  it('retains the real partial writer outcome after cancellation during a write', async () => {
    const { initializer, directory } = await chosenProject(), controller = new AbortController();
    const plan = (await initializer.prepare({ root: 'project', target: 'typescript' })).value!;
    const open = fs.open.bind(fs), destination = join(directory, 'project');
    const fault = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (String(args[0]) === join(destination, 'package.json') && args[1] === 'wx') {
        const write = handle.writeFile.bind(handle);
        vi.spyOn(handle, 'writeFile').mockImplementation(async (...values) => { await write(...values); controller.abort(); });
      }
      return handle;
    });
    onTestFinished(() => fault.mockRestore());
    const result = await initializer.apply(plan, true, controller.signal);
    expect(result.status).toBe('stopped'); expect(result.value).toBeUndefined();
    expect(result.createdRoot).toBe(destination);
    expect(result.write?.status).toBe('stopped');
    expect(result.write?.outcomes.map(outcome => outcome.state)).toEqual(['applied', 'not-applied', 'not-applied', 'not-applied']);
    expect(result.problems.map(problem => problem.code)).toContain('write-cancelled');
    expect(JSON.parse(await fs.readFile(join(destination, 'package.json'), 'utf8')).private).toBe(true);
    await expect(fs.lstat(join(destination, 'tsconfig.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('does not turn an applied writer receipt into a connected replacement directory', async () => {
    const { initializer, directory } = await chosenProject();
    const plan = (await initializer.prepare({ root: 'project', target: 'typescript' })).value!;
    const apply = FileProjectWriter.prototype.apply, destination = join(directory, 'project'), previous = join(directory, 'previous');
    const boundary = vi.spyOn(FileProjectWriter.prototype, 'apply').mockImplementation(async function(this: FileProjectWriter, input, signal) {
      const actual = await apply.call(this, input, signal);
      expect(actual.status).toBe('applied');
      await fs.rename(destination, previous); await fs.mkdir(destination);
      return actual;
    });
    onTestFinished(() => boundary.mockRestore());
    const result = await initializer.apply(plan, true);
    expect(result.status).toBe('stopped'); expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('destination-changed');
    expect(result.createdRoot).toBe(destination); expect(result.write?.status).toBe('applied');
    expect(result.write?.outcomes.map(outcome => outcome.state)).toEqual(['applied', 'applied', 'applied', 'applied']);
    expect(await fs.readdir(destination)).toEqual([]);
    expect(await fs.readFile(join(previous, 'src', 'index.ts'), 'utf8')).toBe('export {};\n');
  });
  it('retains the writer cleanup failure after all starter bytes were applied', async () => {
    const { initializer, directory } = await chosenProject();
    const plan = (await initializer.prepare({ root: 'project', target: 'typescript' })).value!;
    const unlink = fs.unlink.bind(fs), marker = join(directory, 'project', '.expec', 'write.lock');
    const fault = vi.spyOn(fs, 'unlink').mockImplementation(async path => {
      if (String(path) === marker) throw Object.assign(Error('Cleanup denied'), { code: 'EACCES' });
      return unlink(path);
    });
    onTestFinished(() => fault.mockRestore());
    const result = await initializer.apply(plan, true);
    expect(result.status).toBe('stopped'); expect(result.value).toBeUndefined();
    expect(result.write?.status).toBe('stopped');
    expect(result.write?.outcomes.map(outcome => outcome.state)).toEqual(['applied', 'applied', 'applied', 'applied']);
    expect(result.problems.map(problem => problem.code)).toContain('cleanup-failed');
    expect(result.write?.temporaryPaths).toEqual(['.expec/write.lock']);
    expect((await fs.lstat(marker)).isFile()).toBe(true);
  });
});

describe('the selected starter toolchain', () => {
  it('refuses a different exact compiler before offering a plan', async () => {
    const { initializer, directory } = await chosenProject([{ alias: 'compiler', name: 'npm:typescript', version: '6.0.0', phases: ['build'] }]);
    const prepared = await initializer.prepare({ root: 'project', target: 'typescript' });
    expect(prepared.value).toBeUndefined();
    expect(prepared.problems.map(problem => problem.code)).toContain('unsupported-initialization-toolchain');
    expect(await fs.readdir(directory)).toEqual([]);
  });
  it('refuses test-only compiler availability as the starter build requirement', async () => {
    const { initializer } = await chosenProject([{ alias: 'compiler', name: 'npm:typescript', version: '5.9.3', phases: ['test'] }]);
    const prepared = await initializer.prepare({ root: 'project', target: 'typescript' });
    expect(prepared.value).toBeUndefined();
    expect(prepared.problems.map(problem => problem.code)).toContain('unsupported-initialization-toolchain');
  });
  it('retains agreeing physical compiler aliases and their author-supplied phases', async () => {
    const packages: Configuration['packages'] = [
      { alias: 'build-compiler', name: 'npm:typescript', version: '5.9.3', phases: ['build'] },
      { alias: 'runtime-compiler', name: 'npm:typescript', version: '5.9.3', phases: ['runtime', 'test'] },
    ];
    const { initializer, configuration } = await chosenProject(packages);
    const prepared = await initializer.prepare({ root: 'project', target: 'typescript' });
    expect(prepared.problems).toEqual([]);
    expect(prepared.value?.configuration.packages).toEqual(packages);
    expect(configuration.packages).toEqual(packages);
  });
});
