import { isAbsolute } from 'node:path';
import { promises as fs } from 'node:fs';
import { satisfies, validRange } from 'semver';
import type { Check, Diagnostic } from '../../compiler/checking.js';
import type { Configuration } from '../connection/configuration.js';
import { fullVersion } from '../connection/configuration-schema.js';
import type { DependencyInventory } from './dependency-planner.js';
import { readJson } from '../connection/json-data.js';
import { runNative } from '../connection/native-process.js';
import { NpmProject, object } from './npm-project.js';
import { fail, message, problem, type ObservedFile, type ProjectFiles } from '../connection/project-files.js';
import { nativePath } from '../connection/source-files.js';

export interface PackageObservation { readonly name: string; readonly requested: string; readonly selected?: string; readonly installed?: string }
export interface PackageRead extends Check<DependencyInventory['packages']> { readonly packages: readonly PackageObservation[] }
export interface NpmOptions { readonly command?: string }
interface Request { name: string; native: string; requested: string; runtime: boolean }
const flags = ['--ignore-scripts', '--no-audit', '--no-fund', '--update-notifier=false', '--workspaces=false', '--include=dev'];
export class NpmDependencies {
  private readonly command: string;
  private installing = false;
  constructor(private readonly projectRoot: string, options: NpmOptions = {}) {
    if (!nativePath(projectRoot) || !isAbsolute(projectRoot) || !object(options) || Object.keys(options).some(key => key !== 'command')
      || options.command !== undefined && (!nativePath(options.command) || !options.command.trim())) throw new TypeError('Provide an absolute project root and optional nonblank native command.');
    this.command = options.command ?? 'npm';
  }
  read(packages: Configuration['packages']): Promise<PackageRead> { return this.perform(packages, false); }
  install(packages: Configuration['packages']): Promise<PackageRead> { return this.perform(packages, true); }
  private async perform(input: Configuration['packages'], install: boolean): Promise<PackageRead> {
    const problems: Diagnostic[] = [], requests = npmRequirements(input, problems);
    const observations: PackageObservation[] = requests.map(({ name, requested }) => ({ name, requested }));
    const result = (): PackageRead => ({ packages: observations, problems, deferred: [], ...(!problems.length ? {
      value: observations.map(item => ({ name: item.name, version: item.installed! })),
    } : {}) });
    const report = (code: string, text: string, path = '') => problems.push(problem({ path: this.projectRoot, identity: '' }, code, path, text));
    if (problems.length || !requests.length) return result();
    if (install && this.installing) { report('installation-in-progress', 'This instance already has an installation in progress.'); return result(); }
    if (install) this.installing = true;
    let cache: ProjectFiles | undefined;
    try {
      let project: NpmProject;
      try { project = await NpmProject.open(this.projectRoot); }
      catch (error) { record(error, problems, () => report('native-project-unavailable', message(error), 'package.json')); return result(); }
      const verifyInstallation = install ? await project.prepareInstall() : undefined;
      if (!install) cache = await project.readCache();
      const options = [...flags, '--global=false', '--prefix=' + project.files.root.path,
        ...(cache ? ['--cache=' + cache.root.path, '--logs-max=0', '--timing=false'] : [])];
      const version = await runNative(this.command, ['--version', ...options], project.files.root.path);
      if (version.code !== 0 || version.error) { report('native-command-failed', version.error ?? 'Cannot run npm.'); return result(); }
      if (!/^11\.\d+\.\d+$/.test(version.stdout.trim())) { report('unsupported-native-version', 'Expected npm11; observed ' + version.stdout.trim() + '.'); return result(); }
      if (install) {
        try {
          const manifest = await project.configure(requests);
          await project.verifyRoot(); await project.files.verify('package.json', manifest);
          await verifyInstallation!();
          const command = await runNative(this.command, ['install', '--package-lock=true', ...options], project.files.root.path);
          if (command.code !== 0 || command.error) report('package-install-failed', command.error ?? 'Native installation failed.');
        } catch (error) { record(error, problems, () => report('package-install-failed', message(error))); return result(); }
      }
      await this.observe(project, requests, observations, problems, options);
      if (!install) await project.files.verify('package.json', project.manifest);
      await project.verifyRoot();
    } catch (error) { record(error, problems, () => report('native-package-read-failed', message(error))); }
    finally {
      if (install) this.installing = false;
      if (cache) try { await cache.verifyRoot(); await fs.rm(cache.root.path, { recursive: true }); }
      catch (error) { report('native-cache-cleanup-failed', message(error)); }
    }
    return result();
  }
  private async observe(project: NpmProject, requests: Request[], observations: PackageObservation[], problems: Diagnostic[], options: readonly string[]): Promise<void> {
    const report = (code: string, text: string, path = '') => problems.push(problem(project.files.root, code, path, text));
    const captures: [string, ObservedFile][] = [];
    const lock = await project.json('package-lock.json'); captures.push(['package-lock.json', lock.observation]);
    if (!lock.data) report('package-lock-unavailable', 'No native package-lock.json selection exists.', 'package-lock.json');
    else if (![2, 3].includes(lock.data.lockfileVersion as number) || !object(lock.data.packages)) report('unsupported-package-lock', 'Expected a native npm lockfile with package entries.', 'package-lock.json');
    const views: { packages: Record<string, unknown>; locations: Record<string, unknown>[] }[] = [];
    for (const locked of [false, true]) {
      const command = await runNative(this.command, ['ls', '--json', '--long', '--depth=0', '--offline', '--package-lock=' + locked,
        ...(locked ? ['--package-lock-only'] : []), ...options], project.files.root.path);
      let invalid = false;
      const data = readJson(command.stdout, (_code, text) => { invalid = true; report('invalid-native-output', text); });
      if (!object(data) || data.dependencies !== undefined && !object(data.dependencies)) { invalid = true; report('invalid-native-output', 'npm ls must return a native object with a dependency map.'); }
      if (command.code !== 0 || command.error) report('native-package-read-failed', command.error ?? 'Native package listing failed.');
      const query = await runNative(this.command, ['query', ':root > *', '--offline', '--package-lock=' + locked,
        ...(locked ? ['--package-lock-only'] : []), ...options], project.files.root.path);
      const locations = readJson(query.stdout, (_code, text) => report('invalid-native-output', text));
      const valid = Array.isArray(locations) && locations.every(item => object(item) && typeof item.path === 'string' && typeof item.location === 'string');
      if (!valid) report('invalid-native-output', 'npm query must return native package locations.');
      if (query.code !== 0 || query.error) report('native-package-read-failed', query.error ?? 'Native package location query failed.');
      views.push({ packages: !invalid && object(data) && object(data.dependencies) ? data.dependencies : {}, locations: valid ? locations : [] });
    }
    const location = (item: Record<string, unknown>, view: number): string => {
      // Redacted absolute paths can correlate records, but never authorize filesystem access.
      const matches = views[view]!.locations.filter(candidate => candidate.path === item.path);
      if (typeof item.path !== 'string' || !isAbsolute(item.path) || matches.length !== 1) {
        fail(project.files.root, 'invalid-native-output', '', 'Expected one native relative location for the listed package.');
      }
      const match = matches[0]!;
      if (!fullVersion(match.version) || match.version !== item.version) report('invalid-native-output', 'Native package views disagree on the listed version.');
      return project.location(match.location as string);
    };
    for (const [index, request] of requests.entries()) {
      const installed = views[0]!.packages[request.native], selected = views[1]!.packages[request.native];
      const observation: { name: string; requested: string; selected?: string; installed?: string } = { name: request.name, requested: request.requested };
      observations[index] = observation;
      try {
        if (object(selected) && fullVersion(selected.version)) {
          observation.selected = selected.version;
          if (typeof selected.path !== 'string') report('invalid-native-output', 'Selected package has no native location.');
          else {
            const path = location(selected, 1), record = object(lock.data?.packages) ? lock.data.packages[path] : undefined;
            if (!object(record) || record.version !== selected.version || record.link === true) report('package-selection-mismatch', 'Native lock does not agree with selected ' + request.native + '.', 'package-lock.json');
          }
          if (selected.name !== undefined && selected.name !== request.native) report('unsupported-package-alias', 'Native key ' + request.native + ' selects ' + selected.name + '.');
        } else report('package-not-selected', 'No complete native lock selection for ' + request.native + '.', 'package-lock.json');
        if (object(installed) && typeof installed.path === 'string') {
          const path = location(installed, 0) + '/package.json', actual = await project.json(path); captures.push([path, actual.observation]);
          if (actual.data) {
            if (fullVersion(actual.data.version)) observation.installed = actual.data.version;
            else report('invalid-package-version', 'Installed ' + request.native + ' has no complete SemVer version.', path);
            if (actual.data.name !== request.native) report('package-name-mismatch', 'Requested ' + request.native + ' but installed manifest names ' + actual.data.name + '.', path);
          }
        }
        if (!observation.installed) report('package-not-installed', 'No actual installed package manifest for ' + request.native + '.');
        else {
          if (!satisfies(observation.installed, request.requested)) report('incompatible-package-version', request.native + '@' + observation.installed + ' does not satisfy ' + request.requested + '.');
          if (observation.selected !== observation.installed) report('package-selection-mismatch', 'Installed ' + request.native + '@' + observation.installed + ' does not match its native lock selection.');
        }
      } catch (error) { record(error, problems, () => report('native-package-read-failed', message(error))); }
    }
    for (const [path, observation] of captures) await project.files.verify(path, observation);
  }
}
function record(error: unknown, problems: Diagnostic[], fallback: () => void): void {
  if (object(error) && object(error.diagnostic)) problems.push(error.diagnostic as unknown as Diagnostic); else fallback();
}
export function npmRequirements(input: Configuration['packages'], problems: Diagnostic[]): Request[] {
  if (!Array.isArray(input) || input.some(item => !object(item) || typeof item.alias !== 'string' || !item.alias.trim()
    || typeof item.name !== 'string' || typeof item.version !== 'string' || !Array.isArray(item.phases) || !item.phases.length
    || item.phases.some((phase: unknown) => !['build', 'runtime', 'test'].includes(phase as string)))) throw new TypeError('Provide package requirements with alias, name, version and phases.');
  const selected = new Map<string, Request>();
  input.forEach((item, index) => {
    const report = (code: string, message: string, field: string) => problems.push({ code, message, at: { kind: 'dependency', path: ['packages', index, field] }, related: [] });
    if (!item.name.startsWith('npm:')) report('unsupported-package-ecosystem', 'Only explicitly qualified npm packages are supported.', 'name');
    else if (item.name.length > 218 || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(item.name.slice(4))) report('invalid-package-name', 'Provide a standard npm package name, without aliases or locations.', 'name');
    else if (!item.version.trim() || !validRange(item.version)) report('invalid-package-version', 'Provide a SemVer requirement.', 'version');
    else {
      const previous = selected.get(item.name);
      if (previous && previous.requested !== item.version) report('conflicting-package-requirements', 'Aliases of ' + item.name + ' must request the same authored range.', 'version');
      else if (previous) previous.runtime ||= item.phases.includes('runtime');
      else selected.set(item.name, { name: item.name, native: item.name.slice(4), requested: item.version, runtime: item.phases.includes('runtime') });
    }
  });
  return [...selected.values()];
}
