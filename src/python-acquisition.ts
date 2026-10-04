import type { Configuration } from './configuration.js';
import type { Diagnostic } from './checking.js';
import type { PackageRead, PackageObservation } from './npm-dependencies.js';
import type { FileObservation } from './project-writer.js';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { ProjectConnector } from './project-connection.js';
import { ProjectFiles, message, sameObservation, type ObservedFile } from './project-files.js';
import { outputProblem } from './output-documents.js';
import { pythonConfiguration, pythonExclusions, pythonPath, pythonReportPath, samePythonRelease } from './python-profile.js';
import { pythonEnvironment, pythonEnvironmentSchema } from './python-inputs.js';
import { pythonToolchain } from './python-initialization.js';
import { nativePackages, ownedPythonRequirement, packageName, pythonRequirements } from './python-packages.js';
import { runPython } from './python-process.js';
import { readJson } from './json-data.js';

type Installation = PackageRead & { readonly effects: readonly FileObservation[] };
export function installPython(configuration: Configuration, manifest: string, options: { configFile?: string; offline?: boolean } = {}): Promise<Installation> {
  return acquire(configuration, manifest, options.configFile ?? 'expec.python.json', true, options.offline ?? false);
}
export function readPythonPackages(configuration: Configuration, manifest: string, options: { configFile?: string } = {}): Promise<PackageRead> {
  return acquire(configuration, manifest, options.configFile ?? 'expec.python.json', false, true);
}
async function acquire(configuration: Configuration, manifest: string, configFile: string, install: boolean, offline: boolean): Promise<Installation> {
  if (!isAbsolute(manifest) || !pythonPath(configFile) || typeof offline !== 'boolean') throw TypeError('Provide an absolute manifest filename and portable Python configuration path.');
  const problems: Diagnostic[] = [], requests = pythonRequirements(configuration.packages, problems);
  const packages: PackageObservation[] = requests.map(item => ({ name: 'pypi:' + item.name, requested: item.requested })), effects: FileObservation[] = [];
  const result = (): Installation => ({ packages, effects, problems, deferred: [], ...(!problems.length ? { value: packages.map(item => ({ name: item.name, version: item.installed! })) } : {}) });
  const problem = (code: string, text: string, path = configFile) => problems.push(outputProblem(code, path, text));
  if (problems.length) return result();
  let files: ProjectFiles | undefined, temporary: string | undefined, locked = false;
  const touched = new Map<string, ObservedFile>();
  try {
    const connected = await new ProjectConnector(manifest, { excludeNames: pythonExclusions }).connect(configuration);
    if (connected.value?.status !== 'connected') { problems.push(...connected.problems); problem('project-unavailable', 'Connect an existing Python project.'); return result(); }
    const context = connected.value.context, snapshot = await context.readSnapshot();
    files = new ProjectFiles(context.root);
    const selected = pythonConfiguration(snapshot, configFile); problems.push(...snapshot.problems, ...selected.problems);
    if (!snapshot.complete || !selected.value || problems.length) return result();
    const profile = selected.value;
    await pythonToolchain(profile.python, profile.uv);
    const inputs = new Map<string, ObservedFile>();
    for (const path of [configFile, 'pyproject.toml', 'uv.lock', pythonReportPath]) inputs.set(path, await files.read(path));
    const capturedConfig = snapshot.files.find(file => file.path === configFile)!;
    const currentConfig = inputs.get(configFile)!.value;
    if (currentConfig.state !== 'file' || !Buffer.from(currentConfig.bytes).equals(capturedConfig.bytes)) {
      problem('stale-project', 'The selected Python configuration changed before acquisition.'); return result();
    }
    if (inputs.get('pyproject.toml')!.value.state !== 'file') { problem('missing-native-project', 'Provide ordinary pyproject.toml.', 'pyproject.toml'); return result(); }
    await files.ancestors(profile.environment + '/pyvenv.cfg');
    await files.ancestors('.uv-cache/metadata');
    const old = inputs.get(pythonReportPath)!.value;
    const recovery = z.strictObject({ format: z.literal(1), pending: z.literal(true), config: z.string().regex(/^[a-f0-9]{64}$/), owned: z.array(ownedPythonRequirement) });
    const previous = old.state === 'file' ? z.union([pythonEnvironmentSchema, recovery]).safeParse(readJson(
      new TextDecoder('utf-8', { fatal: true }).decode(old.bytes), (_code, text) => { throw Error(text); })) : undefined;
    if (previous && !previous.success) { problem('invalid-python-environment', 'Malformed native ownership cannot authorize dependency edits.', pythonReportPath); return result(); }
    const recorded = previous?.data;
    let owned = recorded?.owned ?? [];
    temporary = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-python-acquire-'));
    const observe = async () => {
      const native = await runPython(profile.python, [fileURLToPath(new URL('./python/acquisition.py', import.meta.url)), files!.root.path, files!.path(profile.environment)], temporary!);
      if (native.code !== 0 || native.error) throw Error(native.error ?? native.text);
      return nativePackages.parse(readJson(native.text, (_code, text) => { throw Error(text); }));
    };
    let native = await observe();
    for (const item of owned) {
      const current = native.requirements.filter(value => value.name === item.name && value.group === item.group);
      if (current.length && (current.length !== 1 || current[0]!.requirement !== item.requirement)) problem('native-dependency-conflict', 'An owned native requirement changed: ' + item.name, 'pyproject.toml');
    }
    for (const request of requests) for (const group of request.groups) {
      const current = native.requirements.filter(item => item.name === request.name && item.group === group);
      if (current.length > 1 || current.some(item => !owned.some(previous => previous.name === item.name && previous.group === group)
        && !samePythonRelease(item.requirement.replace(/^[A-Za-z0-9._-]+\s*==\s*/, ''), request.requested)))
        problem('native-dependency-conflict', 'The handwritten requirement conflicts with ' + request.name + '==' + request.requested + ' in ' + group + '.', 'pyproject.toml');
    }
    if (problems.length) return result();
    if (install) {
      await files.acquire(); locked = true;
      for (const [path, value] of inputs) await files.verify(path, value);
      for (const path of ['pyproject.toml', 'uv.lock', pythonReportPath, profile.environment + '/pyvenv.cfg']) touched.set(path, await files.read(path));
      const pending = async () => {
        await files!.write(pythonReportPath, new TextEncoder().encode(JSON.stringify({ ...recorded, format: 1, pending: true, config: currentConfig.version, owned }) + '\n'), inputs.get(pythonReportPath)!);
        inputs.set(pythonReportPath, await files!.read(pythonReportPath));
      };
      await pending();
      const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PYTHON|PYTEST|VIRTUAL_ENV|UV_|PIP_)/i.test(key)));
      const invoke = async (args: string[]) => {
        await files!.verifyRoot(); await files!.verifyLock();
        await files!.ancestors(profile.environment + '/pyvenv.cfg'); await files!.ancestors('.uv-cache/metadata');
        for (const [path, value] of inputs) await files!.verify(path, value);
        try { await promisify(execFile)(profile.uv, ['--no-config', '--no-progress', '--project', files!.root.path,
          '--cache-dir', files!.path('.uv-cache'), ...(offline ? ['--offline'] : []), ...args,
          ...(args.includes('--frozen') ? [] : ['--default-index', 'https://pypi.org/simple'])], {
          cwd: files!.root.path, env: { ...environment, UV_PROJECT_ENVIRONMENT: files!.path(profile.environment),
            UV_PYTHON: profile.python, UV_PYTHON_DOWNLOADS: 'never', UV_NO_MANAGED_PYTHON: 'true', UV_LINK_MODE: 'copy' },
          windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
        }); } finally {
          await files!.verifyRoot(); await files!.verifyLock(); await files!.verify(configFile, inputs.get(configFile)!);
          await files!.ancestors(profile.environment + '/pyvenv.cfg'); await files!.ancestors('.uv-cache/metadata');
          await files!.verify(pythonReportPath, inputs.get(pythonReportPath)!);
          for (const path of ['pyproject.toml', 'uv.lock']) inputs.set(path, await files!.read(path));
        }
      };
      for (const entry of [...owned]) {
        const current = native.requirements.find(item => item.name === entry.name && item.group === entry.group);
        const request = requests.find(item => item.name === entry.name && item.groups.includes(entry.group));
        if (current && (!request || !samePythonRelease(entry.requirement.split('==')[1] ?? '', request.requested)))
          await invoke(['remove', entry.name, '--frozen', ...(!entry.group ? [] : ['--group', entry.group])]);
        if (!current || !request || !samePythonRelease(entry.requirement.split('==')[1] ?? '', request.requested)) owned = owned.filter(item => item !== entry);
      }
      native = await observe();
      for (const request of requests) for (const group of request.groups) if (!native.requirements.some(item => item.name === request.name && item.group === group)) {
        const requirement = request.name + '==' + request.requested;
        await invoke(['add', requirement, '--frozen', '--no-workspace', ...(!group ? [] : ['--group', group])]);
        owned.push({ name: request.name, requirement, group }); await pending();
      }
      await pending();
      await invoke(['lock', '--no-sources', '--no-build', '--no-python-downloads', '--python', profile.python]);
      await invoke(['sync', '--locked', '--all-groups', '--inexact', '--no-install-project', '--no-sources', '--no-build', '--no-python-downloads', '--python', profile.python]);
      native = await observe();
    } else {
      const recorded = pythonEnvironment(snapshot, profile, configFile); problems.push(...recorded.problems);
      if (!recorded.value) return result();
      if (configuration.packages.some(item => !recorded.value!.packages.some(found => found.alias === item.alias
        && found.name === packageName(item.name.slice(5)) && samePythonRelease(found.version, item.version)
        && [...found.phases].sort().join() === [...item.phases].sort().join())) || recorded.value.packages.length !== configuration.packages.length)
        problem('python-install-required', 'The requested native packages or phases changed; run an explicit install.', pythonReportPath);
    }
    for (const [index, request] of requests.entries()) {
      const installed = native.installed.filter(item => item.name === request.name), selected = native.selected.filter(item => item.name === request.name && samePythonRelease(item.version, installed[0]?.version ?? ''));
      packages[index] = { name: 'pypi:' + request.name, requested: request.requested, ...(installed.length === 1 ? { installed: installed[0]!.version } : {}), ...(selected.length === 1 ? { selected: selected[0]!.version } : {}) };
      if (installed.length !== 1 || selected.length !== 1 || !samePythonRelease(installed[0]!.version, request.requested))
        problem('package-selection-mismatch', 'Requested, locked and installed versions disagree for ' + request.name + '.', 'uv.lock');
      for (const group of request.groups) if (!native.requirements.some(item => item.name === request.name && item.group === group
        && samePythonRelease(item.requirement.replace(/^[A-Za-z0-9._-]+\s*==\s*/, ''), request.requested)))
        problem('native-dependency-conflict', 'The actual native phase requirement disagrees for ' + request.name + '.', 'pyproject.toml');
    }
    if (!problems.length && install) {
      const digest = (path: string) => { const value = inputs.get(path)!.value; if (value.state !== 'file') throw Error('Missing native input ' + path); return value.version; };
      const report = pythonEnvironmentSchema.parse({ format: 1, config: digest(configFile), pyproject: digest('pyproject.toml'), lock: digest('uv.lock'),
        python: { path: profile.python, ...native.python }, uv: { path: profile.uv, version: '0.12.23' },
        environment: { path: files.path(profile.environment), sites: native.sites },
        tools: Object.fromEntries(['libcst', 'jedi', 'mypy', 'pytest'].map(name => [name, native.installed.find(item => item.name === name)?.version])),
        packages: configuration.packages.map(item => ({ alias: item.alias, name: packageName(item.name.slice(5)), version: native.installed.find(found => found.name === packageName(item.name.slice(5)))!.version, phases: item.phases })), owned });
      for (const [path, value] of inputs) await files.verify(path, value);
      await files.write(pythonReportPath, new TextEncoder().encode(JSON.stringify(report, null, 2) + '\n'), inputs.get(pythonReportPath)!);
    } else if (!install) for (const [path, value] of inputs) await files.verify(path, value);
  } catch (error) {
    const diagnostic = (error as { diagnostic?: Diagnostic }).diagnostic;
    if (diagnostic) problems.push(diagnostic); else problem(install ? 'package-install-failed' : 'native-package-read-failed', message(error));
  } finally {
    if (files) {
      for (const [path, before] of touched) { const after = await files.observe(path); if (!sameObservation(before.value, after)) effects.push(after); }
      if (locked) await files.cleanup(problems);
    }
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  }
  return result();
}
