import type { Configuration } from '../connection/configuration.js';
import type { Diagnostic } from '../../compiler/checking.js';
import type { PackageRead, PackageObservation } from '../dependencies/npm-dependencies.js';
import type { FileObservation } from '../connection/project-writer.js';
import { promises as fs } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { ProjectConnector } from '../connection/project-connection.js';
import { ProjectFiles, hash, message, sameObservation, type ObservedFile } from '../connection/project-files.js';
import { javaAssets, javaReport } from './java-inputs.js';
import { javaClasspathReport, javaConfiguration, javaPath, javaProblem, javaBuildInputs } from './java-settings.js';
import { emptyJavaDependencies, javaContribution, javaWrapper, javaToolchain } from './java-initialization.js';
import { fullVersion } from '../connection/configuration-schema.js';
import { readJson } from '../../model/json-data.js';
import { runNative } from '../connection/native-process.js';

export type JavaInstallation = PackageRead & { readonly effects: readonly FileObservation[] };
type Request = { name: string; requested: string; runtime: boolean };
type Report = z.infer<typeof javaClasspathReport>;
const optionalFiles = ['gradle.properties'];
const unsupportedFiles = ['settings.gradle.kts', 'build.gradle.kts', 'buildSrc'];
const pluginNames = new Set(['HelpTasksPlugin','SoftwareReportingTasksPlugin','BuildInitPlugin','WrapperPlugin','JavaPlugin',
  'JavaBasePlugin','BasePlugin','LifecycleBasePlugin','JvmEcosystemPlugin','ReportingBasePlugin','JvmToolchainsPlugin','JvmTestSuitePlugin','TestSuiteBasePlugin']);
const payload = javaClasspathReport.omit({ inputs: true, packages: true }).extend({
  packages: z.array(javaClasspathReport.shape.packages.element.omit({ hash: true })),
  sourceRoots: z.strictObject({ main: z.array(z.string()), test: z.array(z.string()) }),
  scripts: z.array(z.string()), plugins: z.array(z.string()), init: z.array(z.string()),
});

export function installJava(configuration: Configuration, manifestFile: string, options: { configFile?: string } = {}): Promise<JavaInstallation> {
  return acquire(configuration, manifestFile, options.configFile ?? 'expec.java.json', true);
}
export function readJavaPackages(configuration: Configuration, manifestFile: string, options: { configFile?: string } = {}): Promise<PackageRead> {
  return acquire(configuration, manifestFile, options.configFile ?? 'expec.java.json', false);
}
async function acquire(configuration: Configuration, manifest: string, configFile: string, install: boolean): Promise<JavaInstallation> {
  if (!isAbsolute(manifest) || !javaPath(configFile)) throw TypeError('Provide an absolute manifest filename and portable Java configuration path.');
  const buildFiles = javaBuildInputs(configFile).filter(path => path !== 'gradle.lockfile');
  const problems: Diagnostic[] = [], requests = requirements(configuration.packages, problems), packages: PackageObservation[] = requests.map(r => ({ name:r.name, requested:r.requested }));
  const effects: FileObservation[] = [], touched = new Map<string, ObservedFile>();
  const result = (): JavaInstallation => ({ packages, problems, deferred: [], effects,
    ...(!problems.length ? { value: packages.map(p => ({ name:p.name, version:p.installed! })) } : {}) });
  const problem = (code: string, text: string, path = configFile) => problems.push(javaProblem(code, text, path));
  if (problems.length) return result();
  let files: ProjectFiles | undefined, locked = false;
  try {
    const connection = await new ProjectConnector(manifest, { excludeNames:['.git','node_modules','.gradle','build'] }).connect(configuration);
    if (!connection.value || connection.value.status !== 'connected') { problems.push(...connection.problems); problem('project-unavailable','Connect an existing Java project.'); return result(); }
    files = new ProjectFiles(connection.value.context.root);
    const read = async (path: string) => (await files!.read(path)).value;
    const parse = (text: string) => readJson(text, (_code, text) => problem('invalid-native-input',text));
    const config = await read(configFile);
    const selected = config.state === 'file' ? javaConfiguration.safeParse(parse(new TextDecoder('utf-8',{fatal:true}).decode(config.bytes))) : undefined;
    if (!selected?.success || problems.length) { problem('install-required','Capture a valid Java 21 configuration.'); return result(); }
    try { await javaToolchain(selected.data.javaHome); }
    catch (error) { problem('native-toolchain-unavailable', message(error), 'javaHome'); return result(); }
    const inputs = new Map<string, ObservedFile>();
    for (const path of [...buildFiles,...optionalFiles]) {
      const value = await files.read(path); inputs.set(path,value);
      if (!optionalFiles.includes(path) && value.value.state !== 'file') problem('install-required','Required native input is unavailable.',path);
    }
    for (const path of unsupportedFiles) {
      try { await fs.lstat(files.path(path)); problem('unsupported-native-build','Use the captured single-project Groovy build profile.',path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    for (const expected of await javaWrapper()) if (expected.kind === 'write') {
      const actual = inputs.get(expected.path)!.value;
      if (actual.state !== 'file' || !Buffer.from(actual.bytes).equals(expected.bytes)) problem('unsupported-native-wrapper','Use the exact shipped Gradle 9.1 wrapper.',expected.path);
    }
    if (problems.length) return result();
    let invalidReport = false;
    const previous = await files.read(javaReport), old = previous.value.state === 'file'
      ? javaClasspathReport.safeParse(readJson(new TextDecoder().decode(previous.value.bytes), () => { invalidReport = true; })) : undefined;
    let report = !invalidReport && old?.success ? old.data : undefined;
    const desired = contribution(requests), current = inputs.get(javaContribution)!;
    if (install) {
      const value = current.value;
      if (value.state !== 'file' || new TextDecoder().decode(value.bytes) !== desired
        && new TextDecoder().decode(value.bytes) !== emptyJavaDependencies
        && report?.inputs.find(item => item.path === javaContribution)?.version !== value.version) {
        problem('native-contribution-conflict','The managed dependency contribution changed without matching prior installed evidence. Resolve it explicitly before retrying.',javaContribution); return result();
      }
      await files.acquire(); locked = true;
      for (const [path,value] of inputs) await files.verify(path,value);
      touched.set(javaContribution,current); touched.set(javaReport,previous); touched.set('gradle.lockfile',await files.read('gradle.lockfile'));
      if (previous.value.state === 'file') await files.remove(javaReport,previous);
      if (value.state !== 'file' || new TextDecoder().decode(value.bytes) !== desired) await files.write(javaContribution,new TextEncoder().encode(desired),current);
      inputs.set(javaContribution,await files.read(javaContribution));
      const changed = requests.filter(request => report?.packages.find(p => p.name === request.name)?.version !== request.requested).map(request=>request.name.slice(6));
      const lock = touched.get('gradle.lockfile')!.value;
      const flags = changed.length && lock.state === 'file' ? ['--update-locks', changed.join(',')]
        : lock.state !== 'file' || value.state !== 'file' || new TextDecoder().decode(value.bytes) !== desired ? ['--write-locks'] : [];
      const invoke = async (flags: string[]) => {
        await files!.verifyRoot(); await files!.verifyLock();
        for (const [path,value] of inputs) await files!.verify(path,value);
        const native = await runNative(join(selected.data.javaHome,'bin',process.platform === 'win32'?'java.exe':'java'),
          ['-Dorg.gradle.java.home='+selected.data.javaHome,'-classpath',files!.path('gradle/wrapper/gradle-wrapper.jar'),
            'org.gradle.wrapper.GradleWrapperMain','--no-daemon','--console=plain','--init-script',join(javaAssets,'acquire.gradle'),'expecAcquireJava',...flags],files!.root.path);
        await files!.verifyRoot(); await files!.verifyLock();
        for (const [path,value] of inputs) await files!.verify(path,value);
        if (native.code !== 0 || native.error) throw Error(native.error ?? native.stdout);
        const lines = native.stdout.split(/\r?\n/).filter(line=>line.startsWith('EXPEC_JAVA_ACQUISITION='));
        if (lines.length !== 1) throw Error('Native acquisition did not report exactly one selected graph.');
        return payload.parse(JSON.parse(lines[0]!.slice('EXPEC_JAVA_ACQUISITION='.length)));
      };
      await invoke(flags);
      inputs.set('gradle.lockfile', await files.read('gradle.lockfile'));
      const observed = await invoke(['--offline']); // Lock persistence completes when the first native build finishes.
      const allowedScripts = new Set(['settings.gradle','build.gradle',javaContribution].map(path=>files!.path(path)));
      const canonical = async (path: string) => fs.realpath(path);
      const permitted = new Set(await Promise.all([...allowedScripts].map(canonical)));
      const actualScripts = await Promise.all(observed.scripts.map(canonical));
      if (actualScripts.some(path=>!permitted.has(path)) || [...permitted].some(path=>!actualScripts.includes(path))
        || observed.plugins.some(type=>!type.startsWith('org.gradle.') || !pluginNames.has(type.split('.').at(-1)!))
        || observed.init.length !== 1 || await canonical(observed.init[0]!) !== await canonical(join(javaAssets,'acquire.gradle')))
        throw Error('Unsupported applied script, plugin or initialization input. Native configuration effects may already have occurred.');
      if (await canonical(observed.javaHome) !== await canonical(selected.data.javaHome)) throw Error('Native build used a different JDK.');
      for (const phase of ['main','test'] as const) {
        const expected = await Promise.all(selected.data.sourceRoots[phase].map(path=>canonical(files!.path(path))));
        if (JSON.stringify(expected) !== JSON.stringify(await Promise.all(observed.sourceRoots[phase].map(canonical)))) throw Error('Native source roots do not match the captured configuration.');
      }
      const artifacts: Report['packages'] = [];
      for (const item of observed.packages) {
        if (!fullVersion(item.version)) throw Error('Unsupported selected Maven version: '+item.version);
        artifacts.push({...item,hash:await artifactHash(item.path)});
      }
      for (const phase of ['main','test'] as const) for (const kind of ['compile','runtime'] as const)
        if (observed.classPath[phase][kind].some(path=>!artifacts.some(item=>item.path===path))) throw Error('Native classpath contains an unselected or non-Maven artifact.');
      const captured: Report['inputs'] = [];
      for (const path of [...buildFiles,...optionalFiles,'gradle.lockfile']) {
        const file = await files.read(path);
        if (file.value.state === 'file') captured.push({path,version:file.value.version});
        else if (!optionalFiles.includes(path)) throw Error('Native build did not retain required input '+path);
      }
      report = javaClasspathReport.parse({format:1,release:21,javaHome:selected.data.javaHome,sourceRoots:selected.data.sourceRoots,
        classPath:observed.classPath,packages:artifacts,inputs:captured});
      await files.write(javaReport,new TextEncoder().encode(JSON.stringify(report,null,2)+'\n'),await files.read(javaReport));
    }
    if (!install && (current.value.state !== 'file' || new TextDecoder().decode(current.value.bytes) !== desired)) {
      problem('install-required', 'Requested versions or phases differ from the installed contribution.', javaContribution);
    }
    if (!report) { problem('install-required','Install native dependencies before reading selected packages.',javaReport); return result(); }
    for (const path of [...buildFiles,...optionalFiles,'gradle.lockfile']) {
      const current = await files.read(path), recorded = report.inputs.find(item=>item.path===path);
      if (current.value.state === 'file' ? recorded?.version !== current.value.version : recorded !== undefined || !optionalFiles.includes(path))
        problem('install-required','Native configuration changed or lacks installed evidence.',path);
    }
    for (const item of report.packages) if (await artifactHash(item.path) !== item.hash) problem('install-required','Selected native artifact changed.',item.path);
    for (const [index,request] of requests.entries()) {
      const found = report.packages.filter(item=>item.name===request.name), versions = new Set(found.map(item=>item.version));
      packages[index] = {...packages[index]!,...(versions.size===1?{selected:found[0]!.version}:{}),
        ...(versions.size===1 && found[0]!.version===request.requested && !problems.length?{installed:found[0]!.version}:{})};
      if (versions.size!==1 || found[0]!.version!==request.requested) problem('install-required','No compatible installed selection for '+request.name,javaReport);
    }
    if (!install) {
      await files.verify(javaReport, previous);
      for (const [path, value] of inputs) await files.verify(path, value);
    }
    await files.verifyRoot();
  } catch (error) {
    if (error && typeof error === 'object' && 'diagnostic' in error) problems.push(error.diagnostic as Diagnostic);
    else problem(install?'package-install-failed':'install-required',message(error));
  } finally {
    if (files) {
      for (const [path,before] of touched) { const after = await files.observe(path); if (!sameObservation(before.value,after)) effects.push(after); }
      if (locked) await files.cleanup(problems);
    }
  }
  return result();
}
function contribution(requests: readonly Request[]): string {
  return '// .expec Java dependencies, format 1\next.expecJavaDependencies = '+JSON.stringify(requests.map(r=>[r.runtime?'implementation':'testImplementation',r.name.slice(6)+':'+r.requested]))+'\n'
    + 'dependencies { expecJavaDependencies.each { item -> add(item[0], item[1]) } }\n';
}
function requirements(input: Configuration['packages'], problems: Diagnostic[]): Request[] {
  const requests = new Map<string,Request>();
  for (const [index,item] of input.entries()) {
    const report = (code: string,text: string,field: string) => problems.push({code,message:text,at:{kind:'dependency',path:['packages',index,field]},related:[]});
    if (!/^maven:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(item.name)) report('unsupported-package-ecosystem','Provide a qualified ordinary Maven group and artifact.','name');
    else if (!fullVersion(item.version)) report('unsupported-package-version','Java acquisition requires an exact canonical semantic version.','version');
    else if (item.phases.every(phase => phase === 'build')) report('unsupported-package-phase','Arbitrary Java build tooling is outside this profile.','phases');
    else {
      const previous = requests.get(item.name);
      if (previous && previous.requested!==item.version) report('conflicting-package-requirements','Aliases must request the same exact native version.','version');
      else if (previous) previous.runtime ||= item.phases.includes('runtime');
      else requests.set(item.name,{name:item.name,requested:item.version,runtime:item.phases.includes('runtime')});
    }
  }
  return [...requests.values()];
}
async function artifactHash(path: string): Promise<string> {
  if (!isAbsolute(path)) throw Error('Native artifact paths must be absolute.');
  const before = await fs.lstat(path,{bigint:true});
  if (!before.isFile() || before.isSymbolicLink() || before.nlink!==1n || !path.endsWith('.jar')) throw Error('Selected native artifact is not an ordinary JAR: '+path);
  const bytes = await fs.readFile(path), after = await fs.lstat(path,{bigint:true});
  if (before.dev!==after.dev || before.ino!==after.ino || before.size!==after.size || before.mtimeNs!==after.mtimeNs || before.ctimeNs!==after.ctimeNs) throw Error('Native artifact changed during capture: '+path);
  return hash(bytes);
}

