import { promises as fs, type BigIntStats } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { z } from 'zod';
import type { Check, Diagnostic } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import { captureKotlinInputs, kotlinResources } from './kotlin-context.js';
import { kotlinConfiguration } from './kotlin-configuration.js';
import { nativeInputs, sameNativeInputs } from './native-inputs.js';
import { literal, message, problem, sameIdentity } from './project-files.js';

const range = z.strictObject({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).refine(value => value.start <= value.end);
export const kotlinSelector = z.array(z.strictObject({ kind: z.enum(['class', 'interface', 'object', 'function', 'property', 'parameter', 'type-parameter', 'typealias']),
  name: z.string().min(1), parameters: z.array(z.string()).optional(), receiver: z.string().optional() })).min(1);
const result = z.strictObject({
  files: z.array(z.string().refine(literal)),
  declarations: z.array(z.strictObject({ file: z.string().refine(literal), selector: kotlinSelector, kind: z.string(), name: z.string(), range, nameRange: range, bodyRange: range.optional(), typeRange: range.optional() })),
  references: z.array(z.strictObject({ file: z.string().refine(literal), range, owner: kotlinSelector.nullable(), targetFile: z.string().refine(literal).optional(), target: kotlinSelector.optional(), external: z.string().optional(), role: z.string() })),
  problems: z.array(z.strictObject({ file: z.string().refine(literal), range, message: z.string(), code: z.string() })),
});
export type KotlinQuery = z.infer<typeof result>;

/** Stages only supplied source bytes; native analysis reads the separately guarded artifacts. */
export async function queryKotlin(snapshot: ProjectSnapshot, configFile: string): Promise<Check<KotlinQuery>> {
  const problems: Diagnostic[] = [...snapshot.problems], configured = kotlinConfiguration(snapshot, configFile);
  problems.push(...configured.problems);
  const finding = (code: string, text: string, path = '') => problems.push(problem(snapshot.root, code, path, text));
  if (!snapshot.complete) finding('incomplete-project', 'Kotlin queries require a complete supplied project capture.');
  if (!nativeInputs(snapshot) || !snapshot.nativeInputs?.length) finding('native-inputs-unavailable', 'Supply KotlinContext native input evidence before querying.');
  if (!configured.value || problems.length) return { problems, deferred: [] };
  const config = configured.value;
  const verify = async () => {
    const actual = await captureKotlinInputs(snapshot, config);
    if (actual.problems.length || !sameNativeInputs(snapshot, { ...snapshot, nativeInputs: actual.inputs })) { finding('native-input-changed', 'Captured Kotlin native inputs no longer identify the current bytes.'); return false; }
    return true;
  };
  if (!await verify()) return { problems, deferred: [] };
  let scratch: string | undefined, scratchIdentity: BigIntStats | undefined;
  let value: KotlinQuery | undefined;
  try {
    const temporary = await fs.realpath(tmpdir()), inside = relative(snapshot.root.path, temporary);
    if (!inside || !isAbsolute(inside) && inside !== '..' && !inside.startsWith('..' + sep)) throw new Error('Native analysis scratch must be outside the connected project.');
    scratch = await fs.mkdtemp(join(temporary, 'expec-kotlin-query-')); scratchIdentity = await fs.lstat(scratch, { bigint: true });
    const source = join(scratch, 'sources'); await fs.mkdir(source);
    const roots = [...config.sourceRoots.main, ...config.sourceRoots.test];
    for (const file of snapshot.files.filter(file => roots.some(root => file.path.startsWith(root + '/')))) {
      if (file.path.endsWith('.java')) { finding('unsupported-native-input', 'Java source consumers are outside the Kotlin-only query profile.', file.path); continue; }
      if (!file.path.endsWith('.kt')) continue;
      try { new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); }
      catch { finding('invalid-project-encoding', 'Kotlin source must be valid UTF-8.', file.path); continue; }
      const path = join(source, file.path); await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(path, file.bytes);
    }
    if (!problems.length) {
      const input = join(scratch, 'request.json'); await fs.writeFile(input, JSON.stringify({ directory: source, classpath: [...new Set([...config.classPath.main, ...config.classPath.test])] }));
      const libraries = join(kotlinResources, 'lib'), jars = (await fs.readdir(libraries)).filter(name => name.endsWith('.jar')).sort().map(name => join(libraries, name));
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS', 'JAVA_OPTS', 'CLASSPATH'].includes(key.toUpperCase())));
      const observed = await promisify(execFile)(join(config.javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
        ['-cp', jars.join(delimiter), 'expec.kotlin.MainKt', input], { cwd: scratch, env, timeout: 30_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
      value = result.parse(JSON.parse(observed.stdout));
      if (new Set(value.files).size !== value.files.length || value.files.some(path => !snapshot.files.some(file => file.path === path && path.endsWith('.kt') && roots.some(root => path.startsWith(root + '/'))))) throw new Error('Native query claimed an uncaptured source file.');
      for (const observed of value.problems) finding('kotlin-' + observed.code, observed.message, observed.file);
      for (const observation of [...value.declarations, ...value.references, ...value.problems]) {
        const file = snapshot.files.find(file => file.path === observation.file);
        if (!file || observation.range.end > new TextDecoder('utf-8', { fatal: true }).decode(file.bytes).length) throw new Error('Native query returned an invalid source range.');
      }
    }
    if (!await verify()) value = undefined;
  } catch (error) { finding('native-query-failed', message(error)); value = undefined; }
  finally {
    if (scratch && scratchIdentity) try {
      const current = await fs.lstat(scratch, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, scratchIdentity)) throw new Error('Native scratch identity changed.');
      await fs.rm(scratch, { recursive: true });
    } catch (error) { finding('native-cleanup-failed', message(error)); value = undefined; }
  }
  return { ...(value ? { value } : {}), problems, deferred: [] };
}
