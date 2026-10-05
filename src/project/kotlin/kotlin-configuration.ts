import { z } from 'zod';
import { isAbsolute } from 'node:path';
import type { Check, Diagnostic } from '../../compiler/checking.js';
import type { ProjectSnapshot } from '../connection/project-connection.js';
import { nativePath } from '../connection/project-connection.js';
import { literal, problem } from '../connection/project-files.js';
import { readJson } from '../../model/json-data.js';
import { canonical, success } from '../../model/identity-baseline.js';

const path = z.string().refine(value => literal(value) && !value.includes('\\'));
const absolute = z.string().refine(value => nativePath(value) && isAbsolute(value));
const sourceRoots = z.strictObject({ main: z.array(path).min(1), test: z.array(path).min(1) }).refine(roots => {
  const all = [...roots.main, ...roots.test];
  return all.every((value, index) => all.every((other, at) => at === index || value !== other && !value.startsWith(other + '/') && !other.startsWith(value + '/')));
}, 'Source roots must be distinct and nonoverlapping.');
export const kotlinSettings = z.strictObject({ javaHome: absolute, sourceRoots });
export const kotlinReportPath = '.expec/kotlin/classpath.json';
export const kotlinReport = z.strictObject({
  format: z.literal(1), kotlin: z.literal('2.4.10'), gradle: z.literal('9.1.0'), jvmTarget: z.literal('21'),
  javaHome: absolute, sourceRoots,
  javaRoots: z.strictObject({ main: z.array(path), test: z.array(path) }).optional(),
  classPath: z.strictObject({ main: z.array(absolute), test: z.array(absolute) }),
  runtimeClassPath: z.strictObject({ main: z.array(absolute), test: z.array(absolute) }).optional(),
  artifacts: z.array(z.strictObject({ path: absolute, version: z.string().regex(/^[a-f0-9]{64}$/) })).optional(),
  inputs: z.array(z.strictObject({ path, version: z.string().regex(/^[a-f0-9]{64}$/) })),
  packages: z.array(z.strictObject({ name: z.string(), version: z.string(), phases: z.array(z.enum(['build', 'runtime', 'test'])) })),
});
export type KotlinConfiguration = z.infer<typeof kotlinReport>;
export interface KotlinContextOptions { readonly configFile?: string }
export function kotlinConfigurationOptions(options: KotlinContextOptions): string {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'configFile')
    || options.configFile !== undefined && !path.safeParse(options.configFile).success) throw new TypeError('Provide an optional safe project-relative configFile.');
  return options.configFile ?? 'expec.kotlin.json';
}
export const kotlinBuildInput = (path: string, config: string) => path === config || /(?:^|\/)(?:[^/]+\.gradle(?:\.kts)?|gradle\.properties|gradle\.lockfile)$/.test(path)
  || path.startsWith('gradle/wrapper/');

/** Interprets captured metadata only. Acquisition and native filesystem reads are separate. */
export function kotlinConfiguration(snapshot: ProjectSnapshot, configFile: string): Check<KotlinConfiguration> {
  const problems: Diagnostic[] = [];
  const report = (code: string, file: string, message: string) => problems.push(problem(snapshot.root, code, file, message));
  const checkExcluded = (root: string) => {
    const segment = root.split('/').find(part => snapshot.excludeNames.includes(part));
    const omitted = snapshot.excluded.find(path => path === root || path.startsWith(root + '/') || root.startsWith(path + '/'));
    if (segment || omitted) report('excluded-kotlin-input', omitted ?? root,
      'Selected Kotlin input ' + root + ' intersects excluded path ' + (omitted ?? root) + '. Choose an unexcluded input location or a capture policy that includes it.');
  };
  for (const path of [configFile, kotlinReportPath]) checkExcluded(path);
  if (problems.length) return { problems, deferred: [] };
  const json = (path: string): unknown => {
    const file = snapshot.files.find(file => file.path === path);
    if (!file) { report('native-inputs-unavailable', path, 'Missing captured Kotlin prerequisite: ' + path + '. Run explicit install.'); return; }
    try { return readJson(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes), (_code, text) => report('invalid-kotlin-configuration', path, text)); }
    catch { report('invalid-kotlin-configuration', path, 'Kotlin metadata must be valid UTF-8 JSON.'); return; }
  };
  const config = kotlinSettings.safeParse(json(configFile)), installed = kotlinReport.safeParse(json(kotlinReportPath));
  if (!config.success) report('invalid-kotlin-configuration', configFile, config.error.message);
  if (!installed.success) report('invalid-kotlin-configuration', kotlinReportPath, installed.error.message);
  if (!config.success || !installed.success) return { problems, deferred: [] };
  const data = installed.data;
  const artifacts = [...new Set([...data.classPath.main, ...data.classPath.test, ...data.runtimeClassPath?.main ?? [], ...data.runtimeClassPath?.test ?? []])].sort();
  if (data.artifacts && (!data.runtimeClassPath || canonical(data.artifacts.map(item => item.path).sort()) !== canonical(artifacts)))
    report('invalid-native-report', kotlinReportPath, 'Installed artifact evidence must identify every compile and runtime classpath file exactly once.');
  if (canonical(config.data) !== canonical({ javaHome: data.javaHome, sourceRoots: data.sourceRoots })) report('native-configuration-stale', kotlinReportPath, 'Native classpath report does not match the selected configuration; run explicit install.');
  const inputs = snapshot.files.filter(file => kotlinBuildInput(file.path, configFile)).map(file => ({ path: file.path, version: file.version })).sort((a, b) => a.path.localeCompare(b.path));
  if (!data.inputs.some(input => input.path === configFile) || !data.inputs.some(input => /(?:^|\/)build\.gradle(?:\.kts)?$/.test(input.path))
    || new Set(data.inputs.map(input => input.path)).size !== data.inputs.length
    || canonical(inputs) !== canonical([...data.inputs].sort((a, b) => a.path.localeCompare(b.path)))) report('native-configuration-stale', kotlinReportPath, 'Native build inputs changed; run explicit install to refresh the classpath.');
  for (const root of [...data.sourceRoots.main, ...data.sourceRoots.test, ...data.javaRoots?.main ?? [], ...data.javaRoots?.test ?? []]) checkExcluded(root);
  for (const file of snapshot.files) if (file.path.endsWith('.java') && [...data.sourceRoots.main, ...data.sourceRoots.test,
    ...data.javaRoots?.main ?? [], ...data.javaRoots?.test ?? []].some(root => file.path.startsWith(root + '/')))
    report('unsupported-native-input', file.path, 'Java source consumers are outside this Kotlin-only native profile.');
  return problems.length ? { problems, deferred: [] } : success(data);
}
