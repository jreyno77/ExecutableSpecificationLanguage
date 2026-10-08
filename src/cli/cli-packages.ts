import { pathToFileURL } from 'node:url';
import type { Configuration } from '../project/connection/configuration.js';
import { NpmDependencies, npmRequirements, type PackageRead } from '../project/dependencies/npm-dependencies.js';
import type { ProjectRoot } from '../project/connection/project-connection.js';
import { ProjectFiles, message, problem } from '../project/connection/project-files.js';

/** Keeps the exact native facts used to admit requested packages through later writes. */
export async function readPackages(root: ProjectRoot, packages: Configuration['packages']): Promise<PackageRead & {
  inputs: { uri: string; version: string }[];
}> {
  const problems: PackageRead['problems'][number][] = [], requests = npmRequirements(packages, problems), files = new ProjectFiles(root);
  if (problems.length) return { inputs: [], packages: [], problems, deferred: [] };
  try {
    const paths = ['package.json', 'package-lock.json', ...requests.map(request => 'node_modules/' + request.native + '/package.json')];
    const settled = await Promise.allSettled(paths.map(async path => ({ path, observed: await files.capture(path) })));
    const captures = settled.map(result => { if (result.status === 'rejected') throw result.reason; return result.value; });
    const read = await new NpmDependencies(root.path).read(packages);
    for (const { path, observed } of captures) await files.verify(path, observed);
    return { ...read, inputs: captures.flatMap(({ path, observed }) => observed.value.state === 'file'
      ? [{ uri: pathToFileURL(files.path(path)).href, version: observed.value.version }] : []) };
  } catch (error) {
    return { inputs: [], packages: [], problems: [problem(root, 'stale-build-input', '', message(error))], deferred: [] };
  }
}
