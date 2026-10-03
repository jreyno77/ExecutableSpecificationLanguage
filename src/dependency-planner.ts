import { satisfies } from 'semver';
import type { Check, Diagnostic } from './checking.js';
import type { Configuration } from './configuration.js';
import { fullVersion } from './configuration-schema.js';
import type { ModuleModel } from './model.js';
import type { ResolutionDependencies } from './resolution.js';

export interface DependencyInventory {
  readonly modules: readonly { readonly version: string; readonly model: ModuleModel }[];
  readonly packages: readonly { readonly name: string; readonly version: string }[];
}
export class DependencyPlanner {
  resolve(configuration: Configuration, available: DependencyInventory): Check<ResolutionDependencies> {
    const problems: Diagnostic[] = [];
    const modules = inventory(available.modules, 'modules', value => value.model.locator, ['model', 'locator'], problems);
    const packages = inventory(available.packages, 'packages', value => value.name, ['name'], problems);
    const match = <T extends { readonly version: string }>(name: string, range: string, supplied: Map<string, Available<T>>,
      kind: 'libraries' | 'packages', index: number): T | undefined => {
      const item = supplied.get(name);
      if (!item) problems.push({ code: kind === 'libraries' ? 'unavailable-library' : 'unavailable-package',
        message: `${kind === 'libraries' ? 'Library' : 'Package'} ${name} is not supplied.`,
        at: { kind: 'dependency', path: ['manifest', configuration.sourceId, kind, index, kind === 'libraries' ? 'module' : 'name'] }, related: [] });
      else if (item.valid) {
        if (satisfies(item.value.version, range, { loose: false, includePrerelease: false })) return item.value;
        problems.push({ code: 'incompatible-version', message: `${name} requires ${range}; supplied version is ${item.value.version}.`,
          at: { kind: 'dependency', path: ['manifest', configuration.sourceId, kind, index, 'version'] },
          related: [{ kind: 'dependency', path: ['inventory', kind === 'libraries' ? 'modules' : 'packages', item.index, 'version'] }] });
      }
      return undefined;
    };
    const selected = configuration.libraries.flatMap((library, index) => {
      const supplied = match(library.module, library.version, modules, 'libraries', index);
      return supplied ? [supplied.model] : [];
    });
    const availability = configuration.packages.flatMap((dependency, index) => match(dependency.name, dependency.version, packages, 'packages', index)
      ? [{ alias: dependency.alias, phases: [...dependency.phases] }] : []);
    return { ...(!problems.length ? { value: { modules: selected, packages: availability } } : {}), problems, deferred: [] };
  }
}

interface Available<T> { readonly value: T; readonly index: number; valid: boolean }
function inventory<T extends { readonly version: string }>(values: readonly T[], kind: 'modules' | 'packages',
  name: (value: T) => string, field: string[], problems: Diagnostic[]): Map<string, Available<T>> {
  const result = new Map<string, Available<T>>();
  values.forEach((value, index) => {
    const id = name(value), previous = result.get(id), named = typeof id === 'string' && id.trim().length > 0;
    const versioned = fullVersion(value.version);
    const at = (position: number, path: string[]) => ({ kind: 'dependency' as const, path: ['inventory', kind, position, ...path] });
    if (!named) problems.push({ code: 'invalid-inventory', message: 'Provide a nonblank dependency identity.', at: at(index, field), related: [] });
    if (previous) {
      previous.valid = false;
      problems.push({ code: 'invalid-inventory', message: `${id} is supplied more than once.`, at: at(index, field), related: [at(previous.index, field)] });
    }
    if (!versioned) problems.push({ code: 'invalid-inventory', message: 'Provide a complete SemVer version, such as 1.2.3.',
      at: at(index, ['version']), related: [] });
    if (!previous) result.set(id, { value, index, valid: named && versioned });
  });
  return result;
}
