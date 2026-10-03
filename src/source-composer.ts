import type { ModuleModel } from './model.js';
import { resolveModules, type Resolution, type ResolutionDependencies } from './resolution.js';
import { Modules } from './resolution/modules.js';

export type ModuleLocator = (owner: string, authoredLocator: string) => string | undefined;

export class SourceComposer {
  constructor(private readonly locate: ModuleLocator = (_owner, authored) => authored) {
    if (typeof locate !== 'function') throw new TypeError('A module locator must be a function.');
  }
  compose(entry: ModuleModel, dependencies: ResolutionDependencies): Resolution {
    return resolveModules(new Modules(entry, dependencies.modules, this.locate), dependencies.packages);
  }
}
