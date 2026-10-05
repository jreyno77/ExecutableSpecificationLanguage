import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type { CheckedManifest } from './cli-check.js';
import { cliProblem } from './cli-check.js';
import type { ProjectContext } from '../project/connection/project-connection.js';
import { JavaContext } from '../project/java/java-context.js';
import { readJavaPackages } from '../project/java/java-acquisition.js';
import { javaBuildInputs } from '../project/java/java-settings.js';
import { javaReport } from '../project/java/java-inputs.js';
import { hash } from '../project/connection/project-files.js';

export const javaCliExclusions = ['.git', 'node_modules', '.gradle', 'build'];

/** Retains the native facts that admitted Java packages through later CLI writes. */
export async function checkedJavaPackages(checked: CheckedManifest, project: ProjectContext, configFile: string) {
  const context = new JavaContext(project, { configFile }), before = await context.readSnapshot();
  const read = await readJavaPackages(checked.configuration!, checked.manifest, { configFile });
  const after = await context.readSnapshot(), problems = [...before.problems, ...read.problems, ...after.problems];
  if (!isDeepStrictEqual(before, after)) problems.push(cliProblem('stale-build-input', 'Java inputs changed while package availability was checked.', checked.manifest));
  const paths = new Set([...javaBuildInputs(configFile), javaReport, 'gradle.properties']);
  return { ...read, ...(problems.length ? { value: undefined } : {}), problems,
    inputs: [...before.nativeInputs ?? [], ...before.files.filter(file => paths.has(file.path))
      .map(file => ({ uri: pathToFileURL(join(before.root.path, file.path)).href, version: hash(file.bytes) }))] };
}
