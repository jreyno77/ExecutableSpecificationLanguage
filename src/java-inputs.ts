import { promises as fs, type BigIntStats } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { Diagnostic } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import { canonical } from './identity-baseline.js';
import { hash, literal } from './project-files.js';
import { readJson } from './json-data.js';
import { javaBuildInputs, javaClasspathReport, javaProblem, readJavaConfiguration } from './java-settings.js';

export const javaAssets = fileURLToPath(new URL('./java/', import.meta.url));
export const javaReport = '.expec/java/classpath.json';

/** Selected native bytes and membership, separate from editable project source. */
export async function javaInputs(snapshot: ProjectSnapshot, file: string, checkRoots = false) {
  const problems: Diagnostic[] = [...snapshot.problems], config = readJavaConfiguration(snapshot, file, problems);
  const nativeInputs = new Map<string, string>(), active = new Set<string>();
  const selected = new Map<string, { actual: string; stamp: string; children: string[] | undefined }>();
  const stamp = (info: BigIntStats) => [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs, info.birthtimeNs].join(':');
  const problem = (code: string, message: string, path: string) => problems.push(javaProblem(code, message, file, path));
  const capture = async (path: string): Promise<void> => {
    const actual = await fs.realpath(path), before = await fs.stat(actual, { bigint: true });
    if (active.has(actual)) throw new Error('Native directory link cycle: ' + path);
    const prior = selected.get(path);
    if (prior && (prior.actual !== actual || prior.stamp !== stamp(before))) throw new Error('Native input changed: ' + path);
    let children: string[] | undefined;
    if (before.isDirectory()) {
      active.add(actual);
      try {
        children = (await fs.readdir(actual)).sort();
        for (const child of children) await capture(join(actual, child));
        if (canonical(children) !== canonical((await fs.readdir(actual)).sort())) throw new Error('Native directory membership changed: ' + path);
      } finally { active.delete(actual); }
    } else if (before.isFile()) nativeInputs.set(pathToFileURL(actual).href, hash(await fs.readFile(actual)));
    else throw new Error('Native input is not an ordinary file or directory: ' + path);
    if (stamp(before) !== stamp(await fs.stat(actual, { bigint: true })) || actual !== await fs.realpath(path))
      throw new Error('Native input changed while reading: ' + path);
    selected.set(path, { actual, stamp: stamp(before), children });
  };
  let report: z.infer<typeof javaClasspathReport> | undefined;
  if (config) {
    try {
      if (!isAbsolute(config.javaHome)) throw new Error('Provide a fully qualified javaHome.');
      const release = await fs.readFile(join(config.javaHome, 'release'), 'utf8');
      if (!/^JAVA_VERSION="21(?:\.|"|-)/m.test(release)) throw new Error('Configure a JDK 21 distribution.');
      for (const name of ['bin/java', 'bin/javac', 'lib/modules']) {
        const path = join(config.javaHome, name + (process.platform === 'win32' && name.startsWith('bin/') ? '.exe' : ''));
        if (!(await fs.stat(path)).isFile()) throw new Error('Required native toolchain file is unavailable: ' + path);
      }
      for (const name of ['release', 'bin', 'lib', 'conf']) await capture(join(config.javaHome, name));
    } catch (error) { problem('native-toolchain-unavailable', String(error), 'javaHome'); }
    const source = snapshot.files.find(item => item.path === javaReport);
    if (!source) problem('install-required', 'Run explicit Java dependency installation to capture the native classpaths.', javaReport);
    else {
      try {
        const value = readJson(new TextDecoder('utf-8', { fatal: true }).decode(source.bytes), (code, text, at) =>
          problems.push(javaProblem(code, text, javaReport, ...at)));
        const parsed = javaClasspathReport.safeParse(value);
        if (!parsed.success) problem('install-required', 'Native classpath report is malformed.', javaReport);
        else {
          report = parsed.data;
          for (const path of [...javaBuildInputs(file), ...snapshot.files.some(input => input.path === 'gradle.properties') ? ['gradle.properties'] : []])
            if (!report.inputs.some(input => input.path === path) || !snapshot.files.some(input => input.path === path))
              problem('install-required', 'Native acquisition input is missing or was not captured: ' + path, path);
          const unsupported = snapshot.files.find(input => ['settings.gradle.kts', 'build.gradle.kts'].includes(input.path) || input.path.startsWith('buildSrc/'));
          if (unsupported) problem('unsupported-native-build', 'The finite native Java build profile does not include ' + unsupported.path, unsupported.path);
          if (report.javaHome !== config.javaHome || canonical(report.sourceRoots) !== canonical(config.sourceRoots)
            || !report.inputs.some(input => input.path === file)
            || report.inputs.some(input => !snapshot.files.some(current => current.path === input.path && hash(current.bytes) === input.version)))
            problem('install-required', 'Native acquisition inputs changed; run explicit install.', javaReport);
        }
      } catch (error) { problem('install-required', String(error), javaReport); }
    }
    const roots = [...config.sourceRoots.main, ...config.sourceRoots.test];
    for (const path of [file, javaReport, ...roots]) if (path.split('/').some(part => snapshot.excludeNames.includes(part)))
      problem('excluded-source', 'A required Java path is excluded by the supplied connection.', path);
    for (const entry of snapshot.excluded) if (roots.some(root => root === '.' || entry === root || entry.startsWith(root + '/')))
      problem('excluded-source', 'Selected Java source contains an excluded directory.', entry);
    for (const [index, root] of roots.entries()) {
      if (roots.some((other, before) => before < index && (root === other || root === '.' || other === '.' || root.startsWith(other + '/') || other.startsWith(root + '/'))))
        problem('invalid-java-config', 'Source roots must be distinct and nonoverlapping.', root);
      if (checkRoots) try {
        const parts = root === '.' ? [] : root.split('/');
        for (let count = 0; count <= parts.length; count++) {
          const path = join(snapshot.root.path, ...parts.slice(0, count)), info = await fs.lstat(path);
          if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Source root must have ordinary directory ancestry.');
        }
      } catch (error) { problem('source-root-unavailable', String(error), root); }
    }
    if (report) for (const path of [...report.classPath.main.compile, ...report.classPath.main.runtime,
      ...report.classPath.test.compile, ...report.classPath.test.runtime, ...config.classPath?.main ?? [], ...config.classPath?.test ?? [], ...config.sourcePath ?? []]) {
      try { await capture(resolve(snapshot.root.path, dirname(file), path)); }
      catch (error) { problem('native-input-unavailable', String(error), path); }
    }
    try {
      const manifest = JSON.parse(await fs.readFile(join(javaAssets, 'artifacts.json'), 'utf8')) as { format: number; artifacts: { file: string; version: string }[] };
      if (manifest.format !== 1 || !Array.isArray(manifest.artifacts) || !manifest.artifacts.length) throw new Error('Invalid Java runtime manifest.');
      await capture(join(javaAssets, 'artifacts.json'));
      for (const artifact of manifest.artifacts) {
        if (!/^[\w.-]+\.jar$/.test(artifact.file) || !/^[a-f0-9]{64}$/.test(artifact.version)) throw new Error('Invalid Java runtime resource.');
        const path = join(javaAssets, artifact.file); await capture(path);
        if (nativeInputs.get(pathToFileURL(await fs.realpath(path)).href) !== artifact.version) throw new Error('Java runtime resource changed: ' + artifact.file);
      }
    } catch (error) { problem('native-runtime-unavailable', String(error), 'java-runtime'); }
  }
  for (const [path, before] of selected) try {
    if (await fs.realpath(path) !== before.actual || stamp(await fs.stat(path, { bigint: true })) !== before.stamp
      || before.children && canonical((await fs.readdir(path)).sort()) !== canonical(before.children)) throw new Error('Native target changed: ' + path);
  } catch (error) { problem('native-input-changed', String(error), path); }
  const evidence = [...nativeInputs].map(([uri, version]) => ({ uri, version })).sort((a, b) => a.uri < b.uri ? -1 : 1);
  return { config, report, problems, nativeInputs: evidence };
}
