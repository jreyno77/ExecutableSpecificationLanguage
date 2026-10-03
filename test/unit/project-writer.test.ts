import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect, onTestFinished, vi } from 'vitest';
import { FileProjectWriter, type FileChange, type ProjectSnapshot, type WriteResult } from '../../src/index.js';
import { WritingDriver } from '../driver/project-writing.js';

const bytes = (text: string) => new TextEncoder().encode(text);
async function project(files: Record<string, string> = { 'book': 'old' }) {
  const driver = new WritingDriver(); onTestFinished(() => driver.dispose());
  await driver.initialize(files); await driver.observe(); return driver;
}
function apply(driver: WritingDriver, changes: readonly FileChange[], baseline = driver.snapshot, signal?: AbortSignal) {
  return new FileProjectWriter(driver.context).apply({ basedOn: baseline, changes }, signal);
}
function stopped(result: WriteResult, code: string) {
  expect(result.status).toBe('stopped'); expect(result.problems).toContainEqual(expect.objectContaining({ code }));
}
const write = (path: string, text = 'new'): FileChange => ({ kind: 'write', path, bytes: bytes(text) });

describe('conditional file application preconditions', () => {
  it('verifies an empty plan without reporting an effect', async () => {
    const p = await project(), result = await apply(p, []);
    expect(result).toMatchObject({ status: 'unchanged', outcomes: [], problems: [], temporaryPaths: [], createdDirectories: [] });
    await expect(fs.lstat(p.path('.expec'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('observes an already absent removal as unchanged', async () => {
    const p = await project(), result = await apply(p, [{ kind: 'remove', path: 'missing' }]);
    expect(result.status).toBe('unchanged');
    expect(result.outcomes[0]).toMatchObject({ state: 'unchanged', before: [{ path: 'missing', state: 'absent' }], after: [{ path: 'missing', state: 'absent' }] });
  });
  it('rejects a snapshot belonging to a different root', async () => {
    const p = await project(), baseline = { ...p.snapshot, root: { ...p.snapshot.root, identity: 'another root' } };
    stopped(await apply(p, [write('book')], baseline), 'stale-project');
    expect(await fs.readFile(p.path('book'), 'utf8')).toBe('old');
  });
  it('requires the same exclusion policy used while planning', async () => {
    const p = await project();
    stopped(await apply(p, [write('book')], { ...p.snapshot, excludeNames: ['.git'] }), 'stale-project');
    expect(await fs.readFile(p.path('book'), 'utf8')).toBe('old');
  });
  it('rejects a policy hiding its coordination directory', async () => {
    const p = await project(), baseline = { ...p.snapshot, excludeNames: [...p.snapshot.excludeNames, '.expec'] };
    stopped(await apply(p, [write('book')], baseline), 'invalid-change');
    await expect(fs.lstat(p.path('.expec'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('does not trust a baseline whose bytes disagree with its version', async () => {
    const p = await project(), baseline = { ...p.snapshot, files: p.snapshot.files.map(file => ({ ...file, bytes: bytes('forged') })) };
    stopped(await apply(p, [write('book')], baseline), 'invalid-change');
    expect(await fs.readFile(p.path('book'), 'utf8')).toBe('old');
  });
  it('rejects duplicate snapshot paths', async () => {
    const p = await project();
    stopped(await apply(p, [write('book')], { ...p.snapshot, files: [...p.snapshot.files, p.snapshot.files[0]!] }), 'invalid-change');
  });
  it('requires a complete fresh read after an earlier change', async () => {
    const p = await project({ first: 'old', second: 'old' }), actual = p.context;
    p.context = { root: actual.root, readSnapshot: async () => {
      const snapshot = await actual.readSnapshot();
      return snapshot.files.some(file => file.path === 'first' && Buffer.from(file.bytes).toString() === 'new')
        ? { ...snapshot, complete: false } : snapshot;
    } };
    const result = await apply(p, [write('first'), write('second')]);
    stopped(result, 'incomplete-project'); expect(result.outcomes.map(item => item.state)).toEqual(['applied', 'not-applied']);
    expect(await fs.readFile(p.path('second'), 'utf8')).toBe('old');
  });
  it('treats a newly encountered excluded entry as a changed coverage boundary', async () => {
    const p = await project(); await p.edit('node_modules/library/index.js', 'ignored');
    stopped(await apply(p, [write('book')]), 'stale-project');
  });
  it('does not allow a requested change inside an excluded directory', async () => {
    const p = await project();
    stopped(await apply(p, [write('node_modules/library/index.js')]), 'invalid-change');
  });
  it('rejects invalid literal spellings before applying a valid earlier change', async () => {
    const p = await project();
    for (const path of ['', '/absolute', '../outside', 'a//b', './a', 'a/../b', 'null\0name', '\ud800']) {
      const result = await apply(p, [write('book'), write(path)]);
      stopped(result, 'invalid-change'); expect(result.outcomes).toHaveLength(2);
      expect(await fs.readFile(p.path('book'), 'utf8')).toBe('old');
    }
  });
  it('keeps platform-specific aliases from being silently reinterpreted', async () => {
    const p = await project();
    if (process.platform === 'win32') {
      for (const path of ['C:relative', 'C:/absolute', 'book:stream', 'trailing.', 'space ', 'CON', 'aux.txt', 'a\\b']) {
        stopped(await apply(p, [write(path)]), 'invalid-change');
      }
    } else {
      expect((await apply(p, [write('a\\b', 'literal')])).status).toBe('applied');
      expect(await fs.readFile(p.path('a\\b'), 'utf8')).toBe('literal');
    }
  });
  it('rejects the reserved writer marker as a requested change', async () => {
    const p = await project(); stopped(await apply(p, [write('.expec/write.lock')]), 'invalid-change');
  });
  it('rejects a file endpoint that is an existing empty directory', async () => {
    const p = await project(); await fs.mkdir(p.path('empty'));
    stopped(await apply(p, [write('book'), write('empty')]), 'unsupported-change');
    expect(await fs.readFile(p.path('book'), 'utf8')).toBe('old');
    expect((await fs.stat(p.path('empty'))).isDirectory()).toBe(true);
  });
  it('rejects a regular file used as a destination ancestor', async () => {
    const p = await project(); stopped(await apply(p, [write('book/child')]), 'unsupported-change');
    expect(await fs.readFile(p.path('book'), 'utf8')).toBe('old');
  });
  it('rejects move chains and endpoints used as other endpoint parents', async () => {
    const p = await project({ a: 'a', b: 'b' });
    stopped(await apply(p, [{ kind: 'move', from: 'a', to: 'b' }, { kind: 'move', from: 'b', to: 'c' }]), 'invalid-change');
    stopped(await apply(p, [write('new'), write('new/child')]), 'invalid-change');
    expect(await fs.readFile(p.path('a'), 'utf8')).toBe('a');
  });
  it('rejects destructive changes to a multiply linked file', async () => {
    const p = await project(); await fs.link(p.path('book'), p.path('alias')); await p.observe();
    stopped(await apply(p, [write('book')]), 'unsupported-change');
    expect(await fs.readFile(p.path('alias'), 'utf8')).toBe('old');
  });
  it('reports a case-only move as unsupported on a case-insensitive host', async () => {
    const p = await project();
    let aliases = false;
    try { aliases = (await fs.stat(p.path('BOOK'), { bigint: true })).ino === (await fs.stat(p.path('book'), { bigint: true })).ino; } catch {}
    const result = await apply(p, [{ kind: 'move', from: 'book', to: 'BOOK' }]);
    if (aliases) { stopped(result, 'unsupported-change'); expect(await fs.readFile(p.path('book'), 'utf8')).toBe('old'); }
    else { expect(result.status).toBe('applied'); expect(await fs.readFile(p.path('BOOK'), 'utf8')).toBe('old'); }
  });
});

describe('file effects and recovery observations', () => {
  it('preserves supported ordinary mode when replacing and moving a file', async () => {
    const p = await project(); await fs.chmod(p.path('book'), 0o751);
    const mode = (await fs.stat(p.path('book'))).mode & 0o777;
    expect((await apply(p, [write('book')])).status).toBe('applied');
    expect((await fs.stat(p.path('book'))).mode & 0o777).toBe(mode);
    await p.observe();
    expect((await apply(p, [{ kind: 'move', from: 'book', to: 'new/book' }])).status).toBe('applied');
    expect((await fs.stat(p.path('new/book'))).mode & 0o777).toBe(mode);
  });
  it('captures baseline bytes and optional move replacement bytes synchronously', async () => {
    const p = await project(), replacement = bytes('moved'), baseline = structuredClone(p.snapshot);
    const pending = apply(p, [{ kind: 'move', from: 'book', to: 'item', bytes: replacement }], baseline);
    replacement.fill(0); baseline.files[0]!.bytes.fill(0);
    const result = await pending;
    expect(result.status).toBe('applied'); expect(await fs.readFile(p.path('item'), 'utf8')).toBe('moved');
    expect(result.outcomes[0]?.before).toContainEqual(expect.objectContaining({ bytes: bytes('old') }));
  });
  it('keeps a concurrently appearing move destination', async () => {
    const p = await project(), open = fs.open.bind(fs); let introduced = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (!introduced && String(args[0]) === p.path('item') && args[1] === 'wx') {
        introduced = true; await fs.writeFile(p.path('item'), 'handwritten');
      }
      return open(...args);
    });
    const result = await apply(p, [{ kind: 'move', from: 'book', to: 'item' }]);
    stopped(result, 'write-failed');
    expect(result.problems[0]?.at).toEqual({ kind: 'dependency', path: ['project', p.root, 'item'] });
    expect(await fs.readFile(p.path('book'), 'utf8')).toBe('old');
    expect(await fs.readFile(p.path('item'), 'utf8')).toBe('handwritten');
  });
  it('does not remove a source changed after a move destination was created', async () => {
    const p = await project(), open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (String(args[0]) === p.path('item') && args[1] === 'wx') {
        const writeFile = handle.writeFile.bind(handle);
        vi.spyOn(handle, 'writeFile').mockImplementation(async (...values) => { await writeFile(...values); await fs.writeFile(p.path('book'), 'new author'); });
      }
      return handle;
    });
    const result = await apply(p, [{ kind: 'move', from: 'book', to: 'item' }]);
    expect(result.status).toBe('stopped'); expect(result.outcomes[0]?.state).toBe('uncertain');
    expect(await fs.readFile(p.path('book'), 'utf8')).toBe('new author');
    expect(await fs.readFile(p.path('item'), 'utf8')).toBe('old');
  });
  it('checks an aborted signal before creating coordination files', async () => {
    const p = await project(), controller = new AbortController(); controller.abort();
    stopped(await apply(p, [write('book')], p.snapshot, controller.signal), 'write-cancelled');
    await expect(fs.lstat(p.path('.expec'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(p.path('book'), 'utf8')).toBe('old');
  });
  it('observes the in-flight write before honoring cancellation', async () => {
    const p = await project({ first: 'old', second: 'old' }), controller = new AbortController(), open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (String(args[0]) === p.path('first') && args[1] === 'r+') {
        const writeFile = handle.writeFile.bind(handle);
        vi.spyOn(handle, 'writeFile').mockImplementation(async (...values) => { await writeFile(...values); controller.abort(); });
      }
      return handle;
    });
    const result = await apply(p, [write('first'), write('second')], p.snapshot, controller.signal);
    stopped(result, 'write-cancelled'); expect(result.outcomes.map(item => item.state)).toEqual(['applied', 'not-applied']);
    expect(result.outcomes[0]?.after).toContainEqual(expect.objectContaining({ bytes: bytes('new') }));
    expect(await fs.readFile(p.path('second'), 'utf8')).toBe('old');
  });
  it('does not retry a failed write and cleans empty created parents', async () => {
    const p = await project(), open = fs.open.bind(fs); let attempts = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (String(args[0]) === p.path('new/deep/book') && args[1] === 'wx') {
        attempts++; throw Object.assign(new Error('Disk refused creation'), { code: 'EIO' });
      }
      return open(...args);
    });
    const result = await apply(p, [write('new/deep/book')]);
    stopped(result, 'write-failed'); expect(attempts).toBe(1); expect(result.createdDirectories).toEqual([]);
    await expect(fs.lstat(p.path('new'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('preserves new content placed inside a directory created by this call', async () => {
    const p = await project(), open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (String(args[0]) === p.path('new/book') && args[1] === 'wx') {
        await fs.writeFile(p.path('new/manual'), 'keep');
        throw Object.assign(new Error('Creation failed'), { code: 'EIO' });
      }
      return open(...args);
    });
    const result = await apply(p, [write('new/book')]);
    stopped(result, 'write-failed'); expect(result.createdDirectories).toEqual(['new']);
    expect(await fs.readFile(p.path('new/manual'), 'utf8')).toBe('keep');
  });
  it('retains cleanup failure and its owned marker path even after a successful write', async () => {
    const p = await project(), unlink = fs.unlink.bind(fs);
    vi.spyOn(fs, 'unlink').mockImplementation(async path => {
      if (String(path) === p.path('.expec/write.lock')) throw Object.assign(new Error('Marker removal denied'), { code: 'EACCES' });
      return unlink(path);
    });
    const result = await apply(p, [write('book')]);
    stopped(result, 'cleanup-failed'); expect(result.outcomes[0]?.state).toBe('applied');
    expect(result.temporaryPaths).toEqual(['.expec/write.lock']); expect(result.createdDirectories).toContain('.expec');
    expect(await fs.readFile(p.path('book'), 'utf8')).toBe('new');
  });
  it('does not delete a replacement marker even when its token was copied', async () => {
    const p = await project(), actual = p.context; let replaced = false;
    p.context = { root: actual.root, readSnapshot: async () => {
      const snapshot = await actual.readSnapshot();
      if (!replaced) {
        replaced = true; const token = await fs.readFile(p.path('.expec/write.lock'));
        await fs.rename(p.path('.expec/write.lock'), p.path('.expec/original-marker'));
        await fs.writeFile(p.path('.expec/write.lock'), token);
      }
      return snapshot;
    } };
    const result = await apply(p, [write('book')]);
    stopped(result, 'cleanup-failed'); expect(result.temporaryPaths).toEqual(['.expec/write.lock']);
    expect(await fs.readFile(p.path('book'), 'utf8')).toBe('old');
    expect(await fs.readFile(p.path('.expec/write.lock'))).toEqual(await fs.readFile(p.path('.expec/original-marker')));
  });
  it('returns actual captured hashes and independently owned receipt bytes', async () => {
    const p = await project(), result = await apply(p, [write('book')]), after = result.outcomes[0]?.after[0];
    expect(after?.state).toBe('file');
    if (after?.state !== 'file') throw new Error('Expected a captured file');
    expect(after.version).toBe(createHash('sha256').update(bytes('new')).digest('hex'));
    after.bytes.fill(0); expect(await fs.readFile(p.path('book'), 'utf8')).toBe('new');
    expect([...p.snapshot.files[0]!.bytes]).toEqual([...bytes('old')]);
  });
  it('retains an observed move source when the destination path cannot be read', async () => {
    const p = await project(); await fs.mkdir(p.path('directory'));
    const result = await apply(p, [{ kind: 'move', from: 'book', to: 'directory' }]);
    stopped(result, 'unsupported-change');
    expect(result.outcomes[0]?.before).toContainEqual(expect.objectContaining({ path: 'book', bytes: bytes('old') }));
    expect(await fs.readFile(p.path('book'), 'utf8')).toBe('old');
  });
  it('does not bypass excluded directories or coordination through case aliases', async () => {
    const p = await project({ 'node_modules/library': 'private', book: 'old' });
    if (process.platform === 'win32') {
      const excluded = await apply(p, [write('NODE_MODULES/library')]);
      expect(excluded.status).toBe('stopped');
      expect(await fs.readFile(p.path('node_modules/library'), 'utf8')).toBe('private');
      const reserved = await apply(p, [write('.EXPEC/WRITE.LOCK')]);
      stopped(reserved, 'invalid-change');
    } else {
      expect((await apply(p, [write('NODE_MODULES/library', 'distinct')])).status).toBe('applied');
      expect(await fs.readFile(p.path('node_modules/library'), 'utf8')).toBe('private');
    }
  });
  it('rejects alternate case spellings of existing file endpoints on an insensitive host', async () => {
    const p = await project();
    let aliases = false;
    try { aliases = (await fs.stat(p.path('BOOK'), { bigint: true })).ino === (await fs.stat(p.path('book'), { bigint: true })).ino; } catch {}
    const result = await apply(p, [write('BOOK')]);
    if (aliases) {
      stopped(result, 'unsupported-change'); expect(await fs.readFile(p.path('book'), 'utf8')).toBe('old');
    } else {
      expect(result.status).toBe('applied'); expect(await fs.readFile(p.path('book'), 'utf8')).toBe('old');
    }
  });
  it('does not traverse a parent replaced between planning checks and an operation', async () => {
    const p = await project({ 'src/book': 'old' }), actual = p.context; let replaced = false;
    p.context = { root: actual.root, readSnapshot: async () => {
      const snapshot = await actual.readSnapshot();
      if (!replaced) { replaced = true; await p.replaceDirectoryWithOutsideLink('src'); }
      return snapshot;
    } };
    const result = await apply(p, [write('src/book')]);
    expect(result.status).toBe('stopped');
    expect(await fs.readFile(p.path('src-original/book'), 'utf8')).toBe('old');
    await expect(fs.lstat(join(p.directory, 'outside/book'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('retains a thrown failure even when the throw value is undefined', async () => {
    const p = await project(), open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (String(args[0]) === p.path('book') && args[1] === 'r+') {
        const writeFile = handle.writeFile.bind(handle);
        vi.spyOn(handle, 'writeFile').mockImplementation(async (...values) => { await writeFile(...values); throw undefined; });
      }
      return handle;
    });
    const result = await apply(p, [write('book')]);
    stopped(result, 'write-failed'); expect(result.outcomes[0]?.state).toBe('uncertain');
    expect(await fs.readFile(p.path('book'), 'utf8')).toBe('new');
  });
  it('rejects a marker descendant before applying earlier valid changes', async () => {
    const p = await project();
    stopped(await apply(p, [write('book'), write('.expec/write.lock/child')]), 'invalid-change');
    expect(await fs.readFile(p.path('book'), 'utf8')).toBe('old');
  });
  it('requires canonical absolute root paths even from an alternate context', async () => {
    const p = await project(), actual = p.context;
    const root = { ...actual.root, path: join(actual.root.path, '..', 'project', '.') + '/.' };
    p.context = { root, readSnapshot: () => actual.readSnapshot() };
    stopped(await apply(p, [write('book')], { ...p.snapshot, root }), 'stale-project');
    expect(await fs.readFile(p.path('book'), 'utf8')).toBe('old');
    await expect(fs.lstat(p.path('.expec'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('reports a created marker whose identity could not be captured', async () => {
    const p = await project(), open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (String(args[0]) === p.path('.expec/write.lock') && args[1] === 'wx') {
        vi.spyOn(handle, 'stat').mockRejectedValueOnce(Object.assign(new Error('Marker identity unavailable'), { code: 'EIO' }));
      }
      return handle;
    });
    const result = await apply(p, [write('book')]);
    stopped(result, 'write-failed');
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'cleanup-failed' }));
    expect(result.temporaryPaths).toEqual(['.expec/write.lock']);
    expect(await fs.readFile(p.path('book'), 'utf8')).toBe('old');
    expect((await fs.lstat(p.path('.expec/write.lock'))).isFile()).toBe(true);
  });
  it('reports a created directory whose identity could not be captured', async () => {
    const p = await project(), mkdir = fs.mkdir.bind(fs), lstat = fs.lstat.bind(fs); let created = false;
    vi.spyOn(fs, 'mkdir').mockImplementation(async (...args) => {
      const result = await mkdir(...args);
      if (String(args[0]) === p.path('new')) created = true;
      return result;
    });
    vi.spyOn(fs, 'lstat').mockImplementation(((...args: Parameters<typeof fs.lstat>) => {
      if (created && String(args[0]) === p.path('new')) {
        created = false; return Promise.reject(Object.assign(new Error('Directory identity unavailable'), { code: 'EIO' }));
      }
      return lstat(...args);
    }) as typeof fs.lstat);
    const result = await apply(p, [write('new/book')]);
    stopped(result, 'write-failed');
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'cleanup-failed' }));
    expect(result.createdDirectories).toEqual(['new']);
    expect((await fs.lstat(p.path('new'))).isDirectory()).toBe(true);
  });
});
