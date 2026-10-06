import { z } from 'zod';
import type { Configuration } from '../connection/configuration.js';
import type { Diagnostic } from '../../compiler/checking.js';
import { samePythonRelease } from './python-profile.js';

export const nativeRequirement = z.strictObject({ name: z.string(), requirement: z.string(), group: z.string() });
export const ownedPythonRequirement = nativeRequirement.extend({ group: z.enum(['', 'expec-build', 'expec-test']) }).refine(item =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.name) && item.requirement.startsWith(item.name + '==')
  && samePythonRelease(item.requirement.slice(item.name.length + 2), item.requirement.slice(item.name.length + 2)));
const version = z.strictObject({ name: z.string(), version: z.string() });
export const nativePackages = z.strictObject({
  requirements: z.array(nativeRequirement), selected: z.array(version), installed: z.array(version),
  python: z.strictObject({ version: z.string(), stdlib: z.array(z.string()), binaries: z.array(z.string()) }), sites: z.array(z.string()),
});
type PythonGroup = z.infer<typeof ownedPythonRequirement>['group'];
export type PythonRequest = { name: string; requested: string; groups: PythonGroup[] };
export const packageName = (name: string): string => name.toLowerCase().replace(/[-_.]+/g, '-');
export function pythonRequirements(packages: Configuration['packages'], problems: Diagnostic[]): PythonRequest[] {
  const requests = new Map<string, PythonRequest>();
  for (const [index, item] of packages.entries()) {
    const problem = (code: string, message: string) => problems.push({ code, message, at: { kind: 'dependency', path: ['packages', index] }, related: [] });
    if (!/^pypi:[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/.test(item.name)) { problem('unsupported-package-ecosystem', 'Use an explicit pypi distribution name.'); continue; }
    if (!samePythonRelease(item.version, item.version)) { problem('unsupported-package-version', 'Use an exact native two- or three-part release version.'); continue; }
    const name = packageName(item.name.slice(5)), previous = requests.get(name), groups = item.phases.map<PythonGroup>(phase => phase === 'runtime' ? '' : phase === 'build' ? 'expec-build' : 'expec-test');
    if (previous && !samePythonRelease(previous.requested, item.version)) problem('conflicting-package-requirements', 'Aliases request incompatible native versions of ' + name + '.');
    else requests.set(name, { name, requested: previous?.requested ?? item.version, groups: [...new Set([...(previous?.groups ?? []), ...groups])] });
  }
  for (const [name, version, group] of [['libcst', '1.9.0', 'expec-build'], ['jedi', '0.20.0', 'expec-build'], ['mypy', '2.4.0', 'expec-build'], ['pytest', '9.1.1', 'expec-test']] as const) {
    const request = requests.get(name);
    if (!request || !samePythonRelease(request.requested, version) || !request.groups.includes(group)) problems.push({
      code: 'python-tooling-required', message: 'The Python profile requires ' + name + '==' + version + ' in ' + group + '.',
      at: { kind: 'dependency', path: ['packages'] }, related: [],
    });
  }
  return [...requests.values()];
}
