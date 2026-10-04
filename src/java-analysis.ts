import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, delimiter, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ProjectSnapshot } from './project-connection.js';
import { canonical, jsonData, type JsonValue } from './identity-baseline.js';
import { literal } from './project-files.js';
import { javaAssets, javaInputs } from './java-inputs.js';
import { javaPath, javaProblem, javaSnapshot } from './java-settings.js';

export const javaMember = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('method'), name: z.string().min(1), parameters: z.array(z.string()), static: z.boolean() }),
  z.strictObject({ kind: z.literal('constructor'), parameters: z.array(z.string()) }),
  z.strictObject({ kind: z.literal('field'), name: z.string().min(1) }),
]);
export const javaSymbol = z.strictObject({ file: z.string().refine(javaPath), type: z.string().min(1), member: javaMember.optional(), parameter: z.number().int().nonnegative().optional() })
  .refine(value => value.parameter === undefined || value.member?.kind === 'method' || value.member?.kind === 'constructor', 'Parameter selection needs a callable owner.');
const span = { file: z.string().min(1), start: z.number().int().nonnegative(), length: z.number().int().nonnegative() };
const range = z.strictObject({ start: z.number().int().nonnegative(), length: z.number().int().nonnegative() });
const syntax = z.strictObject({ body: range.optional(), result: range.optional(), close: z.number().int().nonnegative(),
  parameters: z.array(z.strictObject({ ...range.shape, type: range, name: range })), docs: z.array(range), comments: z.array(range) });
const symbol = { key: z.string().min(1), type: z.string().min(1), member: javaMember.optional(), parameter: z.number().int().nonnegative().optional(), ...span };
const result = z.strictObject({ format: z.literal(1), comments: z.array(z.strictObject({ ...span, documentation: z.boolean() })), declarations: z.array(z.strictObject({ ...symbol, nodeStart: z.number().int().nonnegative(), nodeLength: z.number().int().nonnegative(), contract: z.custom<JsonValue>(jsonData), syntax: syntax.optional() })),
  uses: z.array(z.strictObject({ ...symbol, role: z.enum(['type', 'value']), owners: z.array(z.string()), external: z.string().optional() })),
  unresolved: z.array(z.strictObject({ ...span, role: z.enum(['type', 'value']), owners: z.array(z.string()), reason: z.string().min(1) })),
  problems: z.array(z.strictObject({ ...span, code: z.string(), message: z.string() })) });
export type JavaFacts = z.infer<typeof result>;
function changedInput(before: ProjectSnapshot['nativeInputs'], after: ProjectSnapshot['nativeInputs']): string {
  const left = new Map(before?.map(input => [input.uri, input.version])), right = new Map(after?.map(input => [input.uri, input.version]));
  return [...new Set([...left.keys(), ...right.keys()])].find(uri => left.get(uri) !== right.get(uri)) ?? '<native-inputs>';
}

/** One bounded JDT process resolves the supplied bytes against captured native inputs. */
export async function analyzeJava(snapshot: ProjectSnapshot, configFile: string) {
  javaSnapshot(snapshot);
  const input = await javaInputs(snapshot, configFile), problems = input.problems;
  const roots = input.config ? [...input.config.sourceRoots.main, ...input.config.sourceRoots.test] : [];
  const included = (path: string, directories: readonly string[]) => directories.some(root => root === '.' || path.startsWith(root + '/'));
  const sources = snapshot.files.filter(file => file.path.endsWith('.java') && included(file.path, roots));
  const scope = sources.map(file => file.path);
  let facts: JavaFacts = { format: 1, declarations: [], uses: [], problems: [], unresolved: [], comments: [] };
  if (input.nativeInputs.some(required => !snapshot.nativeInputs?.some(captured => captured.uri === required.uri && captured.version === required.version))) problems.push(javaProblem('native-input-changed', 'Java native evidence is missing or changed; capture it again.', configFile,
    changedInput(snapshot.nativeInputs, input.nativeInputs)));
  if (problems.length || !input.config || !input.report) return { facts, problems, scope };
  const directory = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-java-analysis-'));
  try {
    const { config, report } = input;
    const external = new Map<string, { path: string; uri: string; text: string }>(), externalRoots: string[] = [];
    for (const [index, value] of (config.sourcePath ?? []).entries()) {
      const root = await fs.realpath(resolve(snapshot.root.path, dirname(configFile), value)), staged = join(directory, 'external', String(index));
      externalRoots.push(staged);
      for (const item of input.nativeInputs) {
        const path = fileURLToPath(item.uri), local = relative(root, path);
        if (!local || local.startsWith('..') || isAbsolute(local) || !path.endsWith('.java') || external.has(item.uri)) continue;
        external.set(item.uri, { path: join(staged, local), uri: item.uri,
          text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await fs.readFile(path)) });
      }
    }
    for (const root of [...roots.map(root => join(directory, 'source', root)), ...externalRoots]) await fs.mkdir(root, { recursive: true });
    for (const source of external.values()) {
      await fs.mkdir(dirname(source.path), { recursive: true });
      await fs.writeFile(source.path, source.text.startsWith('\uFEFF') ? ' ' + source.text.slice(1) : source.text);
    }
    for (const source of sources) {
      const target = join(directory, 'source', source.path); await fs.mkdir(dirname(target), { recursive: true });
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source.bytes);
      await fs.writeFile(target, text.startsWith('\uFEFF') ? ' ' + text.slice(1) : text);
    }
    const list = async (name: string, values: readonly string[]) => fs.writeFile(join(directory, name), values.map(value => Buffer.from(value).toString('base64')).join('\n'));
    await list('external-sources', [...external.values()].flatMap(item => [item.path, item.uri]));
    for (const phase of ['main', 'test'] as const) {
      const roots = phase === 'main' ? config.sourceRoots.main : [...config.sourceRoots.main, ...config.sourceRoots.test];
      await list(phase + '-files', [...phase === 'main' ? [...external.values()].map(item => item.path) : [],
        ...sources.filter(file => included(file.path, config.sourceRoots[phase])).map(file => join(directory, 'source', file.path))]);
      await list(phase + '-roots', [...roots.map(root => join(directory, 'source', root)), ...externalRoots]);
      await list(phase + '-classpath', [...report.classPath[phase].compile, ...config.classPath?.main ?? [], ...phase === 'test' ? config.classPath?.test ?? [] : []]
        .map(path => resolve(snapshot.root.path, dirname(configFile), path)));
    }
    const manifest = JSON.parse(await fs.readFile(join(javaAssets, 'artifacts.json'), 'utf8')) as { artifacts: { file: string }[] };
    const stdout = await javaProcess(join(config.javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), [
      '-XX:-UsePerfData', '-Djava.io.tmpdir=' + directory, '-Duser.home=' + directory,
      '-cp', manifest.artifacts.map(artifact => join(javaAssets, artifact.file)).join(delimiter), 'ExpecJava', directory,
    ], directory);
    facts = result.parse(JSON.parse(stdout));
    const texts = new Map([...sources.map(item => [item.path, new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(item.bytes)] as const),
      ...[...external.values()].map(item => [item.uri, item.text] as const)]);
    for (const found of [...facts.declarations, ...facts.uses, ...facts.unresolved, ...facts.problems, ...facts.comments]) {
      const text = texts.get(found.file);
      if (text === undefined || found.start + found.length > text.length) throw new Error('Native Java result has an unauthorized source or invalid span.');
      if ('nodeStart' in found && found.nodeStart + found.nodeLength > text.length) throw new Error('Native Java declaration has an invalid source span.');
      if ('external' in found && found.external && !input.nativeInputs.some(item => item.uri === found.external)) throw new Error('Native Java provider is not an authorized input.');
    }
    for (const found of facts.unresolved.filter(item => external.has(item.file))) problems.push(javaProblem('unresolved-native-reference', found.reason, found.file, found.start, found.length));
    for (const found of facts.problems) problems.push(javaProblem(found.code, found.message, found.file, found.start, found.length));
  } catch (error) {
    facts = { format: 1, declarations: [], uses: [], problems: [], unresolved: [], comments: [] };
    problems.push(javaProblem('native-analysis-failed', error instanceof Error ? error.message : String(error), configFile));
  }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
  const current = await javaInputs(snapshot, configFile);
  if (current.problems.length || canonical(current.nativeInputs) !== canonical(input.nativeInputs)) {
    problems.push(javaProblem('native-input-changed', 'Java native inputs changed during analysis.', configFile, changedInput(input.nativeInputs, current.nativeInputs)));
    facts = { format: 1, declarations: [], uses: [], problems: [], unresolved: [], comments: [] };
  }
  return { facts, problems, scope };
}
function javaProcess(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS', 'CLASSPATH'].includes(key.toUpperCase())));
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failed = '';
    const timer = setTimeout(() => { failed = 'Java analysis exceeded 30 seconds.'; child.kill(); }, 30_000);
    const read = (text: Buffer, output: boolean) => {
      if (output) stdout += text.toString(); else stderr += text.toString();
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 8 * 1024 * 1024) { failed = 'Java analysis output exceeded 8 MiB.'; child.kill(); }
    };
    child.stdout.on('data', data => read(data, true)); child.stderr.on('data', data => read(data, false));
    child.on('error', error => { failed = error.message; });
    child.on('close', code => { clearTimeout(timer); failed || code !== 0 ? reject(new Error(failed || stderr || 'Java exit ' + code)) : resolve(stdout); });
  });
}
