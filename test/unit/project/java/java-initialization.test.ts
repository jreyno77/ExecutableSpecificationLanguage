import { describe, expect, it } from 'vitest';
import { ConfigurationReader, type Configuration } from '../../../../src/project/connection/configuration.js';
import { javaStarter } from '../../../../src/project/java/java-initialization.js';

function configuration(packages: Configuration['packages'] = []): Configuration {
  const read = new ConfigurationReader([]).read({ sourceId: 'expec.json', text: JSON.stringify({
    formatVersion: 1, version: '0.1.0', project: { root: '.' }, build: { entries: ['store.expec'] }, packages,
  }) });
  if (!read.value) throw Error(JSON.stringify(read.problems));
  return read.value;
}
const javaHome = process.env.JAVA_HOME!;

describe('preparing a Java starter for the guarded initializer', () => {
  it('prepares ordinary Gradle files and exact test dependencies without changing caller data', async () => {
    const before = configuration(), saved = structuredClone(before), prepared = await javaStarter(before, 'application', javaHome);
    expect(prepared.problems).toEqual([]);
    expect(prepared.value?.configuration.project?.root).toBe('application');
    expect(prepared.value?.configuration.packages).toEqual([
      { alias: 'junit', name: 'maven:org.junit.jupiter:junit-jupiter', version: '6.1.3', phases: ['test'] },
      { alias: 'junit-launcher', name: 'maven:org.junit.platform:junit-platform-launcher', version: '6.1.3', phases: ['test'] },
      { alias: 'junit-console', name: 'maven:org.junit.platform:junit-platform-console', version: '6.1.3', phases: ['test'] },
      { alias: 'junit-reporting', name: 'maven:org.junit.platform:junit-platform-reporting', version: '6.1.3', phases: ['test'] },
    ]);
    expect(prepared.value?.changes.map(change => change.kind === 'write' ? change.path : undefined)).toEqual(expect.arrayContaining([
      'build.gradle', 'settings.gradle', 'gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.jar',
      'gradle/wrapper/gradle-wrapper.properties', 'expec.java.json', '.expec/java/dependencies.gradle',
    ]));
    expect(before).toEqual(saved);
  });
  it('retains an existing exact native requirement and its authored alias and phases', async () => {
    const existing = { alias: 'checks', name: 'maven:org.junit.jupiter:junit-jupiter', version: '6.1.3', phases: ['runtime', 'test'] as const };
    const prepared = await javaStarter(configuration([existing]), '.', javaHome);
    expect(prepared.value?.configuration.packages.filter(item => item.name === existing.name)).toEqual([existing]);
  });
  it('refuses a conflicting native test version before preparing file effects', async () => {
    const prepared = await javaStarter(configuration([{ alias: 'junit', name: 'maven:org.junit.jupiter:junit-jupiter', version: '^6.1.3', phases: ['test'] }]), '.', javaHome);
    expect(prepared.value).toBeUndefined();
    expect(prepared.problems.map(item => item.code)).toContain('unsupported-initialization-toolchain');
  });
  it('does not take an unrelated package alias for the native test requirement', async () => {
    const prepared = await javaStarter(configuration([{ alias: 'junit', name: 'maven:example.books:catalog', version: '1.0.0', phases: ['runtime'] }]), '.', javaHome);
    expect(prepared.value).toBeUndefined();
    expect(prepared.problems.map(item => item.code)).toContain('unsupported-initialization-toolchain');
  });
  it('refuses an incompatible native reporting version before effects', async () => {
    const prepared = await javaStarter(configuration([{alias:'reports',name:'maven:org.junit.platform:junit-platform-reporting',version:'6.0.0',phases:['test']}]),'.',javaHome);
    expect(prepared.value).toBeUndefined();
    expect(prepared.problems.map(item=>item.code)).toContain('unsupported-initialization-toolchain');
  });
  it('preserves an unrelated occupied console alias before effects', async () => {
    const prepared = await javaStarter(configuration([{alias:'junit-console',name:'maven:example.books:console',version:'1.0.0',phases:['test']}]),'.',javaHome);
    expect(prepared.value).toBeUndefined();
    expect(prepared.problems.map(item=>item.code)).toContain('unsupported-initialization-toolchain');
  });

});
