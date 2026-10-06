import { promises as fs } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { validRange } from 'semver';
import type { Configuration } from '../connection/configuration.js';
import type { FileChange } from '../connection/project-writer.js';
import { nativePath } from '../connection/project-connection.js';
import { reject } from '../connection/initialization-destination.js';
import { kotlinResources } from './kotlin-context.js';

const prerequisites = [
  { alias: 'kotlin-plugin', name: 'maven:org.jetbrains.kotlin:kotlin-gradle-plugin', version: '2.4.10', phases: ['build'] },
  { alias: 'kotlin-stdlib', name: 'maven:org.jetbrains.kotlin:kotlin-stdlib', version: '2.4.10', phases: ['runtime'] },
  { alias: 'junit-jupiter', name: 'maven:org.junit.jupiter:junit-jupiter', version: '6.1.3', phases: ['test'] },
  { alias: 'junit-launcher', name: 'maven:org.junit.platform:junit-platform-launcher', version: '6.1.3', phases: ['test'] },
  { alias: 'junit-console', name: 'maven:org.junit.platform:junit-platform-console', version: '6.1.3', phases: ['test'] },
  { alias: 'junit-reporting', name: 'maven:org.junit.platform:junit-platform-reporting', version: '6.1.3', phases: ['test'] },
] satisfies Configuration['packages'];
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
export const kotlinStarterContribution = '// Generated dependency contribution; updated by explicit expec install.\ndependencies {\n    add("implementation", "org.jetbrains.kotlin:kotlin-stdlib:2.4.10")\n    add("testImplementation", "org.junit.jupiter:junit-jupiter:6.1.3")\n    add("testImplementation", "org.junit.platform:junit-platform-launcher:6.1.3")\n    add("testImplementation", "org.junit.platform:junit-platform-console:6.1.3")\n    add("testImplementation", "org.junit.platform:junit-platform-reporting:6.1.3")\n}\n';

/** Prepares ordinary starter bytes and declared prerequisites; never runs Gradle or installs a JDK. */
export async function kotlinStarter(configuration: Configuration, root: string, javaHome?: string): Promise<{ configuration: Configuration; changes: readonly FileChange[] }> {
  if (!javaHome || !nativePath(javaHome) || !isAbsolute(javaHome)) reject('unsupported-initialization-toolchain', root, 'Choose an explicit ordinary JDK21 javaHome.');
  javaHome = resolve(javaHome);
  const info = await fs.lstat(javaHome);
  if (!info.isDirectory() || info.isSymbolicLink() || await fs.realpath(javaHome) !== javaHome
    || !/^JAVA_VERSION="21(?:[.+-]|\")/m.test(await fs.readFile(join(javaHome, 'release'), 'utf8'))) reject('unsupported-initialization-toolchain', root, 'Choose an ordinary installed JDK21.');
  const output = configuration.outputs.find(output => output.id === 'kotlin');
  if (output && (output.options.directory !== undefined && output.options.directory !== 'src/main/kotlin'
    || output.options.package !== 'generated')) reject('unsupported-initialization-options', root, 'The Kotlin starter requires src/main/kotlin and package generated; edit options explicitly after initialization.');
  const packages = configuration.packages.map(item => structuredClone(item));
  for (const required of prerequisites) {
    const existing = packages.filter(item => item.name === required.name);
    if (existing.length ? existing.some(item => validRange(item.version) !== required.version || item.version !== existing[0]!.version)
      || !existing.some(item => required.phases.every(phase => item.phases.includes(phase))) : packages.some(item => item.alias === required.alias)) {
      reject('unsupported-initialization-toolchain', root, 'The Kotlin starter requires an agreeing exact ' + required.name + '@' + required.version + ' requirement and its declared phase.');
    }
    if (!existing.length) packages.push(structuredClone(required));
  }
  const changes: FileChange[] = Object.entries({
    'settings.gradle.kts': 'rootProject.name = "expec-project"\n',
    'build.gradle.kts': 'plugins { kotlin("jvm") version "2.4.10" }\nrepositories { mavenCentral() }\nkotlin {\n    jvmToolchain(21)\n    sourceSets.named("main") { kotlin.setSrcDirs(listOf("src/main/kotlin")) }\n    sourceSets.named("test") { kotlin.setSrcDirs(listOf("src/test/kotlin")) }\n}\ndependencyLocking { lockAllConfigurations() }\napply(from = ".expec/kotlin/dependencies.gradle.kts")\ntasks.test { useJUnitPlatform() }\n',
    'expec.kotlin.json': json({ javaHome, sourceRoots: { main: ['src/main/kotlin'], test: ['src/test/kotlin'] } }),
    '.gitignore': '.gradle/\n.kotlin/\nbuild/\n', 'src/main/kotlin/Empty.kt': '// Application contracts are generated here.\n',
    '.expec/kotlin/dependencies.gradle.kts': kotlinStarterContribution,
  }).map(([path, text]) => ({ kind: 'write', path, bytes: new TextEncoder().encode(text) }));
  for (const file of ['gradlew', 'gradlew.bat', 'gradle-wrapper.jar', 'gradle-wrapper.properties']) changes.push({ kind: 'write',
    path: file.startsWith('gradle-wrapper') ? 'gradle/wrapper/' + file : file, bytes: new Uint8Array(await fs.readFile(join(kotlinResources, 'wrapper', file))) });
  return { configuration: { ...structuredClone(configuration), packages, project: { root }, outputs: structuredClone(output ? configuration.outputs
    : [...configuration.outputs, { id: 'kotlin', options: { directory: 'src/main/kotlin', package: 'generated' } }]) }, changes };
}
