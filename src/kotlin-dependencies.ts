import type { Configuration } from './configuration.js';
import type { Diagnostic } from './checking.js';
import type { PackageObservation, PackageRead } from './npm-dependencies.js';
import { kotlinBuildInput, kotlinConfiguration, kotlinConfigurationOptions, kotlinReport, kotlinReportPath, kotlinSettings, type KotlinContextOptions } from './kotlin-configuration.js';
import { connectDirectory, nativePath, type ProjectContext } from './project-connection.js';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { valid, validRange } from 'semver';
import { z } from 'zod';
import { configurationSchema } from './configuration-schema.js';
import { canonical } from './identity-baseline.js';
import { captureKotlinInputs, kotlinResources } from './kotlin-context.js';
import { readJson } from './json-data.js';
import { kotlinStarterContribution } from './kotlin-initialization.js';
import { fail, hash, literal, message, problem, ProjectFiles, type ObservedFile } from './project-files.js';

const contribution = '.expec/kotlin/dependencies.gradle.kts';
const phases = ['build', 'runtime', 'test'] as const;
interface Request { name: string; version: string; requested: string; phases: ('build' | 'runtime' | 'test')[] }
const operation = z.strictObject({ targetType: z.string(), target: z.string().nullable(), build: z.string() });
const nativeReport = z.strictObject({
  format: z.literal(1), kotlin: z.literal('2.4.10'), gradle: z.literal('9.1.0'), jvmTarget: z.literal('21'), javaHome: z.string(),
  sourceRoots: z.strictObject({ main: z.array(z.string()), test: z.array(z.string()) }),
  javaRoots: z.strictObject({ main: z.array(z.string()), test: z.array(z.string()) }),
  classPath: z.strictObject({ main: z.array(z.string()), test: z.array(z.string()) }),
  runtimeClassPath: z.strictObject({ main: z.array(z.string()), test: z.array(z.string()) }),
  artifacts: z.array(z.strictObject({ name: z.string(), version: z.string(), file: z.string(), phase: z.enum(['runtime', 'test']) })),
  scripts: z.array(operation.extend({ file: z.string().nullable(), uri: z.string().nullable() })),
  plugins: z.array(operation.extend({ id: z.string().nullable(), type: z.string() })), init: z.array(z.string()),
});
const plugins: Record<string, string | null> = {
  'org.gradle.api.plugins.HelpTasksPlugin': 'org.gradle.help-tasks',
  'org.gradle.api.plugins.SoftwareReportingTasksPlugin': 'org.gradle.software-reporting-tasks',
  'org.gradle.buildinit.plugins.BuildInitPlugin': 'org.gradle.build-init', 'org.gradle.buildinit.plugins.WrapperPlugin': 'org.gradle.wrapper',
  'org.jetbrains.kotlin.gradle.plugin.KotlinPluginWrapper': 'org.jetbrains.kotlin.jvm',
  'org.gradle.api.plugins.JavaPlugin': null, 'org.gradle.api.plugins.JavaBasePlugin': null, 'org.gradle.api.plugins.BasePlugin': null,
  'org.gradle.language.base.plugins.LifecycleBasePlugin': null, 'org.gradle.api.plugins.JvmEcosystemPlugin': null,
  'org.gradle.api.plugins.ReportingBasePlugin': null, 'org.gradle.api.plugins.JvmToolchainsPlugin': null,
  'org.gradle.api.plugins.JvmTestSuitePlugin': 'org.gradle.jvm-test-suite', 'org.gradle.testing.base.plugins.TestSuiteBasePlugin': null,
  'org.jetbrains.kotlin.gradle.scripting.internal.ScriptingGradleSubplugin': null,
  'org.jetbrains.kotlin.gradle.scripting.internal.ScriptingKotlinGradleSubplugin': null,
  'org.gradle.kotlin.dsl.provider.plugins.KotlinScriptBasePlugin': null, 'org.gradle.kotlin.dsl.provider.plugins.KotlinScriptRootPlugin': null,
};

export class KotlinDependencies {
  private readonly configFile: string;
  private installing = false;
  constructor(private readonly projectRoot: string, options: KotlinContextOptions = {}) {
    if (!nativePath(projectRoot) || !isAbsolute(projectRoot)) throw new TypeError('Provide an absolute project root.');
    this.configFile = kotlinConfigurationOptions(options);
  }
  read(requirements: Configuration['packages']): Promise<PackageRead> { return this.perform(requirements, false); }
  install(requirements: Configuration['packages']): Promise<PackageRead> { return this.perform(requirements, true); }
  private async perform(input: Configuration['packages'], install: boolean): Promise<PackageRead> {
    const problems: Diagnostic[] = [], root = { path: this.projectRoot, identity: '' };
    const report = (code: string, text: string, path = '') => problems.push(problem(root, code, path, text));
    const requests: Request[] = [];
    if (!Array.isArray(input) || !configurationSchema.shape.packages.safeParse(input).success) report('invalid-package-request', 'Provide validated package requirements.');
    else for (const item of input) {
      const version = validRange(item.version), prior = requests.find(request => request.name === item.name);
      if (!/^maven:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(item.name) || !version || valid(version) !== version)
        report('unsupported-native-package', 'Use maven:group:artifact and an exact semantic version: ' + item.name + '.');
      else if (prior && prior.requested !== item.version) report('conflicting-package-requirements', 'Aliases of one physical package must agree exactly: ' + item.name + '.');
      else if (item.phases.includes('build') && (item.name !== 'maven:org.jetbrains.kotlin:kotlin-gradle-plugin' || version !== '2.4.10' || item.phases.length !== 1))
        report('unsupported-native-package', 'Only the pinned Kotlin Gradle plugin is a build requirement.');
      else if (prior) prior.phases = phases.filter(phase => prior.phases.includes(phase) || item.phases.includes(phase));
      else requests.push({ name: item.name, version, requested: item.version, phases: [...item.phases] });
    }
    const packages: PackageObservation[] = requests.map(item => ({ name: item.name, requested: item.requested }));
    const result = (): PackageRead => ({ packages, problems, deferred: [], ...(!problems.length ? { value: packages.map(item => ({ name: item.name, version: item.installed! })) } : {}) });
    if (problems.length || !requests.length) return result();
    if (install && this.installing) { report('installation-in-progress', 'This instance already has an installation in progress.'); return result(); }
    if (install) this.installing = true;
    try {
      const connection = await connectDirectory(this.projectRoot, ['.git', 'node_modules', '.gradle', '.kotlin', 'build']);
      if (connection.value?.status !== 'connected') { problems.push(...connection.problems); report('native-project-unavailable', 'Connect an existing ordinary Kotlin project.'); return result(); }
      const context = connection.value.context;
      if (install) await this.acquire(context, requests);
      const snapshot = await context.readSnapshot(), configured = kotlinConfiguration(snapshot, this.configFile);
      problems.push(...snapshot.problems, ...configured.problems);
      if (!configured.value || !snapshot.complete || problems.length) return result();
      const data = configured.value;
      if (!data.runtimeClassPath || !data.artifacts?.length) { report('native-install-required', 'No complete native acquisition report exists.', kotlinReportPath); return result(); }
      const actual = await captureKotlinInputs(snapshot, data); problems.push(...actual.problems);
      const captured = new Map(actual.inputs.map(item => [new URL(item.uri).href, item.version]));
      for (const item of data.artifacts) if (captured.get(pathToFileURL(item.path).href) !== item.version)
        report('native-input-changed', 'Installed native artifact changed: ' + item.path, kotlinReportPath);
      if (problems.length) return result();
      for (const [index, request] of requests.entries()) {
        const observed = data.packages.filter(item => item.name === request.name);
        if (observed.length !== 1 || !request.phases.every(phase => observed[0]!.phases.includes(phase))) report('package-not-installed', 'No matching native package and phases for ' + request.name, kotlinReportPath);
        else {
          const version = observed[0]!.version;
          packages[index] = { name: request.name, requested: request.requested, selected: version, installed: version };
          if (version !== request.version) report('incompatible-package-version', request.name + '@' + version + ' does not match ' + request.version, kotlinReportPath);
        }
      }
      const after = await context.readSnapshot();
      if (canonical(snapshot) !== canonical(after)) report('stale-project', 'Native configuration changed while reading dependencies.');
    } catch (error) {
      if (error && typeof error === 'object' && 'diagnostic' in error) problems.push((error as { diagnostic: Diagnostic }).diagnostic);
      else report(install ? 'package-install-failed' : 'native-package-read-failed', message(error));
      if (install) report('installation-effects', 'Explicit Gradle installation may have changed the managed contribution, native lock/report and Gradle caches. Configuration may have executed before refusal. Inspect before retrying.', contribution);
    } finally { if (install) this.installing = false; }
    return result();
  }
  private async acquire(context: ProjectContext, requests: Request[]): Promise<void> {
    const files = new ProjectFiles(context.root), snapshot = await context.readSnapshot();
    if (!snapshot.complete) throw new Error('A complete ordinary project is required before installation.');
    const json = (path: string) => {
      const input = snapshot.files.find(item => item.path === path); if (!input) throw new Error('Missing native prerequisite: ' + path);
      return readJson(new TextDecoder('utf-8', { fatal: true }).decode(input.bytes), (_code, text) => { throw new Error(text); });
    };
    const settings = kotlinSettings.parse(json(this.configFile));
    const toolchain = await captureKotlinInputs(snapshot, { ...settings, format: 1, kotlin: '2.4.10', gradle: '9.1.0', jvmTarget: '21',
      classPath: { main: [], test: [] }, inputs: [], packages: [] });
    if (toolchain.problems.length) throw new Error(toolchain.problems.map(item => item.message).join('\n'));
    const text = (path: string) => { const file = snapshot.files.find(file => file.path === path); if (!file) throw new Error('Missing native prerequisite: ' + path); return new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); };
    const expectedWrapper = await fs.readFile(join(kotlinResources, 'wrapper/gradle-wrapper.jar'));
    if (hash(expectedWrapper) !== snapshot.files.find(file => file.path === 'gradle/wrapper/gradle-wrapper.jar')?.version
      || text('gradle/wrapper/gradle-wrapper.properties') !== await fs.readFile(join(kotlinResources, 'wrapper/gradle-wrapper.properties'), 'utf8')) throw new Error('Use the pinned Gradle9.1 wrapper and distribution checksum.');
    const inputs = new Map<string, ObservedFile>();
    for (const path of [...snapshot.files.filter(file => kotlinBuildInput(file.path, this.configFile)).map(file => file.path), kotlinReportPath, 'gradle.lockfile']) inputs.set(path, await files.read(path));
    if (!inputs.has(contribution)) throw new Error('Explicitly apply the owned dependency contribution before installing.');
    for (const [path, before] of inputs) await files.verify(path, before);
    if (!/^JAVA_VERSION="21(?:[.+-]|\")/m.test(await fs.readFile(join(settings.javaHome, 'release'), 'utf8'))) throw new Error('Choose explicit JDK21.');
    const dependencies = requests.flatMap(item => item.phases.filter(phase => phase !== 'build').map(phase =>
      '    add(' + JSON.stringify(phase === 'runtime' ? 'implementation' : 'testImplementation') + ', ' + JSON.stringify(item.name.slice(6) + ':' + item.version) + ')'));
    const bytes = new TextEncoder().encode('// Generated dependency contribution; updated by explicit expec install.\ndependencies {\n' + dependencies.join('\n') + '\n}\n');
    const report = inputs.get(kotlinReportPath)!.value;
    const prior = report.state === 'file' ? kotlinReport.parse(readJson(new TextDecoder('utf-8', { fatal: true }).decode(report.bytes), (_code, text) => { throw new Error(text); })) : undefined;
    const current = inputs.get(contribution)!.value;
    if (prior && new Set(prior.inputs.map(item => item.path)).size !== prior.inputs.length || current.state !== 'file'
      || !Buffer.from(current.bytes).equals(bytes) && !Buffer.from(current.bytes).equals(Buffer.from(kotlinStarterContribution))
        && hash(current.bytes) !== prior?.inputs.find(item => item.path === contribution)?.version)
      fail(context.root, 'native-contribution-conflict', contribution, 'The dependency contribution has handwritten changes; retain or explicitly reconcile them before installation.');
    await files.write(contribution, bytes, inputs.get(contribution)!);
    inputs.set(contribution, await files.read(contribution));
    const old = inputs.get(kotlinReportPath)!;
    if (old.value.state === 'file') await files.remove(kotlinReportPath, old);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS', 'JAVA_OPTS', 'CLASSPATH', 'GRADLE_OPTS'].includes(key.toUpperCase()) && !key.toUpperCase().startsWith('ORG_GRADLE_PROJECT_')));
    env.JAVA_HOME = settings.javaHome;
    const script = await fs.realpath(join(kotlinResources, 'acquire.gradle'));
    await files.verifyRoot();
    const native = await promisify(execFile)(join(settings.javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
      ['-classpath', files.path('gradle/wrapper/gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain', '--no-daemon', '--console=plain',
        '--no-configuration-cache', '--no-configure-on-demand', '-p', context.root.path, '-I', script,
        '-Dorg.gradle.java.home=' + settings.javaHome, '-Dorg.gradle.java.installations.auto-download=false', '--write-locks', 'expecAcquireKotlin'],
      { cwd: context.root.path, env, timeout: 180_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    const lines = native.stdout.split(/\r?\n/).filter(line => line.startsWith('EXPEC_KOTLIN_ACQUISITION='));
    if (lines.length !== 1) throw new Error('Missing or duplicate native acquisition result.');
    const data = nativeReport.parse(JSON.parse(lines[0]!.slice('EXPEC_KOTLIN_ACQUISITION='.length)));
    const expectedScripts = new Map([['settings.gradle.kts', 'settings'], ['build.gradle.kts', 'project'], [contribution, 'project']]);
    if (data.init.length !== 1 || resolve(data.init[0]!) !== script) fail(context.root, 'unsupported-native-input', '', 'Unsupported native initialization script input.');
    for (const observed of data.scripts) {
      const path = observed.file && relative(context.root.path, observed.file).split(sep).join('/');
      if (!path || expectedScripts.get(path) !== observed.targetType || observed.uri !== null || observed.build !== ':'
        || observed.target !== (observed.targetType === 'settings' ? null : ':')) fail(context.root, 'unsupported-native-input', path && literal(path) ? path : '', 'Unsupported actual applied script: ' + observed.file);
      expectedScripts.delete(path);
    }
    if (expectedScripts.size || !data.plugins.some(plugin => plugin.id === 'org.jetbrains.kotlin.jvm') || data.plugins.some(plugin =>
      plugin.build !== ':' || plugin.targetType !== 'project' || plugin.target !== ':' || !(plugin.type in plugins) || plugins[plugin.type] !== plugin.id)) throw new Error('Unsupported or missing actual native plugin observation.');
    const roots = { main: data.sourceRoots.main.map(path => relative(context.root.path, path).split(sep).join('/')),
      test: data.sourceRoots.test.map(path => relative(context.root.path, path).split(sep).join('/')) };
    if (canonical(roots) !== canonical(settings.sourceRoots) || resolve(data.javaHome) !== resolve(settings.javaHome))
      throw new Error('Native source roots or JDK do not match the explicit configuration: ' + JSON.stringify({ sourceRoots: roots, javaHome: data.javaHome }));
    for (const [path, before] of inputs) if (path !== kotlinReportPath && path !== 'gradle.lockfile') await files.verify(path, before);
    const fresh = await context.readSnapshot(); if (!fresh.complete) throw new Error('Project changed during native installation.');
    const packages: { name: string; version: string; phases: string[] }[] = [{ name: 'maven:org.jetbrains.kotlin:kotlin-gradle-plugin', version: data.kotlin, phases: ['build'] }];
    for (const artifact of data.artifacts) {
      const existing = packages.find(item => item.name === artifact.name);
      if (existing && existing.version !== artifact.version) throw new Error('Source sets resolved incompatible versions of ' + artifact.name);
      if (existing) { if (!existing.phases.includes(artifact.phase)) existing.phases.push(artifact.phase); }
      else packages.push({ name: artifact.name, version: artifact.version, phases: [artifact.phase] });
    }
    const provisional = kotlinReport.parse({ format: data.format, kotlin: data.kotlin, gradle: data.gradle, jvmTarget: data.jvmTarget,
      javaHome: settings.javaHome, sourceRoots: roots, javaRoots: { main: data.javaRoots.main.map(path => relative(context.root.path, path).split(sep).join('/')),
        test: data.javaRoots.test.map(path => relative(context.root.path, path).split(sep).join('/')) }, classPath: data.classPath, runtimeClassPath: data.runtimeClassPath, packages,
      inputs: fresh.files.filter(file => kotlinBuildInput(file.path, this.configFile)).map(file => ({ path: file.path, version: file.version })) });
    const captured = await captureKotlinInputs(fresh, provisional); if (captured.problems.length) throw new Error(captured.problems.map(item => item.message).join('\n'));
    if (toolchain.inputs.some(before => captured.inputs.find(after => after.uri === before.uri)?.version !== before.version)) throw new Error('Native toolchain changed during installation.');
    const artifacts = [...new Set([...data.classPath.main, ...data.classPath.test, ...data.runtimeClassPath.main, ...data.runtimeClassPath.test])].map(path => ({ path,
      version: captured.inputs.find(item => item.uri === pathToFileURL(path).href)?.version }));
    if (artifacts.some(item => !item.version)) throw new Error('Native artifact fingerprint is missing.');
    const complete = kotlinReport.parse({ ...provisional, artifacts });
    await files.verifyRoot(); await files.write(kotlinReportPath, new TextEncoder().encode(JSON.stringify(complete, null, 2) + '\n'), await files.read(kotlinReportPath));
  }
}
