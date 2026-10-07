import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { PackageDriver } from '../../driver/package/installed-package.js';

const packageName = 'executable-specification-language', execute = promisify(execFile);
const consumers: PackageDriver[] = [];
const installer = PackageDriver.prototype as unknown as { installInto(directory: string, artifact: string): Promise<void> };
const product = (root: string) => join(root, 'node_modules', packageName);
function consumer(): PackageDriver { const driver = new PackageDriver(); consumers.push(driver); return driver; }
async function archive(text: string): Promise<string> {
  const parent = await realpath(tmpdir()), directory = await mkdtemp(join(parent, 'expec-installed-consumer-'));
  const path = join(directory, 'supplied package.tgz');
  await writeFile(path, text);
  onTestFinished(async () => {
    if (dirname(directory) !== parent || !basename(directory).startsWith('expec-installed-consumer-')) throw Error('Unexpected archive fixture directory');
    await rm(directory, { recursive: true, force: true });
  });
  return path;
}
// Replace only npm installation; the seed, copies, links, consumers and cleanup use real files.
async function installedTree(directory: string, artifact: string): Promise<void> {
  const installed = product(directory);
  await mkdir(installed, { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
  await writeFile(join(installed, 'package.json'), JSON.stringify({ name: packageName, version: '1.0.0', exports: './index.cjs' }));
  await writeFile(join(installed, 'index.cjs'), "module.exports = require('node:fs').readFileSync(require('node:path').join(__dirname, 'note.txt'), 'utf8');\n");
  await writeFile(join(installed, 'note.txt'), await readFile(artifact));
  await writeFile(join(installed, 'remove-me.txt'), 'Keep this shipped file.');
}

beforeEach(() => { vi.stubEnv('EXPEC_TEST_PACKAGE', undefined); vi.stubEnv('npm_execpath', undefined); });
afterEach(async () => {
  try { await Promise.all(consumers.splice(0).map(driver => driver.dispose())); }
  finally {
    try { await PackageDriver.finish(); }
    finally { vi.restoreAllMocks(); vi.unstubAllEnvs(); }
  }
});

describe('installed package consumers have private files', () => {
  it('keeps other consumers and later copies unchanged after a consumer edits and deletes files', async () => {
    const install = vi.spyOn(installer, 'installInto').mockImplementation(installedTree);
    await PackageDriver.prepare(await archive('original package bytes'));
    const first = consumer(), second = consumer();
    await Promise.all([first.install(), second.install()]);

    await writeFile(join(product(first.root), 'note.txt'), 'changed by the first consumer');
    await unlink(join(product(first.root), 'remove-me.txt'));
    const third = consumer(); await third.install();

    expect(await readFile(join(product(first.root), 'note.txt'), 'utf8')).toBe('changed by the first consumer');
    await expect(lstat(join(product(first.root), 'remove-me.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(product(second.root), 'note.txt'), 'utf8')).toBe('original package bytes');
    expect(await readFile(join(product(second.root), 'remove-me.txt'), 'utf8')).toBe('Keep this shipped file.');
    expect(await readFile(join(product(third.root), 'note.txt'), 'utf8')).toBe('original package bytes');
    expect(await readFile(join(product(third.root), 'remove-me.txt'), 'utf8')).toBe('Keep this shipped file.');
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('starts a new installation lifetime while preserving old consumers and both caller archives', async () => {
    const install = vi.spyOn(installer, 'installInto').mockImplementation(installedTree);
    const original = await archive('first archive'), replacement = await archive('second archive');
    await PackageDriver.prepare(original); const first = consumer(); await first.install();

    await PackageDriver.prepare(replacement); const second = consumer(); await second.install();
    await PackageDriver.finish();

    expect(await readFile(join(product(first.root), 'note.txt'), 'utf8')).toBe('first archive');
    expect(await readFile(join(product(second.root), 'note.txt'), 'utf8')).toBe('second archive');
    expect(await readFile(original, 'utf8')).toBe('first archive');
    expect(await readFile(replacement, 'utf8')).toBe('second archive');
    expect(install).toHaveBeenCalledTimes(2);
  });

  it('retains the original installation failure until finish and removes its partial seed', async () => {
    const failure = new Error('The supplied installation failed.');
    const install = vi.spyOn(installer, 'installInto').mockImplementation(async (directory, artifact) => {
      await installedTree(directory, artifact); throw failure;
    });
    const supplied = await archive('caller-owned bytes'); await PackageDriver.prepare(supplied);
    const first = consumer(), second = consumer();

    await expect(first.install()).rejects.toBe(failure);
    await expect(second.install()).rejects.toBe(failure);
    expect(install).toHaveBeenCalledTimes(1);
    const seed = dirname(install.mock.calls[0]![0]);
    await PackageDriver.finish();

    await expect(lstat(seed)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(supplied, 'utf8')).toBe('caller-owned bytes');
  });

  it('runs the copied local command after its seed has been removed', async () => {
    const install = vi.spyOn(installer, 'installInto').mockImplementation(async (directory, artifact) => {
      await installedTree(directory, artifact);
      const binaries = join(directory, 'node_modules', '.bin'), command = join(product(directory), 'bin', 'read-note.cjs');
      await mkdir(binaries); await mkdir(dirname(command));
      await writeFile(command, "#!/usr/bin/env node\nprocess.stdout.write(require('../index.cjs'));\n");
      if (process.platform === 'win32') await writeFile(join(binaries, 'read-note.cmd'),
        '@echo off\r\n"%EXPEC_CONSUMER_NODE%" "%~dp0..\\' + packageName + '\\bin\\read-note.cjs"\r\n');
      else { await chmod(command, 0o755); await symlink('../' + packageName + '/bin/read-note.cjs', join(binaries, 'read-note')); }
    });
    const supplied = await archive('portable package bytes\n'); await PackageDriver.prepare(supplied);
    const copy = consumer(); await copy.install();
    const seed = dirname(install.mock.calls[0]![0]); await PackageDriver.finish();
    await expect(lstat(seed)).rejects.toMatchObject({ code: 'ENOENT' });
    const bin = join(copy.root, 'node_modules', '.bin', process.platform === 'win32' ? 'read-note.cmd' : 'read-note');
    if (process.platform === 'win32') expect((await lstat(bin)).isFile()).toBe(true);
    else {
      expect(await readlink(bin)).toBe('../' + packageName + '/bin/read-note.cjs');
      expect(await realpath(bin)).toBe(join(product(copy.root), 'bin', 'read-note.cjs'));
    }
    const options = { cwd: copy.root, windowsHide: true, timeout: 5_000,
      env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', EXPEC_CONSUMER_NODE: process.execPath } };

    const result = process.platform === 'win32'
      ? await execute(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', relative(copy.root, bin)], options)
      : await execute(process.execPath, [bin], options);

    expect(result.stdout).toBe('portable package bytes\n');
    expect(result.stderr).toBe('');
    expect(await readFile(supplied, 'utf8')).toBe('portable package bytes\n');
  });

  it('refuses a seed link that reaches outside its installation', async () => {
    const supplied = await archive('external caller-owned bytes');
    vi.spyOn(installer, 'installInto').mockImplementation(async (directory, artifact) => {
      await installedTree(directory, artifact);
      const link = join(product(directory), 'outside');
      if (process.platform === 'win32') await symlink(dirname(supplied), link, 'junction');
      else await symlink(relative(dirname(link), supplied), link);
    });
    await PackageDriver.prepare(supplied); const copy = consumer();

    await expect(copy.install()).rejects.toThrow('Package fixture link must stay inside its installation');
    await expect(lstat(copy.root)).rejects.toMatchObject({ code: 'ENOENT' });
    await PackageDriver.finish();

    expect(await readFile(supplied, 'utf8')).toBe('external caller-owned bytes');
  });
});
describe('installed product readiness is an explicit fixture prerequisite', () => {
  it('finishes installing the shared product before examples begin', async () => {
    let release!: () => void, started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const installationStarted = new Promise<void>(resolve => { started = resolve; });
    const install = vi.spyOn(installer, 'installInto').mockImplementation(async (directory, artifact) => {
      await installedTree(directory, artifact); started(); await held;
    });
    const supplied = await archive('original product'); let prepared = false;
    const preparing = PackageDriver.prepareInstalled(supplied).then(() => { prepared = true; });
    try {
      expect(await Promise.race([installationStarted.then(() => 'installing'), preparing.then(() => 'prepared')])).toBe('installing');
      expect(prepared).toBe(false);
      expect(await readFile(join(product(install.mock.calls[0]![0]), 'note.txt'), 'utf8')).toBe('original product');
    } finally { release(); await preparing; }

    const first = consumer(), second = consumer();
    await first.install(); await second.install();
    await writeFile(join(product(first.root), 'note.txt'), 'changed by the first consumer');
    expect(await readFile(join(product(second.root), 'note.txt'), 'utf8')).toBe('original product');
    expect(await readFile(join(product(install.mock.calls[0]![0]), 'note.txt'), 'utf8')).toBe('original product');
    expect((await lstat(join(product(first.root), 'note.txt'))).ino).not.toBe((await lstat(join(product(second.root), 'note.txt'))).ino);
    expect(install).toHaveBeenCalledTimes(1);
    expect(await readFile(supplied, 'utf8')).toBe('original product');
  });

  it('retains a failed prepared installation until its fixture is finished', async () => {
    const failure = new Error('The prepared installation failed.');
    const install = vi.spyOn(installer, 'installInto').mockImplementation(async (directory, artifact) => {
      await installedTree(directory, artifact); throw failure;
    });
    const supplied = await archive('caller-owned archive');
    await expect(PackageDriver.prepareInstalled(supplied)).rejects.toBe(failure);
    const first = consumer();
    await expect(first.install()).rejects.toBe(failure);
    expect(install).toHaveBeenCalledTimes(1);
    const seed = dirname(install.mock.calls[0]![0]);
    expect((await lstat(seed)).isDirectory()).toBe(true);

    await PackageDriver.finish();

    await expect(lstat(seed)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(supplied, 'utf8')).toBe('caller-owned archive');
  });
});
