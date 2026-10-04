import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Diagnostic } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import { canonical } from './identity-baseline.js';
import { pythonConfiguration } from './python-profile.js';
import { PythonInputs, pythonEnvironment } from './python-inputs.js';
import { runPython } from './python-process.js';
import { outputProblem } from './output-documents.js';
import type { ArtifactAssociation } from './specification-identity.js';
import { nativeInputs } from './native-inputs.js';

export const pythonSelector = z.array(z.strictObject({ kind: z.enum(['class', 'function', 'method', 'field', 'parameter', 'type']), name: z.string().min(1) })).min(1);
const target = z.strictObject({ file: z.string(), line: z.number().int().positive(), column: z.number().int().nonnegative(), name: z.string(), builtin: z.boolean() });
const result = z.strictObject({
  files: z.array(z.string()),
  declarations: z.array(z.strictObject({ file: z.string(), declaration: pythonSelector, start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
    begin: z.number().int().nonnegative(), finish: z.number().int().nonnegative(), target })),
  uses: z.array(z.strictObject({ file: z.string(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), name: z.string(),
    owner: pythonSelector.or(z.tuple([])), member: z.boolean(), targets: z.array(target) })),
  problems: z.array(z.strictObject({ code: z.string(), file: z.string(), start: z.number().int().nonnegative().optional(), message: z.string() })),
  rewritten: z.array(z.strictObject({ file: z.string(), text: z.string() })).optional(),
});
export type PythonFacts = z.infer<typeof result>;
export const pythonTargetKey = (target: PythonFacts['declarations'][number]['target']): string => canonical([target.file, target.line, target.column]);

/** Stages supplied editable bytes; native acquisition and stale-input refusal remain explicit. */
export interface PythonRewrite { before: string; after: string; previous: readonly ArtifactAssociation[]; next: readonly ArtifactAssociation[] }
export async function inspectPython(snapshot: ProjectSnapshot, configFile?: string, rewrite?: PythonRewrite): Promise<{ value?: PythonFacts; problems: Diagnostic[] }> {
  if (!snapshot.complete) return { problems: [...snapshot.problems, outputProblem('incomplete-project', '', 'Native analysis requires a complete supplied project capture.')] };
  const configuration = pythonConfiguration(snapshot, configFile), problems = [...snapshot.problems, ...configuration.problems];
  if (!snapshot.complete || !configuration.value || problems.length) return { problems };
  const environment = pythonEnvironment(snapshot, configuration.value, configFile); problems.push(...environment.problems);
  if (!environment.value) return { problems };
  const inputs = new PythonInputs(); await inputs.capture(environment.value, configuration.value); problems.push(...inputs.problems);
  const supplied = nativeInputs(snapshot);
  if (!supplied || inputs.evidence().some(input => { const path = fileURLToPath(input.uri); return supplied.get(process.platform === 'win32' ? path.toLowerCase() : path) !== input.version; }))
    problems.push(outputProblem('native-input-changed', '', 'Native Python inputs differ from the supplied capture.'));
  if (problems.length) return { problems };
  const temporary = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-python-query-')), root = join(temporary, 'source');
  try {
    await fs.mkdir(root);
    const profile = configuration.value, selected = [...profile.sourceRoots.main, ...profile.sourceRoots.test];
    const files = snapshot.files.filter(file => /\.pyi?$/.test(file.path) && selected.some(path => file.path.startsWith(path + '/')));
    for (const file of files) {
      const path = resolve(root, file.path), inside = relative(root, path);
      if (isAbsolute(inside) || inside.startsWith('..')) throw new TypeError('Python source must stay within its captured project.');
      await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(path, file.bytes);
    }
    const request = { root, cache: join(temporary, 'cache'), files: files.map(file => file.path), sites: environment.value.environment.sites,
      main: profile.sourceRoots.main, paths: [...profile.sourcePath, ...environment.value.environment.sites, ...environment.value.python.stdlib],
      mainPaths: profile.sourceRoots.main.map(path => join(root, path)), testPaths: profile.sourceRoots.test.map(path => join(root, path)), ...(rewrite ? { rewrite } : {}) };
    const requestPath = join(temporary, 'request.json'); await fs.writeFile(requestPath, JSON.stringify(request));
    const run = await runPython(profile.python, [fileURLToPath(new URL('./python/inspect.py', import.meta.url)), requestPath], temporary);
    await inputs.verify(); problems.push(...inputs.problems);
    if (run.code !== 0 || run.error) problems.push(outputProblem('python-inspection-failed', '', run.error ?? 'Native Python inspection failed.'));
    if (problems.length) return { problems };
    let parsed: ReturnType<typeof result.safeParse>;
    try { parsed = result.safeParse(JSON.parse(run.text)); } catch { return { problems: [outputProblem('invalid-python-result', '', 'Native Python inspection returned invalid JSON.')] }; }
    if (!parsed.success) return { problems: [outputProblem('invalid-python-result', '', parsed.error.message)] };
    return { value: parsed.data, problems: parsed.data.problems.map(problem => ({ code: problem.code, message: problem.message,
      at: { kind: 'dependency', path: ['python', problem.file, ...problem.start === undefined ? [] : [problem.start]] }, related: [] })) };
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
