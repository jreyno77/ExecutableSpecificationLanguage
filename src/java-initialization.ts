import type { Check } from './checking.js';
import type { Configuration } from './configuration.js';
import type { FileChange } from './project-writer.js';
import { promises as fs } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { javaAssets } from './java-inputs.js';
import { javaProblem } from './java-settings.js';
import { hash } from './project-files.js';

export const javaContribution = '.expec/java/dependencies.gradle';
export const emptyJavaDependencies = '// .expec Java dependencies, format 1\next.expecJavaDependencies = []\n';
const wrapperFiles = ['gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.jar', 'gradle/wrapper/gradle-wrapper.properties'];

export async function javaWrapper(): Promise<readonly FileChange[]> {
  const files = await Promise.all(wrapperFiles.map(async path => ({ kind: 'write' as const, path,
    bytes: Uint8Array.from(await fs.readFile(join(javaAssets, 'wrapper', path))) })));
  const jar = files[2]!, properties = new TextDecoder().decode(files[3]!.bytes);
  if (hash(jar.bytes) !== '76805e32c009c0cf0dd5d206bddc9fb22ea42e84db904b764f3047de095493f3'
    || !properties.includes('gradle-9.1.0-bin.zip')
    || !properties.includes('distributionSha256Sum=a17ddd85a26b6a7f5ddb71ff8b05fc5104c0202c6e64782429790c933686c806')) throw Error('Pinned Gradle wrapper resources do not match.');
  return files;
}

/** Prepares the native starter for the ordinary guarded initializer. */
export async function javaStarter(configuration: Configuration, root: string, javaHome: string): Promise<Check<{
  readonly configuration: Configuration; readonly changes: readonly FileChange[];
}>> {
  const problems: Check<never>['problems'][number][] = [], packages = configuration.packages.map(item => structuredClone(item));
  for (const [alias, name] of [['junit', 'maven:org.junit.jupiter:junit-jupiter'], ['junit-launcher', 'maven:org.junit.platform:junit-platform-launcher'],
    ['junit-console', 'maven:org.junit.platform:junit-platform-console'], ['junit-reporting', 'maven:org.junit.platform:junit-platform-reporting']] as const) {
    const existing = packages.filter(item => item.name === name);
    if (existing.length ? existing.some(item => item.version !== '6.1.3') || !existing.some(item => item.phases.includes('test'))
      : packages.some(item => item.alias === alias)) problems.push(javaProblem('unsupported-initialization-toolchain',
      'The Java starter requires an exact ' + name + ' 6.1.3 test requirement and an available alias.', root));
    else if (!existing.length) packages.push({ alias, name, version: '6.1.3', phases: ['test'] });
  }
  const outputs = configuration.outputs.map(output => structuredClone(output));
  for (const [id, options] of [['java', { package: 'generated', directory: 'src/main/java' }],
    ['java-acceptance', { package: 'generated.tests', testRoot: 'src/test/java', domain: 'shopping' }]] as const) {
    const existing = outputs.find(output => output.id === id);
    if (existing && (existing.options.configFile !== undefined && existing.options.configFile !== 'expec.java.json'
      || id === 'java' && existing.options.directory !== undefined && existing.options.directory !== 'src/main/java'
      || id === 'java-acceptance' && existing.options.testRoot !== undefined && existing.options.testRoot !== 'src/test/java'))
      problems.push(javaProblem('unsupported-initialization-options', 'Use the starter source roots and expec.java.json.', root, id));
    else if (!existing) outputs.push({ id, options });
  }
  if (problems.length) return { problems, deferred: [] };
  try {
    await javaToolchain(javaHome);
  } catch (error) { return { problems: [javaProblem('native-toolchain-unavailable', String(error), root, 'javaHome')], deferred: [] }; }
  try {
    const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
    const changes: FileChange[] = Object.entries({
      'settings.gradle': "rootProject.name = 'expec-java-project'\n",
      'build.gradle': "plugins { id 'java' }\nrepositories { mavenCentral() }\njava { toolchain { languageVersion = JavaLanguageVersion.of(21) } }\ndependencyLocking { lockAllConfigurations() }\napply from: '.expec/java/dependencies.gradle'\ntasks.withType(JavaCompile).configureEach { options.release = 21; options.encoding = 'UTF-8' }\ntasks.named('test') { useJUnitPlatform() }\n",
      'expec.java.json': json({ format: 1, release: 21, javaHome, sourceRoots: { main: ['src/main/java'], test: ['src/test/java'] } }),
      [javaContribution]: emptyJavaDependencies,
      '.gitignore': '.gradle/\nbuild/\n', 'src/main/java/.gitkeep': '', 'src/test/java/.gitkeep': '',
    }).map(([path, text]) => ({ kind: 'write', path, bytes: new TextEncoder().encode(text) }));
    changes.push(...await javaWrapper());
    return { value: { configuration: { ...structuredClone(configuration), project: { root }, packages, outputs }, changes }, problems: [], deferred: [] };
  } catch (error) { return { problems: [javaProblem('native-runtime-unavailable', String(error), root)], deferred: [] }; }
}

export async function javaToolchain(javaHome: string): Promise<void> {
  if (!isAbsolute(javaHome) || !/^JAVA_VERSION="21(?:\.|"|-)/m.test(await fs.readFile(join(javaHome, 'release'), 'utf8'))) throw Error('Provide an absolute JDK 21 directory.');
  for (const path of ['bin/java', 'bin/javac', 'lib/modules']) {
    if (!(await fs.stat(join(javaHome, path + (process.platform === 'win32' && path.startsWith('bin/') ? '.exe' : '')))).isFile()) throw Error('Required JDK file is missing: ' + path);
  }
}
