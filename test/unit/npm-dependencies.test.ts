import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { NpmDependencies, type Configuration, type PackageRead } from '../../src/index.js';
import * as native from '../../src/project/connection/native-process.js';
import { NativePackageDriver } from '../driver/native-packages.js';

async function project(installed = false) {
  const driver = new NativePackageDriver(); await driver.initialize(); onTestFinished(() => driver.dispose());
  if (installed) await driver.seed('example-storage', '2.1.0', '^2');
  driver.require('storage', 'npm:example-storage', '^2', ['runtime']); return driver;
}
function rejected(result: PackageRead, code: string) {
  expect(result.value).toBeUndefined(); expect(result.problems).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
}
describe('native acquisition boundaries', { timeout: 30_000 }, () => {
  it('rejects malformed caller arguments without starting native work', async () => {
    const driver = await project();
    expect(() => new NpmDependencies('relative')).toThrow(TypeError);
    expect(() => new NpmDependencies(driver.root, { command: '' })).toThrow(TypeError);
    await expect(driver.client.read([{}] as unknown as Configuration['packages'])).rejects.toThrow(TypeError);
    expect(driver.spawned).not.toHaveBeenCalled();
  });
  it('preserves one observation for aliases sharing the same physical requirement', async () => {
    const driver = await project(); await driver.publish('example-storage', '2.1.0');
    driver.require('also-storage', 'npm:example-storage', '^2', ['build', 'test']);
    await driver.install();
    expect(driver.result).toMatchObject({ value: [{ name: 'npm:example-storage', version: '2.1.0' }], packages: [
      { name: 'npm:example-storage', requested: '^2', selected: '2.1.0', installed: '2.1.0' }], problems: [] });
    expect(driver.manifest.dependencies).toEqual({ 'example-storage': '^2' });
  });
  it('supports registry scoped package names', async () => {
    const driver = await project(); driver.requirements.splice(0);
    await driver.publish('@book/store', '2.1.0'); driver.require('store', 'npm:@book/store', '^2', ['runtime']);
    await driver.install(); expect(driver.result.value).toEqual([{ name: 'npm:@book/store', version: '2.1.0' }]);
  });
  it('reports a different ecosystem at the authored requirement', async () => {
    const driver = await project(); const result = await driver.client.read([{ alias: 'store', name: 'maven:store', version: '^2', phases: ['runtime'] }]);
    rejected(result, 'unsupported-package-ecosystem'); expect(result.problems[0]!.at).toEqual({ kind: 'dependency', path: ['packages', 0, 'name'] });
    expect(driver.spawned).not.toHaveBeenCalled();
  });
  it('rejects alias and location syntax rather than passing it as a command argument', async () => {
    const driver = await project(); const result = await driver.client.install([{ alias: 'store', name: 'npm:store@npm:other', version: '^2', phases: ['runtime'] }]);
    rejected(result, 'invalid-package-name'); expect(driver.spawned).not.toHaveBeenCalled();
  });
  it('rejects an invalid range before filesystem or native work', async () => {
    const driver = await project(); const result = await driver.client.install([{ alias: 'store', name: 'npm:store', version: 'git:main', phases: ['runtime'] }]);
    rejected(result, 'invalid-package-version'); expect(driver.spawned).not.toHaveBeenCalled();
  });
  it('does not overwrite duplicate native manifest properties', async () => {
    const driver = await project(); await driver.file('package.json', '{"dependencies":{},"dependencies":{"keep":"^1"}}');
    await driver.install(); rejected(driver.result, 'invalid-native-json'); expect(driver.after).toEqual(driver.before); expect(driver.spawned).not.toHaveBeenCalled();
  });
  it('does not repair malformed owned dependency groups', async () => {
    const driver = await project(); await driver.setManifest({ dependencies: ['example-storage'] });
    await driver.install(); rejected(driver.result, 'invalid-native-manifest'); expect(driver.after).toEqual(driver.before); expect(driver.spawned).not.toHaveBeenCalled();
  });
  it('does not orchestrate native workspaces', async () => {
    const driver = await project(); await driver.setManifest({ workspaces: ['packages/*'] });
    await driver.install(); rejected(driver.result, 'unsupported-native-project'); expect(driver.after).toEqual(driver.before); expect(driver.spawned).not.toHaveBeenCalled();
  });
  it('retains own special JSON keys and unrelated native constraints during a group edit', async () => {
    const driver = await project(); await driver.publish('example-storage', '2.1.0');
    await driver.file('package.json', '{"name":"consumer","__proto__":{"keep":true},"peerDependencies":{"example-storage":"^2"},"custom":{"constructor":"keep"}}');
    await driver.install(); expect(driver.result.problems).toEqual([]);
    expect(Object.hasOwn(driver.manifest, '__proto__')).toBe(true); expect(driver.manifest.__proto__).toEqual({ keep: true });
    expect(driver.manifest.peerDependencies).toEqual({ 'example-storage': '^2' }); expect(driver.manifest.custom).toEqual({ constructor: 'keep' });
  });
  it('does not report availability without a native lock', async () => {
    const driver = await project(true); await fs.unlink(join(driver.root, 'package-lock.json'));
    await driver.read(); rejected(driver.result, 'package-lock-unavailable'); expect(driver.result.packages[0]!.installed).toBe('2.1.0'); expect(driver.after).toEqual(driver.before);
  });
  it('does not accept an unsupported lockfile profile', async () => {
    const driver = await project(true); const lock = await driver.json('package-lock.json'); lock.lockfileVersion = 1;
    await driver.file('package-lock.json', JSON.stringify(lock)); await driver.read(); rejected(driver.result, 'unsupported-package-lock');
  });
  it('reports a missing native command without changing the project', async () => {
    const driver = await project(); driver.client = new NpmDependencies(driver.root, { command: join(driver.directory, 'missing-npm') });
    await driver.install(); rejected(driver.result, 'native-command-failed'); expect(driver.after).toEqual(driver.before);
  });
  it('keeps an installation failure even when a later independent read can succeed', async () => {
    const driver = await project(true), actual = native.runNative;
    const launch = vi.spyOn(native, 'runNative').mockImplementation((command, args, cwd) => args[0] === 'install'
      ? Promise.resolve({ code: 1, stdout: '', error: 'Native install failed after available files remained.' }) : actual(command, args, cwd));
    await driver.install(); const failed = driver.result; rejected(failed, 'package-install-failed');
    expect(failed.packages[0]!.installed).toBe('2.1.0'); launch.mockRestore();
    await driver.read(); expect(driver.result.value).toEqual([{ name: 'npm:example-storage', version: '2.1.0' }]); rejected(failed, 'package-install-failed');
  });
  it('serializes installs on one instance without a public process registry', async () => {
    const driver = await project(); let release!: () => void;
    vi.spyOn(native, 'runNative').mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); return { code: 1, stdout: '', error: 'interrupted' }; });
    const first = driver.client.install(driver.requirements);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    rejected(await driver.client.install(driver.requirements), 'installation-in-progress'); release(); rejected(await first, 'native-command-failed');
  });
  it('refuses a native manifest changed after capture and before edit', async () => {
    const driver = await project(), actual = native.runNative;
    vi.spyOn(native, 'runNative').mockImplementation(async (command, args, cwd) => {
      const result = await actual(command, args, cwd); if (args[0] === '--version') await driver.setManifest({ private: true, author: 'changed' }); return result;
    });
    await driver.install(); rejected(driver.result, 'stale-project'); expect(driver.manifest.author).toBe('changed'); expect(driver.manifest.dependencies).toBeUndefined();
  });
  it('does not claim a successful read after its manifest changes during native observation', async () => {
    const driver = await project(true), actual = native.runNative;
    vi.spyOn(native, 'runNative').mockImplementation(async (command, args, cwd) => {
      const result = await actual(command, args, cwd); if (args[0] === '--version') await driver.setManifest({ ...await driver.json('package.json'), description: 'changed' }); return result;
    });
    await driver.read(); rejected(driver.result, 'stale-project');
  });
  it('refuses a replaced root before writing or launching installation', async () => {
    const driver = await project(), actual = native.runNative;
    vi.spyOn(native, 'runNative').mockImplementation(async (command, args, cwd) => {
      const result = await actual(command, args, cwd);
      if (args[0] === '--version') { await fs.rename(driver.root, join(driver.directory, 'previous')); await fs.mkdir(driver.root); await driver.setManifest({ private: true }); }
      return result;
    });
    await driver.install(); rejected(driver.result, 'stale-project'); expect(driver.manifest.dependencies).toBeUndefined();
  });
  it('does not turn malformed native stdout into empty successful availability', async () => {
    const driver = await project(); vi.spyOn(native, 'runNative').mockImplementation(async (_command, args) => ({ code: 0, stdout: args[0] === '--version' ? '11.20.0' : 'not JSON' }));
    await driver.read(); rejected(driver.result, 'invalid-native-output');
  });
  it('records unexpected native termination as failure', async () => {
    const driver = await project(); vi.spyOn(native, 'runNative').mockImplementation(async (_command, args) => args[0] === '--version'
      ? { code: 0, stdout: '11.20.0' } : { code: null, stdout: '', error: 'Native process terminated by SIGTERM' });
    await driver.install(); rejected(driver.result, 'package-install-failed'); expect(driver.manifest.dependencies).toEqual({ 'example-storage': '^2' });
  });
  it('retains independent installed observations when one manifest cannot be decoded', async () => {
    const driver = await project(true); await driver.publish('example-check', '3.0.0');
    driver.require('checks', 'npm:example-check', '^3', ['test']); await driver.install(); expect(driver.result.problems).toEqual([]);
    await fs.writeFile(join(driver.root, 'node_modules/example-storage/package.json'), Buffer.from([0xff]));
    driver.result = await driver.client.read(driver.requirements); rejected(driver.result, 'invalid-native-json');
    expect(driver.result.packages).toContainEqual({ name: 'npm:example-check', requested: '^3', selected: '3.0.0', installed: '3.0.0' });
  });
  it('does not create npm logs in a project-local native cache during read', async () => {
    const driver = await project(true);
    await driver.file('.npmrc', `registry=${driver.registry}\ncache=${join(driver.root, 'native-cache').replaceAll('\\', '/')}\nfetch-retries=0\n`);
    await driver.read(); expect(driver.result.problems).toEqual([]); expect(driver.after).toEqual(driver.before);
    await expect(fs.access(join(driver.root, 'native-cache'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('refuses a temporary cache parent inside the project before creating or launching anything', async () => {
    const driver = await project(), temporary = vi.spyOn(os, 'tmpdir').mockReturnValue(driver.root);
    await driver.read(); rejected(driver.result, 'unsupported-native-project'); expect(driver.after).toEqual(driver.before); expect(driver.spawned).not.toHaveBeenCalled();
    expect(await fs.readdir(driver.root)).toEqual(expect.not.arrayContaining([expect.stringMatching(/^expec-npm-read-/)])); temporary.mockRestore();
  });
  it('removes only the operation-owned native read cache after failure', async () => {
    const driver = await project(), actual = native.runNative; let cache: string | undefined;
    vi.spyOn(native, 'runNative').mockImplementation((command, args, cwd) => {
      cache = args.find(arg => arg.startsWith('--cache='))?.slice(8); return actual(command, args, cwd);
    });
    await driver.read(); rejected(driver.result, 'package-lock-unavailable'); expect(cache).toBeDefined();
    await expect(fs.access(cache!)).rejects.toMatchObject({ code: 'ENOENT' }); expect(await fs.stat(driver.root)).toBeDefined();
  });
  it('keeps native global and prefix configuration from redirecting installation', async () => {
    const driver = await project(); await driver.publish('example-storage', '2.1.0');
    const other = join(driver.directory, 'global-destination');
    vi.stubEnv('npm_config_global', 'true'); vi.stubEnv('npm_config_prefix', other); onTestFinished(() => { vi.unstubAllEnvs(); });
    await driver.install(); expect(driver.result.problems).toEqual([]);
    expect(driver.result.value).toEqual([{ name: 'npm:example-storage', version: '2.1.0' }]);
    await expect(fs.access(other)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('refuses a linked native installation root before native effects', async () => {
    const driver = await project(); await driver.publish('example-storage', '2.1.0');
    const outside = join(driver.directory, 'outside-modules'); await fs.mkdir(outside); await fs.writeFile(join(outside, 'keep.txt'), 'keep');
    await fs.symlink(outside, join(driver.root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    driver.spawned.mockClear(); const before = await fs.readFile(join(driver.root, 'package.json'), 'utf8');
    const result = await driver.client.install(driver.requirements);
    rejected(result, 'unsupported-change'); expect(driver.spawned).not.toHaveBeenCalled();
    expect(await fs.readFile(join(driver.root, 'package.json'), 'utf8')).toBe(before);
    expect(await fs.readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
    expect((await fs.lstat(join(driver.root, 'node_modules'))).isSymbolicLink()).toBe(true);
  });
  it('refuses an aliased native lockfile before native effects', async () => {
    const driver = await project(true), outside = join(driver.directory, 'outside-lock.json');
    await fs.rename(join(driver.root, 'package-lock.json'), outside); await fs.link(outside, join(driver.root, 'package-lock.json'));
    driver.spawned.mockClear(); const before = await fs.readFile(outside, 'utf8'), result = await driver.client.install(driver.requirements);
    rejected(result, 'unsupported-change'); expect(driver.spawned).not.toHaveBeenCalled(); expect(await fs.readFile(outside, 'utf8')).toBe(before);
    expect((await fs.lstat(outside)).nlink).toBe(2);
  });
  it('rechecks the native installation directory before launching npm install', async () => {
    const driver = await project(), actual = native.runNative;
    vi.spyOn(native, 'runNative').mockImplementation(async (command, args, cwd) => {
      const result = await actual(command, args, cwd); if (args[0] === '--version') await fs.mkdir(join(driver.root, 'node_modules')); return result;
    });
    const result = await driver.client.install(driver.requirements); rejected(result, 'stale-project');
    expect(driver.spawned.mock.calls.some(call => (call[1] as string[] | undefined)?.includes('install'))).toBe(false);
  });
  it('refuses a shrinkwrap project without changing its selected native profile', async () => {
    const driver = await project(true), path = join(driver.root, 'npm-shrinkwrap.json');
    await fs.copyFile(join(driver.root, 'package-lock.json'), path);
    await driver.install(); rejected(driver.result, 'unsupported-native-project');
    expect(driver.spawned).not.toHaveBeenCalled(); expect(driver.after).toEqual(driver.before);
  });
});
