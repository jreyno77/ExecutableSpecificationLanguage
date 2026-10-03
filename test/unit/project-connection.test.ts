import { createServer } from 'node:net';
import { promises as fs } from 'node:fs';
import { appendFile, mkdir, mkdtemp, lstat, readFile, realpath, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Check } from '../../src/checking.js';
import { ConfigurationReader } from '../../src/configuration.js';
import { ProjectConnector, type ProjectConnection, type ProjectContext } from '../../src/project-connection.js';

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'expec-connection-')); });
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('expec-connection-')) {
    throw new Error(`Refusing to remove a directory outside the temporary fixture: ${directory}`);
  }
  await rm(directory, { recursive: true, force: true });
});

const path = (...segments: string[]) => join(directory, ...segments);
function configuration(root: string, sourceId = 'editor:unsaved') {
  const report = new ConfigurationReader([]).read({ sourceId, text: JSON.stringify({
    formatVersion: 1, version: '0.2.0', build: { entries: ['store.expec'] }, project: { root },
  }) });
  expect(report.problems).toEqual([]);
  return report.value!;
}
async function file(name: string, contents: string | Uint8Array) {
  await mkdir(dirname(path(name)), { recursive: true });
  await writeFile(path(name), contents);
}
async function connected(connector = new ProjectConnector(path('expec.json')), root = 'game'): Promise<ProjectContext> {
  const report = await connector.connect(configuration(root));
  expect(report.problems).toEqual([]);
  expect(report.deferred).toEqual([]);
  expect(report.value?.status).toBe('connected');
  if (report.value?.status !== 'connected') throw new Error('Expected a connected project.');
  return report.value.context;
}
function connectionProblem(report: Check<ProjectConnection>, code: string, sourceId = 'editor:unsaved') {
  expect(report.value).toBeUndefined();
  expect(report.deferred).toEqual([]);
  expect(report.problems).toHaveLength(1);
  expect(report.problems[0]).toMatchObject({ code, related: [],
    at: { kind: 'dependency', path: ['manifest', sourceId, 'project', 'root'] } });
  return report.problems[0]!;
}
function afterReading(name: string, change: () => Promise<void>) {
  const open = fs.open.bind(fs);
  let arranged = false;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args);
    if (!arranged && String(args[0]) === path(name)) {
      arranged = true;
      const read = handle.readFile.bind(handle);
      vi.spyOn(handle, 'readFile').mockImplementationOnce(async (...options) => {
        const bytes = await read(...options);
        await change();
        return bytes;
      });
    }
    return handle;
  });
}

describe('ProjectConnector construction', () => {
  it('requires an absolute manifest location instead of consulting the current directory', () => {
    expect(() => new ProjectConnector('settings/expec.json')).toThrow(TypeError);
  });

  it('rejects an empty manifest location', () => {
    expect(() => new ProjectConnector('')).toThrow(TypeError);
  });

  it('rejects a manifest location containing a null byte', () => {
    expect(() => new ProjectConnector(path('expec\0.json'))).toThrow(TypeError);
  });

  it('rejects a nonstring manifest location as a programming error', () => {
    expect(() => new ProjectConnector(42 as unknown as string)).toThrow(TypeError);
  });

  it('rejects an empty exclusion name', () => {
    expect(() => new ProjectConnector(path('expec.json'), { excludeNames: [''] })).toThrow(TypeError);
  });

  it('rejects the current-directory name as an exclusion', () => {
    expect(() => new ProjectConnector(path('expec.json'), { excludeNames: ['.'] })).toThrow(TypeError);
  });

  it('rejects the parent-directory name as an exclusion', () => {
    expect(() => new ProjectConnector(path('expec.json'), { excludeNames: ['..'] })).toThrow(TypeError);
  });

  it('rejects a path instead of a single exclusion name', () => {
    expect(() => new ProjectConnector(path('expec.json'), { excludeNames: ['cache/generated'] })).toThrow(TypeError);
  });

  it('rejects duplicate exclusion names', () => {
    expect(() => new ProjectConnector(path('expec.json'), { excludeNames: ['cache', 'cache'] })).toThrow(TypeError);
  });

  it('rejects a nonstring exclusion name', () => {
    expect(() => new ProjectConnector(path('expec.json'), { excludeNames: [42 as unknown as string] })).toThrow(TypeError);
  });

  it('captures the configured exclusions before the caller changes its array or options', async () => {
    await file('game/cache/private.txt', 'excluded');
    await file('game/generated.txt', 'readable');
    const names = ['cache'], options = { excludeNames: names };
    const connector = new ProjectConnector(path('expec.json'), options);
    names[0] = 'generated.txt';
    options.excludeNames = [];

    const snapshot = await (await connected(connector)).readSnapshot();

    expect(snapshot.complete).toBe(true);
    expect(snapshot.excludeNames).toEqual(['cache']);
    expect(snapshot.excluded).toEqual(['cache']);
    expect(snapshot.files.map(item => item.path)).toEqual(['generated.txt']);
  });
});

describe('ProjectConnector native locations', () => {
  it('connects an absolute root using an unsaved manifest location', async () => {
    await mkdir(path('game'));
    const settings = configuration(path('game'));

    const report = await new ProjectConnector(path('unsaved/settings/expec.json')).connect(settings);

    expect(report.problems).toEqual([]);
    expect(report.deferred).toEqual([]);
    expect(report.value).toMatchObject({ status: 'connected', context: { root: { path: await realpath(path('game')) } } });
    expect(settings.project?.root).toBe(path('game'));
    await expect(lstat(path('unsaved'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('resolves parent segments relative to the manifest while retaining the authored spelling', async () => {
    await mkdir(path('game'));
    const settings = configuration('../unused/../game', 'editor:another-location');

    const report = await new ProjectConnector(path('settings/expec.json')).connect(settings);

    expect(report.problems).toEqual([]);
    expect(report.value).toMatchObject({ status: 'connected', context: { root: { path: await realpath(path('game')) } } });
    expect(settings.project?.root).toBe('../unused/../game');
  });

  it('treats a home-directory marker as a literal relative directory name', async () => {
    await mkdir(path('~/game'), { recursive: true });

    const context = await connected(new ProjectConnector(path('expec.json')), '~/game');

    expect(context.root.path).toBe(await realpath(path('~/game')));
  });

  it('treats an environment-variable marker as a literal directory name', async () => {
    await mkdir(path('$PROJECT_ROOT'));
    await mkdir(path('elsewhere'));
    vi.stubEnv('PROJECT_ROOT', path('elsewhere'));

    const context = await connected(new ProjectConnector(path('expec.json')), '$PROJECT_ROOT');

    expect(context.root.path).toBe(await realpath(path('$PROJECT_ROOT')));
  });

  it('locates an invalid authored root using sourceId without returning a connection value', async () => {
    const report = await new ProjectConnector(path('expec.json')).connect(configuration('game\0', 'editor:dirty-buffer'));

    connectionProblem(report, 'invalid-project-root', 'editor:dirty-buffer');
  });

  it('keeps a dangling selected directory link distinct from a missing destination', async () => {
    await symlink(path('missing'), path('selected'), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await lstat(path('selected'))).isSymbolicLink()).toBe(true);

    const report = await new ProjectConnector(path('expec.json')).connect(configuration('selected'));

    const finding = connectionProblem(report, 'root-unavailable');
    expect(finding.message).toContain('ENOENT');
    expect(finding.message).toContain(path('selected'));
  });

  it('rechecks a missing destination when it is created after the first connection attempt', async () => {
    const connector = new ProjectConnector(path('expec.json'));
    const first = await connector.connect(configuration('new/game'));
    expect(first).toEqual({ value: { status: 'unconnected', reason: 'missing-root', root: path('new/game') }, problems: [], deferred: [] });
    await expect(lstat(path('new'))).rejects.toMatchObject({ code: 'ENOENT' });
    await mkdir(path('new/game'), { recursive: true });

    const context = await connected(connector, 'new/game');

    expect(context.root.path).toBe(await realpath(path('new/game')));
    expect(first.value).toEqual({ status: 'unconnected', reason: 'missing-root', root: path('new/game') });
  });

  it('does not offer initialization beneath a dangling ancestor link', async () => {
    await symlink(path('missing'), path('selected'), process.platform === 'win32' ? 'junction' : 'dir');

    const report = await new ProjectConnector(path('expec.json')).connect(configuration('selected/game'));

    connectionProblem(report, 'root-unavailable');
  });

  it('does not offer initialization beneath a regular file', async () => {
    await file('occupied', 'keep');

    const report = await new ProjectConnector(path('expec.json')).connect(configuration('occupied/game'));

    connectionProblem(report, 'root-not-directory');
    expect(await readFile(path('occupied'), 'utf8')).toBe('keep');
  });
});

describe('ProjectSnapshot captured observations', () => {
  it('includes an empty regular file with the SHA-256 digest of zero bytes', async () => {
    await file('game/empty.txt', '');

    const snapshot = await (await connected()).readSnapshot();

    expect(snapshot.complete).toBe(true);
    expect(snapshot.files).toHaveLength(1);
    expect(snapshot.files[0]).toMatchObject({ path: 'empty.txt',
      version: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
    expect(snapshot.files[0]!.bytes).toBeInstanceOf(Uint8Array);
    expect([...snapshot.files[0]!.bytes]).toEqual([]);
  });

  it('sorts captured files and skipped paths ordinally while retaining configured policy order', async () => {
    await file('game/é.txt', 'accented');
    await file('game/a/file.txt', 'nested');
    await file('game/Z.txt', 'uppercase');
    await file('game/a-b.txt', 'hyphen');
    await file('game/z-cache', 'excluded file');
    await file('game/nested/z-cache/private.txt', 'excluded directory');
    await file('game/A-cache', 'excluded uppercase');
    const connector = new ProjectConnector(path('expec.json'), { excludeNames: ['z-cache', 'A-cache'] });

    const snapshot = await (await connected(connector)).readSnapshot();

    expect(snapshot.complete).toBe(true);
    expect(snapshot.files.map(item => item.path)).toEqual(['Z.txt', 'a-b.txt', 'a/file.txt', 'é.txt']);
    expect(snapshot.excludeNames).toEqual(['z-cache', 'A-cache']);
    expect(snapshot.excluded).toEqual(['A-cache', 'nested/z-cache', 'z-cache']);
  });

  it('matches exclusion names exactly instead of folding case or treating names as patterns', async () => {
    await file('game/Node_modules', 'different case');
    await file('game/cache-output', 'similar prefix');
    await file('game/cache', 'excluded');
    const connector = new ProjectConnector(path('expec.json'), { excludeNames: ['node_modules', 'cache'] });

    const snapshot = await (await connected(connector)).readSnapshot();

    expect(snapshot.complete).toBe(true);
    expect(snapshot.files.map(item => item.path)).toEqual(['Node_modules', 'cache-output']);
    expect(snapshot.excluded).toEqual(['cache']);
  });

  it('applies exclusions before deciding whether an internal directory link is a coverage problem', async () => {
    await mkdir(path('outside'));
    await mkdir(path('game'));
    await symlink(path('outside'), path('game/node_modules'), process.platform === 'win32' ? 'junction' : 'dir');

    const snapshot = await (await connected()).readSnapshot();

    expect(snapshot.complete).toBe(true);
    expect(snapshot.problems).toEqual([]);
    expect(snapshot.files).toEqual([]);
    expect(snapshot.excluded).toEqual(['node_modules']);
  });

  it('returns coverage findings in ordinal path order', async () => {
    await mkdir(path('game'));
    await mkdir(path('outside'));
    await symlink(path('outside'), path('game/é'), process.platform === 'win32' ? 'junction' : 'dir');
    await symlink(path('outside'), path('game/a'), process.platform === 'win32' ? 'junction' : 'dir');
    await symlink(path('outside'), path('game/Z'), process.platform === 'win32' ? 'junction' : 'dir');

    const snapshot = await (await connected()).readSnapshot();

    expect(snapshot.complete).toBe(false);
    expect(snapshot.files).toEqual([]);
    expect(snapshot.problems.map(item => ({ code: item.code, at: item.at }))).toEqual([
      { code: 'link-not-followed', at: { kind: 'dependency', path: ['project', snapshot.root.path, 'Z'] } },
      { code: 'link-not-followed', at: { kind: 'dependency', path: ['project', snapshot.root.path, 'a'] } },
      { code: 'link-not-followed', at: { kind: 'dependency', path: ['project', snapshot.root.path, 'é'] } },
    ]);
  });

  it('retains the original digest when the caller changes captured bytes and reads fresh storage next time', async () => {
    await file('game/value.txt', 'abc');
    const context = await connected();
    const first = await context.readSnapshot();
    expect(first.files[0]?.version).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    first.files[0]!.bytes.fill(0);

    const second = await context.readSnapshot();

    expect(first.files[0]?.version).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(second.files[0]?.version).toBe(first.files[0]?.version);
    expect([...second.files[0]!.bytes]).toEqual([97, 98, 99]);
    expect(second.files[0]!.bytes).not.toBe(first.files[0]!.bytes);
    expect([...first.files[0]!.bytes]).toEqual([0, 0, 0]);
    expect(await readFile(path('game/value.txt'), 'utf8')).toBe('abc');
  });

  it('returns distinct arrays, records and diagnostic locations for separate observations', async () => {
    await file('game/readable.txt', 'abc');
    await mkdir(path('outside'));
    await symlink(path('outside'), path('game/linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const context = await connected();
    const first = await context.readSnapshot();

    const second = await context.readSnapshot();

    expect(second).toEqual(first);
    expect(second.root).not.toBe(first.root);
    expect(second.root).not.toBe(context.root);
    expect(second.files).not.toBe(first.files);
    expect(second.files[0]).not.toBe(first.files[0]);
    expect(second.files[0]!.bytes).not.toBe(first.files[0]!.bytes);
    expect(second.excludeNames).not.toBe(first.excludeNames);
    expect(second.excluded).not.toBe(first.excluded);
    expect(second.problems).not.toBe(first.problems);
    expect(second.problems[0]).not.toBe(first.problems[0]);
    expect(second.problems[0]!.at).not.toBe(first.problems[0]!.at);
    expect(second.problems[0]!.related).not.toBe(first.problems[0]!.related);
  });

  it('retains the selected scope and OS cause when a connected root disappears', async () => {
    await mkdir(path('game'));
    const connector = new ProjectConnector(path('expec.json'), { excludeNames: ['generated', 'cache'] });
    const context = await connected(connector);
    await rm(path('game'), { recursive: true });

    const snapshot = await context.readSnapshot();

    expect(snapshot.complete).toBe(false);
    expect(snapshot.files).toEqual([]);
    expect(snapshot.excludeNames).toEqual(['generated', 'cache']);
    expect(snapshot.excluded).toEqual([]);
    expect(snapshot.problems).toEqual([expect.objectContaining({ code: 'root-unavailable', related: [],
      at: { kind: 'dependency', path: ['project', context.root.path] }, message: expect.stringContaining('ENOENT') })]);
  });
});

describe('ProjectSnapshot detected changes during a read', () => {
  it('discards a file changed during its open-handle read and retains a readable neighbor', async () => {
    await file('game/changing.txt', 'before');
    await file('game/readable.txt', 'keep');
    const context = await connected();
    afterReading('game/changing.txt', () => appendFile(path('game/changing.txt'), ' after'));

    const snapshot = await context.readSnapshot();

    expect(snapshot.complete).toBe(false);
    expect(snapshot.problems).toContainEqual(expect.objectContaining({ code: 'changed-during-read',
      at: { kind: 'dependency', path: ['project', context.root.path, 'changing.txt'] } }));
    expect(snapshot.files.map(item => item.path)).toEqual(['readable.txt']);
    expect(Buffer.from(snapshot.files[0]!.bytes).toString('utf8')).toBe('keep');
    expect(await readFile(path('game/changing.txt'), 'utf8')).toBe('before after');
  });

  it('detects a file replaced between observing its path and opening it', async () => {
    await file('game/changing.txt', 'first');
    await file('game/readable.txt', 'keep');
    const context = await connected(), open = fs.open.bind(fs);
    let replaced = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (!replaced && String(args[0]) === path('game/changing.txt')) {
        replaced = true;
        await rename(path('game/changing.txt'), path('retired.txt'));
        await writeFile(path('game/changing.txt'), 'other');
      }
      return open(...args);
    });

    const snapshot = await context.readSnapshot();

    expect(snapshot.complete).toBe(false);
    expect(snapshot.problems).toContainEqual(expect.objectContaining({ code: 'changed-during-read',
      at: { kind: 'dependency', path: ['project', context.root.path, 'changing.txt'] } }));
    expect(snapshot.files.map(item => item.path)).toEqual(['readable.txt']);
    expect(await readFile(path('retired.txt'), 'utf8')).toBe('first');
    expect(await readFile(path('game/changing.txt'), 'utf8')).toBe('other');
  });

  it('reports a directory whose entries change after enumeration and retains a readable neighbor', async () => {
    await file('game/nested/original.txt', 'present at enumeration');
    await file('game/readable.txt', 'keep');
    const context = await connected(), readdir = fs.readdir.bind(fs);
    const observed = await lstat(path('game/nested'));
    let created = false;
    vi.spyOn(fs, 'readdir').mockImplementation(async (...args) => {
      const entries = await readdir(...args);
      if (!created && String(args[0]) === path('game/nested')) {
        created = true;
        await writeFile(path('game/nested/new.txt'), 'created after enumeration');
        await utimes(path('game/nested'), observed.atime, new Date(observed.mtimeMs + 2000));
      }
      return entries;
    });

    const snapshot = await context.readSnapshot();

    expect(snapshot.complete).toBe(false);
    expect(snapshot.problems).toContainEqual(expect.objectContaining({ code: 'changed-during-read',
      at: { kind: 'dependency', path: ['project', context.root.path, 'nested'] } }));
    expect(snapshot.files.map(item => item.path)).toContain('readable.txt');
    expect(await readFile(path('game/nested/new.txt'), 'utf8')).toBe('created after enumeration');
  });

  it('discards every captured file when the selected root link is retargeted during reading', async () => {
    await file('game-a/value.txt', 'original');
    await file('game-b/value.txt', 'replacement');
    await symlink(path('game-a'), path('selected'), process.platform === 'win32' ? 'junction' : 'dir');
    const context = await connected(new ProjectConnector(path('expec.json')), 'selected');
    afterReading('game-a/value.txt', async () => {
      await rm(path('selected'));
      await symlink(path('game-b'), path('selected'), process.platform === 'win32' ? 'junction' : 'dir');
    });

    const snapshot = await context.readSnapshot();

    expect(snapshot.complete).toBe(false);
    expect(snapshot.files).toEqual([]);
    expect(snapshot.problems).toContainEqual(expect.objectContaining({ code: 'root-changed',
      at: { kind: 'dependency', path: ['project', context.root.path] } }));
    expect(await realpath(path('selected'))).toBe(await realpath(path('game-b')));
  });
});

// Native Windows drive semantics are owned by the Windows test run.
if (process.platform === 'win32') describe('ProjectConnector Windows paths', () => {
  it('rejects a drive-relative manifest location', () => {
    expect(() => new ProjectConnector('C:settings\\expec.json')).toThrow(TypeError);
  });

  it('rejects a manifest rooted on an ambient current drive', () => {
    expect(() => new ProjectConnector('\\settings\\expec.json')).toThrow(TypeError);
  });

  it('rejects an incomplete UNC manifest location that names no share', () => {
    expect(() => new ProjectConnector('\\\\server')).toThrow(TypeError);
  });

  it('rejects a drive-relative authored root as a located configuration problem', async () => {
    connectionProblem(await new ProjectConnector(path('expec.json')).connect(configuration('C:game')), 'invalid-project-root');
  });

  it('rejects a current-drive-rooted authored root', async () => {
    connectionProblem(await new ProjectConnector(path('expec.json')).connect(configuration('\\game')), 'invalid-project-root');
  });

  it('rejects a slash-rooted authored root that also depends on the current drive', async () => {
    connectionProblem(await new ProjectConnector(path('expec.json')).connect(configuration('/game')), 'invalid-project-root');
  });

  it('rejects an incomplete UNC authored root that names no share', async () => {
    connectionProblem(await new ProjectConnector(path('expec.json')).connect(configuration('//server')), 'invalid-project-root');
  });

  it('rejects a backslash-separated exclusion path', () => {
    expect(() => new ProjectConnector(path('expec.json'), { excludeNames: ['cache\\generated'] })).toThrow(TypeError);
  });
});

// POSIX byte filenames and filesystem sockets are owned by the POSIX test run.
if (process.platform !== 'win32') describe('ProjectSnapshot POSIX entries', () => {
  it('preserves a literal backslash independently from an actual directory separator', async () => {
    await file('game/a\\b.txt', 'literal backslash');
    await file('game/a/b.txt', 'nested path');

    const snapshot = await (await connected()).readSnapshot();

    expect(snapshot.complete).toBe(true);
    expect(snapshot.files.map(item => item.path)).toEqual(['a/b.txt', 'a\\b.txt']);
    expect(snapshot.files.map(item => Buffer.from(item.bytes).toString('utf8'))).toEqual(['nested path', 'literal backslash']);
  });

  it('reports invalid UTF-8 at its parent with byte identity while retaining a distinct replacement-character filename', async () => {
    await file('game/nested/f\uFFFD\uFFFD', 'valid name');
    await writeFile(Buffer.concat([Buffer.from(path('game/nested/')), Buffer.from([0x66, 0x80, 0xff])]), 'invalid name');

    const snapshot = await (await connected()).readSnapshot();

    expect(snapshot.complete).toBe(false);
    expect(snapshot.files.map(item => item.path)).toEqual(['nested/f\uFFFD\uFFFD']);
    expect(Buffer.from(snapshot.files[0]!.bytes).toString('utf8')).toBe('valid name');
    expect(snapshot.problems).toEqual([expect.objectContaining({ code: 'unsupported-entry', related: [],
      at: { kind: 'dependency', path: ['project', snapshot.root.path, 'nested'] }, message: expect.stringContaining('6680ff') })]);
  });

  it('reports a filesystem socket as unsupported and keeps readable neighbors', async () => {
    await file('game/readable.txt', 'keep');
    const server = createServer();
    await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(path('game/channel'), accept); });
    try {
      expect((await lstat(path('game/channel'))).isSocket()).toBe(true);

      const snapshot = await (await connected()).readSnapshot();

      expect(snapshot.complete).toBe(false);
      expect(snapshot.files.map(item => item.path)).toEqual(['readable.txt']);
      expect(snapshot.problems).toEqual([expect.objectContaining({ code: 'unsupported-entry', related: [],
        at: { kind: 'dependency', path: ['project', snapshot.root.path, 'channel'] } })]);
    } finally {
      await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
    }
  });
});
