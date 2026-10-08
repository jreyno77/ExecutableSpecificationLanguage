import { packageRoot } from '../../resources.js';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Diagnostic } from '../../compiler/checking.js';
import type { ProjectSnapshot } from '../connection/project-connection.js';
import { canonical } from '../../model/identity-baseline.js';
import { pythonConfiguration, pythonReportPath, type PythonProfile } from './python-profile.js';
import { PythonInputs, pythonEnvironment, type PythonEnvironment } from './python-inputs.js';
import { runPython } from './python-process.js';
import { outputProblem } from '../output/output-documents.js';
import type { ArtifactAssociation } from '../../model/specification-identity.js';
import { nativeInputs } from '../connection/native-inputs.js';

export const pythonSelector = z.array(z.strictObject({ kind: z.enum(['class', 'function', 'method', 'field', 'parameter', 'type']), name: z.string().min(1) })).min(1);
const target = z.strictObject({ file: z.string(), line: z.number().int().positive(), column: z.number().int().nonnegative(), name: z.string(), kind: z.string(), builtin: z.boolean() });
const declaration = z.strictObject({ file: z.string(), declaration: pythonSelector, start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
  begin: z.number().int().nonnegative(), finish: z.number().int().nonnegative(), target });
const result = z.strictObject({
  files: z.array(z.string()),
  declarations: z.array(declaration),
  uses: z.array(z.strictObject({ file: z.string(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), name: z.string(),
    owner: pythonSelector.or(z.tuple([])), member: z.boolean(), targets: z.array(target) })),
  problems: z.array(z.strictObject({ code: z.string(), file: z.string(), start: z.number().int().nonnegative().optional(), message: z.string() })),
  rewritten: z.array(z.strictObject({ file: z.string(), text: z.string() })).optional(),
  generated: z.string().optional(),
  driver: z.array(declaration).optional(),
  fixture: z.strictObject({ name: z.string(), generator: z.boolean() }).optional(),
  owned: z.array(z.strictObject({ file: z.string(), text: z.string(), driver: z.boolean() })).optional(),
});
export type PythonFacts = z.infer<typeof result>;
export const pythonTargetKey = (target: PythonFacts['declarations'][number]['target']): string => canonical([target.file, target.line, target.column]);

/** Stages supplied editable bytes; native acquisition and stale-input refusal remain explicit. */
export interface PythonRewrite {
  before: string; after?: string; previous: readonly ArtifactAssociation[]; next: readonly ArtifactAssociation[]; authored?: readonly string[];
  move?: { from: string; to: string; old: string; next: string };
}
type AcceptanceFile = { file: string; text: string; driver: boolean };
type PytestFixture = { file: string; name: string; consumer?: string };
type InspectionRequest = (PythonRewrite | { tests: readonly AcceptanceFile[]; desiredTests?: readonly AcceptanceFile[];
  testIdentities?: { previous: readonly ArtifactAssociation[]; next: readonly ArtifactAssociation[]; restoreOnly?: boolean }; retireTests?: readonly string[] }
  | { consumer: string; file: string; target: PythonFacts['declarations'][number]['target'] } | { fixture: PytestFixture }
  | { contract: string; importChecks: readonly { native: string; text: string }[] }) & { fixture?: PytestFixture };
type Inspection = { value?: PythonFacts; problems: Diagnostic[] };
type InspectionKey = [ProjectSnapshot, string | undefined, readonly AcceptanceFile[] | undefined];

/** One owned successful analysis; every reuse still verifies the actual native inputs. */
export class PythonInspection {
  private completed: { key: InspectionKey; value: PythonFacts; inputs: PythonInputs } | undefined;
  private generation = 0;
  async inspect(snapshot: ProjectSnapshot, configFile?: string, tests?: readonly AcceptanceFile[]): Promise<Inspection> {
    const key: InspectionKey = structuredClone([snapshot, configFile, tests]), generation = ++this.generation, completed = this.completed;
    if (completed && isDeepStrictEqual(completed.key, key)) {
      const problems = await completed.inputs.verify();
      if ((problems.length || !isDeepStrictEqual(key, structuredClone([snapshot, configFile, tests])))
        && generation === this.generation) this.completed = undefined;
      return problems.length ? { problems } : { value: structuredClone(completed.value), problems };
    }
    this.completed = undefined;
    const [captured, configuration, baseline] = key;
    const inspected = await analyzePython(captured, configuration, baseline ? { tests: baseline } : undefined);
    if (inspected.value && !inspected.problems.length && inspected.inputs && generation === this.generation
      && isDeepStrictEqual(key, structuredClone([snapshot, configFile, tests])))
      this.completed = { key, value: structuredClone(inspected.value), inputs: inspected.inputs };
    return { ...inspected.value ? { value: structuredClone(inspected.value) } : {}, problems: inspected.problems };
  }
}

export async function inspectPython(snapshot: ProjectSnapshot, configFile?: string, rewrite?: InspectionRequest): Promise<Inspection> {
  const { inputs: _inputs, ...inspected } = await analyzePython(snapshot, configFile, rewrite);
  return inspected;
}

async function analyzePython(snapshot: ProjectSnapshot, configFile?: string, rewrite?: InspectionRequest): Promise<Inspection & { inputs?: PythonInputs }> {
  if (!snapshot.complete) return { problems: [...snapshot.problems, outputProblem('incomplete-project', '', 'Native analysis requires a complete supplied project capture.')] };
  const configuration = pythonConfiguration(snapshot, configFile), problems = [...snapshot.problems, ...configuration.problems];
  if (!snapshot.complete || !configuration.value || problems.length) return { problems };
  const environment = pythonEnvironment(snapshot, configuration.value, configFile); problems.push(...environment.problems);
  if (!environment.value) return { problems };
  const inputs = new PythonInputs(); await inputs.capture(environment.value, configuration.value); problems.push(...inputs.problems);
  const supplied = nativeInputs(snapshot);
  const changed = supplied && inputs.evidence().find(input => { const path = fileURLToPath(input.uri); return supplied.get(process.platform === 'win32' ? path.toLowerCase() : path) !== input.version; });
  if (!supplied || changed)
    problems.push(outputProblem('native-input-changed', changed ? fileURLToPath(changed.uri) : pythonReportPath, 'Native Python inputs differ from the supplied capture.'));
  if (problems.length) return { problems };
  const run = await stagePython(snapshot, configuration.value, environment.value, rewrite);
  problems.push(...await inputs.verify());
  if (run.code !== 0 || run.error) problems.push(outputProblem('python-inspection-failed', '', run.error ?? 'Native Python inspection failed.'));
  if (problems.length) return { problems };
  let parsed: ReturnType<typeof result.safeParse>;
  try { parsed = result.safeParse(JSON.parse(run.text)); } catch { return { problems: [outputProblem('invalid-python-result', '', 'Native Python inspection returned invalid JSON.')] }; }
  if (!parsed.success) return { problems: [outputProblem('invalid-python-result', '', parsed.error.message)] };
  return { value: parsed.data, inputs, problems: parsed.data.problems.map(problem => ({ code: problem.code, message: problem.message,
    at: { kind: 'dependency', path: ['python', problem.file, ...problem.start === undefined ? [] : [problem.start]] }, related: [] })) };
}

async function stagePython(snapshot: ProjectSnapshot, profile: PythonProfile, environment: PythonEnvironment, rewrite?: InspectionRequest): Promise<Awaited<ReturnType<typeof runPython>>> {
  const temporary = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-python-query-')), root = join(temporary, 'source');
  try {
    await fs.mkdir(root);
    const selected = [...profile.sourceRoots.main, ...profile.sourceRoots.test];
    const files = snapshot.files.filter(file => /\.pyi?$/.test(file.path) && selected.some(path => file.path.startsWith(path + '/')));
    for (const file of files) {
      const path = resolve(root, file.path), inside = relative(root, path);
      if (isAbsolute(inside) || inside.startsWith('..')) throw new TypeError('Python source must stay within its captured project.');
      await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(path, file.bytes);
    }
    const request = { root, cache: join(temporary, 'cache'), files: files.map(file => file.path), sites: environment.environment.sites,
      main: profile.sourceRoots.main, paths: [...profile.sourcePath, ...environment.environment.sites, ...environment.python.stdlib],
      stdlib: environment.python.stdlib, sourcePaths: profile.sourcePath,
      mainPaths: profile.sourceRoots.main.map(path => join(root, path)), testPaths: profile.sourceRoots.test.map(path => join(root, path)), ...(rewrite ? 'tests' in rewrite || 'consumer' in rewrite || 'fixture' in rewrite || 'contract' in rewrite ? rewrite : { rewrite } : {}) };
    const requestPath = join(temporary, 'request.json'); await fs.writeFile(requestPath, JSON.stringify(request));
    return await runPython(profile.python, [fileURLToPath(new URL('project/python/resources/inspect.py', packageRoot)), requestPath], temporary);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
