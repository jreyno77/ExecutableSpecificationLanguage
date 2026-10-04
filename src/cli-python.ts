import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Configuration } from './configuration.js';
import type { PackageRead } from './npm-dependencies.js';
import type { ProjectContext } from './project-connection.js';
import { PythonContext } from './python-context.js';
import { readPythonPackages } from './python-acquisition.js';
import { pythonReportPath } from './python-profile.js';
import { outputProblem } from './output-documents.js';
import { pythonPackagePhases } from './cli-python-phases.js';

/** Retains the actual native package facts used by the checked command. */
export async function checkedPythonPackages(project: ProjectContext, configuration: Configuration, manifest: string,
  configFile = 'expec.python.json'): Promise<PackageRead & { inputs: { uri: string; version: string }[] }> {
  const context = new PythonContext(project, { configFile }), before = await context.readSnapshot();
  if (!before.complete) return { inputs: [], packages: [], problems: before.problems, deferred: [] };
  const read = await readPythonPackages(configuration, manifest, { configFile });
  const phases = read.value ? await pythonPackagePhases(before, configuration.packages, configFile) : [];
  const after = await context.readSnapshot(), problems = [...read.problems, ...phases, ...after.problems];
  if (!isDeepStrictEqual(before, after)) problems.push(outputProblem('stale-build-input', configFile, 'Native package inputs changed during checking.'));
  const inputs = [...before.nativeInputs ?? [], ...before.files.filter(file => [configFile, 'pyproject.toml', 'uv.lock', pythonReportPath].includes(file.path))
    .map(file => ({ uri: pathToFileURL(join(before.root.path, file.path)).href, version: file.version }))];
  return { packages: read.packages, inputs, problems, deferred: read.deferred,
    ...(read.value && after.complete && !problems.length ? { value: read.value } : {}) };
}
