import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Configuration } from './configuration.js';
import type { ProjectContext } from './project-connection.js';
import type { PackageRead } from './npm-dependencies.js';
import { KotlinContext } from './kotlin-context.js';
import { KotlinDependencies } from './kotlin-dependencies.js';
import { kotlinBuildInput, kotlinReportPath } from './kotlin-configuration.js';
import { message, problem } from './project-files.js';

export const kotlinExclusions = ['.git', 'node_modules', '.gradle', '.kotlin', 'build'];

/** Retains the exact acquisition inputs admitted by check through the guarded build. */
export async function readKotlinPackages(project: ProjectContext, packages: Configuration['packages']): Promise<PackageRead & {
  inputs: { uri: string; version: string }[];
}> {
  try {
    const context = new KotlinContext(project), before = await context.readSnapshot();
    if (!before.complete) return { packages: [], problems: before.problems, deferred: [], inputs: [] };
    const result = await new KotlinDependencies(project.root.path).read(packages);
    const after = await context.readSnapshot();
    if (!isDeepStrictEqual(before, after)) return { packages: result.packages, deferred: result.deferred,
      problems: [...result.problems, problem(project.root, 'stale-build-input', '', 'Native acquisition inputs changed during package checking.')], inputs: [] };
    return { ...result, inputs: [...before.nativeInputs ?? [], ...before.files.filter(file =>
      file.path === kotlinReportPath || kotlinBuildInput(file.path, 'expec.kotlin.json')).map(file => ({
      uri: pathToFileURL(join(project.root.path, file.path)).href, version: file.version,
    }))] };
  } catch (error) {
    return { packages: [], deferred: [], inputs: [], problems: [problem(project.root, 'native-package-read-failed', '', message(error))] };
  }
}
