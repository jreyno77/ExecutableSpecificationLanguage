import { afterEach, describe, it } from 'vitest';
import { JavaPreservation } from '../../../dsl/project/java/java-preservation.js';

afterEach(() => JavaPreservation.dispose());
describe('Java capture keeps cache churn distinct from selected input changes', { timeout: 120_000 }, () => {
  it('keeps unselected cache changes outside a previously captured source plan', async () => {
    const p = await JavaPreservation.connect(); p.source('class Store {}'); await p.generate(); p.expectWritten();
    await p.file('.gradle/caches/noise.bin', 'cache-one'); await p.file('build/reports/last-run.txt', 'old report');
    await p.capture(); p.expectExcludedEntries(['.gradle', 'build']); p.expectNoCapturedFilesBelow(['.gradle', 'build']);
    p.expectCapturedFiles(['expec.java.json', 'build.gradle', 'gradle.lockfile', '.expec/java/classpath.json']);
    await p.planRename('Store', 'Shop'); p.expectPlanAvailable();
    await p.file('.gradle/caches/noise.bin', 'cache-two'); await p.file('build/reports/last-run.txt', 'new report');
    await p.applyPlan(); p.expectAppliedPlan('applied'); p.expectText('src/main/java/store/Shop.java', 'public class Shop');
  });
  it('still guards an actual selected library inside an excluded Gradle cache', async () => {
    const p = await JavaPreservation.connect();
    await p.selectCatalogJarAt('.gradle/caches/catalog.jar', 'public class Book { public String title; }');
    p.source('class Store {}'); await p.generate(); p.expectWritten();
    await p.capture(); p.expectNoCapturedFilesBelow(['.gradle']); p.expectSelectedJarEvidence();
    await p.planRename('Store', 'Shop'); p.expectPlanAvailable(); p.changeSelectedJar();
    await p.applyPlan(); p.expectAppliedPlan('stopped', []); p.expectFileAbsent('src/main/java/store/Shop.java');
    p.expectText('src/main/java/store/Store.java', 'public class Store');
  });
  it('refuses a selected source tree containing a package hidden by the exclusion policy', async () => {
    const p = await JavaPreservation.connect(); p.source('class Store {}'); await p.generate(); p.expectWritten();
    await p.file('src/main/java/build/Hidden.java', 'package build; public class Hidden {}');
    await p.capture(); p.expectExcludedEntries(['src/main/java/build']); p.expectIncompleteSource('src/main/java/build');
    await p.rememberWrites(); await p.planRename('Store', 'Shop'); await p.expectRefusedPlanWithoutWrites();
  });
  it('refuses an undecorated writer that cannot retain the selected native evidence', async () => {
    const p = await JavaPreservation.connect(); p.source('class Store {}'); await p.generate(); p.expectWritten();
    await p.planRename('Store', 'Shop'); p.expectPlanAvailable();
    await p.applyUsingPlainProjectContext(); p.expectAppliedPlan('stopped', []);
    p.expectFileAbsent('src/main/java/store/Shop.java'); p.expectText('src/main/java/store/Store.java', 'public class Store');
  });
  it('refuses a plan after its actual selected JDK image changes', async () => {
    const p = await JavaPreservation.connect(); await p.useIsolatedToolchain();
    p.source('class Store {}'); await p.generate(); p.expectWritten();
    await p.planRename('Store', 'Shop'); p.expectPlanAvailable(); p.changeSelectedJdkImage();
    await p.applyPlan(); p.expectAppliedPlan('stopped', []);
    p.expectFileAbsent('src/main/java/store/Shop.java'); p.expectText('src/main/java/store/Store.java', 'public class Store');
  });
});
