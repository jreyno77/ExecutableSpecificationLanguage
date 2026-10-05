import { z } from 'zod';
import type { Diagnostic } from './checking.js';
import type { OptionProblem } from './configuration.js';
import type { ProjectSnapshot } from './project-connection.js';
import { identifier, jsonData, locatorSchema } from './identity-baseline.js';
import { literal } from './project-files.js';
import { readJson } from './json-data.js';
import { isAbsolute } from 'node:path';
import { nativeInputs } from './native-inputs.js';
import { validateReadOnly } from './project-readonly.js';

const keywords = new Set('abstract assert boolean break byte case catch char class const continue default do double else enum exports extends final finally float for goto if implements import instanceof int interface long module native new non-sealed open opens package permits private protected provides public record requires return sealed short static strictfp super switch synchronized this throw throws to transient transitive try uses var void volatile while with yield _ true false null'.split(' '));
export const javaName = (value: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) && !keywords.has(value);
const name = z.string().refine(javaName, 'Provide an explicit Java identifier.');
const path = z.string().refine(literal, 'Provide a literal portable project-relative path.');
const qualified = z.string().refine(value => value.split('.').every(javaName), 'Provide a dot-separated Java name.');
const names = z.array(z.union([
  z.strictObject({ id: identifier, name }),
  z.strictObject({ declaration: z.array(z.string().min(1)).min(1), module: z.string().min(1).optional(), name }),
]));
const imports = z.array(z.strictObject({ module: z.string().min(1), declaration: z.array(z.string().min(1)).min(1), name: qualified }));
const common = { package: qualified, configFile: path.optional(), adoptExisting: z.boolean().optional(), names: names.optional(), imports: imports.optional() };
export const javaOptions = z.strictObject({ ...common, directory: path.optional(), functionsClass: name.optional() });
export const javaAcceptanceOptions = z.strictObject({ ...common, testRoot: path.optional(), domain: name,
  driver: locatorSchema.optional(), fixture: locatorSchema.optional() });
export const javaQueryOptions = z.strictObject({ outputId: z.string().trim().min(1), configFile: path.optional() });
export const javaContextOptions = z.strictObject({ configFile: path.optional() });
export function optionProblems(schema: z.ZodType, value: unknown): OptionProblem[] {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.flatMap(issue => issue.code === 'unrecognized_keys'
    ? issue.keys.map(key => ({ path: [...issue.path, key].map(part => typeof part === 'symbol' ? String(part) : part), message: 'Unknown Java option: ' + key }))
    : [{ path: issue.path.map(part => typeof part === 'symbol' ? String(part) : part), message: issue.message }]);
}
export function requireJava(condition: unknown, message: string): asserts condition { if (!condition) throw new TypeError(message); }
export const javaPath = (path: unknown): path is string => typeof path === 'string' && literal(path) && !/[:\\]/.test(path);
export function javaSnapshot(snapshot: ProjectSnapshot): void {
  requireJava(snapshot && snapshot.root && typeof snapshot.root.path === 'string' && isAbsolute(snapshot.root.path)
    && typeof snapshot.root.identity === 'string' && !!snapshot.root.identity && Array.isArray(snapshot.files) && Array.isArray(snapshot.problems)
    && typeof snapshot.complete === 'boolean' && snapshot.complete === !snapshot.problems.length
    && Array.isArray(snapshot.excludeNames) && snapshot.excludeNames.every(value => javaPath(value) && !value.includes('/'))
    && new Set(snapshot.excludeNames).size === snapshot.excludeNames.length && Array.isArray(snapshot.excluded)
    && snapshot.excluded.every(javaPath) && new Set(snapshot.excluded).size === snapshot.excluded.length, 'Provide a well-formed captured Java project.');
  requireJava(snapshot.files.every(file => file && javaPath(file.path) && file.bytes instanceof Uint8Array
    && typeof file.version === 'string' && /^[a-f0-9]{64}$/.test(file.version)) && new Set(snapshot.files.map(file => file.path)).size === snapshot.files.length,
  'Captured Java files need unique portable paths, bytes and version labels.');
  requireJava(snapshot.problems.every(problem => problem && typeof problem.code === 'string' && typeof problem.message === 'string'
    && problem.at && typeof problem.at.kind === 'string' && Array.isArray(problem.related)) && nativeInputs(snapshot) && validateReadOnly(snapshot), 'Provide well-formed captured diagnostics and native evidence.');
}
export function javaProblem(code: string, message: string, file: string, ...path: (string | number)[]): Diagnostic {
  return { code, message, at: { kind: 'dependency', path: ['java', file, ...path] }, related: [] };
}
const roots = z.array(z.string().refine(value => value === '.' || literal(value))).min(1);
export const javaConfiguration = z.strictObject({ format: z.literal(1), release: z.literal(21), javaHome: z.string().min(1),
  sourceRoots: z.strictObject({ main: roots, test: roots }),
  classPath: z.strictObject({ main: z.array(z.string().min(1)), test: z.array(z.string().min(1)) }).optional(),
  sourcePath: z.array(z.string().min(1)).optional(),
});
export const javaBuildInputs = (configFile: string): string[] => [configFile, 'settings.gradle', 'build.gradle', 'gradlew', 'gradlew.bat',
  'gradle/wrapper/gradle-wrapper.jar', 'gradle/wrapper/gradle-wrapper.properties', '.expec/java/dependencies.gradle', 'gradle.lockfile'];
const nativePaths = z.array(z.string().min(1)), nativeClassPath = z.strictObject({ compile: nativePaths, runtime: nativePaths });
export const javaClasspathReport = z.strictObject({ format: z.literal(1), release: z.literal(21), javaHome: z.string(),
  sourceRoots: javaConfiguration.shape.sourceRoots, classPath: z.strictObject({ main: nativeClassPath, test: nativeClassPath }),
  packages: z.array(z.strictObject({ name: z.string().regex(/^maven:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/), version: z.string().min(1),
    path: z.string().min(1), hash: z.string().regex(/^[a-f0-9]{64}$/) })),
  inputs: z.array(z.strictObject({ path, version: z.string().regex(/^[a-f0-9]{64}$/) })) });
export function readJavaConfiguration(snapshot: ProjectSnapshot, file: string, problems: Diagnostic[]): z.infer<typeof javaConfiguration> | undefined {
  const source = snapshot.files.find(item => item.path === file);
  if (!source) { problems.push(javaProblem('missing-project-config', 'Capture the explicit Java configuration.', file)); return; }
  const report = (code: string, message: string, path: readonly (string | number)[]) => problems.push(javaProblem(code, message, file, ...path));
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(source.bytes); }
  catch { report('invalid-project-encoding', 'Java configuration must be UTF-8.', []); return; }
  const value = readJson(text, report), result = javaConfiguration.safeParse(value);
  if (!result.success) {
    for (const issue of result.error.issues) report(issue.path[0] === 'release' ? 'unsupported-profile' : 'invalid-java-config', issue.message,
      issue.path.map(part => typeof part === 'symbol' ? String(part) : part));
    return;
  }
  return problems.length ? undefined : result.data;
}
export function callerOptions(schema: z.ZodType, value: unknown): void {
  requireJava(jsonData(value) && schema.safeParse(value).success, 'Provide only the documented finite Java options.');
}
