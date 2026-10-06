import { describe, it } from 'vitest';
import { InitializationExamples } from '../../../dsl/project/connection/project-initialization.js';

describe('a Java starter remains an explicit guarded project choice', () => {
  it('previews the real Java toolchain, JUnit requirements and source roots without acquisition', async () => {
    const p = await InitializationExamples.withUnconnectedManifest(); p.forbidProcessNetworkAndOutputExecution();
    await p.prepareJava('../store-game');
    p.expectPlannedRoot('../store-game'); p.expectJavaToolchain();
    p.expectPlannedJsonProperty('expec.java.json', ['sourceRoots'], { main: ['src/main/java'], test: ['src/test/java'] });
    p.expectProposedPackages([
      { alias: 'junit', name: 'maven:org.junit.jupiter:junit-jupiter', version: '6.1.3', phases: ['test'] },
      { alias: 'junit-launcher', name: 'maven:org.junit.platform:junit-platform-launcher', version: '6.1.3', phases: ['test'] },
      { alias: 'junit-console', name: 'maven:org.junit.platform:junit-platform-console', version: '6.1.3', phases: ['test'] },
      { alias: 'junit-reporting', name: 'maven:org.junit.platform:junit-platform-reporting', version: '6.1.3', phases: ['test'] },
    ]);
    await p.expectDestinationAbsent(); await p.expectManifestUnchanged(); p.expectNoForbiddenExecution();
  });
  it('retains a declined Java preview without creating its destination', async () => {
    const p = await InitializationExamples.withUnconnectedManifest(); await p.prepareJava('../store-game'); await p.apply(false);
    p.expectStatus('declined'); p.expectNoWriterReceipt(); await p.expectDestinationAbsent(); await p.expectManifestUnchanged();
  });
  it('applies the guarded starter without installing or generating tests', async () => {
    const p = await InitializationExamples.withUnconnectedManifest(); p.forbidProcessNetworkAndOutputExecution();
    await p.prepareJava('../store-game'); await p.apply(true);
    p.expectStatus('applied'); p.expectConnectedRoot('../store-game'); p.expectWriterStatus('applied');
    await p.expectExactStarterFiles(['settings.gradle','build.gradle','expec.java.json','.expec/java/dependencies.gradle','.gitignore',
      'src/main/java/.gitkeep','src/test/java/.gitkeep','gradlew','gradlew.bat','gradle/wrapper/gradle-wrapper.jar','gradle/wrapper/gradle-wrapper.properties']);
    await p.expectAbsentFiles(['.expec/java/classpath.json','gradle.lockfile','.gradle','build']);
    await p.expectManifestUnchanged(); p.expectNoForbiddenExecution();
  });
});
