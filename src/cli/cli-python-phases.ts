import { pythonRuntime } from '../resources.js';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Diagnostic } from '../compiler/checking.js';
import type { Configuration } from '../project/connection/configuration.js';
import type { ProjectSnapshot } from '../project/connection/project-connection.js';
import { pythonConfiguration } from '../project/python/python-profile.js';
import { pythonEnvironment } from '../project/python/python-inputs.js';
import { runPython } from '../project/python/python-process.js';
import { outputProblem } from '../project/output/specification/output-documents.js';

const findings = z.array(z.strictObject({ code: z.string(), file: z.string(), start: z.number().int().nonnegative(), message: z.string() }));
/** Audits resolved imports only; the caller captures native inputs before and after this operation. */
export async function pythonPackagePhases(snapshot: ProjectSnapshot, packages: Configuration['packages'], configFile: string): Promise<Diagnostic[]> {
  const profile = pythonConfiguration(snapshot, configFile);
  if (!profile.value) return profile.problems;
  const environment = pythonEnvironment(snapshot, profile.value, configFile);
  if (!environment.value) return environment.problems;
  const parent = await fs.realpath(tmpdir()), inside = relative(snapshot.root.path, parent);
  if (!inside || !isAbsolute(inside) && inside !== '..' && !inside.startsWith('..' + sep))
    return [outputProblem('unsafe-native-temporary-directory', configFile, 'Native scratch files must be outside the connected project.')];
  const temporary = await fs.mkdtemp(join(parent, 'expec-python-phases-')), root = join(temporary, 'source'), owner = await fs.lstat(temporary, { bigint: true });
  const problems: Diagnostic[] = [];
  try {
    const selected = [...profile.value.sourceRoots.main, ...profile.value.sourceRoots.test];
    const files = snapshot.files.filter(file => /\.pyi?$/.test(file.path) && selected.some(path => file.path.startsWith(path + '/')));
    await fs.mkdir(root);
    for (const file of files) {
      const path = resolve(root, file.path), inside = relative(root, path);
      if (isAbsolute(inside) || inside.startsWith('..')) throw Error('Python source must stay within its captured project.');
      await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(path, file.bytes);
    }
    const request = join(temporary, 'request.json');
    await fs.writeFile(request, JSON.stringify({ root, cache: join(temporary, 'cache'), files: files.map(file => file.path), packages,
      sites: environment.value.environment.sites, stdlib: environment.value.python.stdlib, sourcePath: profile.value.sourcePath,
      mainPaths: profile.value.sourceRoots.main.map(path => join(root, path)) }));
    const run = await runPython(profile.value.python, [fileURLToPath(new URL('phase.py', pythonRuntime)), request], temporary);
    if (run.code !== 0 || run.error) problems.push(outputProblem('python-phase-check-failed', configFile, run.error ?? 'Native phase inspection failed.'));
    else {
      const parsed = findings.parse(JSON.parse(run.text));
      problems.push(...parsed.map(problem => ({ code: problem.code, message: problem.message,
        at: { kind: 'dependency' as const, path: ['python', problem.file, problem.start] }, related: [] })));
    }
  } catch (error) { problems.push(outputProblem('python-phase-check-failed', configFile, String(error))); }
  finally {
    try {
      const current = await fs.lstat(temporary, { bigint: true });
      if (dirname(temporary) !== parent || !temporary.startsWith(join(parent, 'expec-python-phases-')) || await fs.realpath(temporary) !== temporary
        || !current.isDirectory() || current.isSymbolicLink() || current.dev !== owner.dev || current.ino !== owner.ino) throw Error('Native temporary directory identity changed.');
      await fs.rm(temporary, { recursive: true, force: true });
    } catch (error) { problems.push(outputProblem('native-cleanup-failed', configFile, String(error))); }
  }
  return problems;
}
