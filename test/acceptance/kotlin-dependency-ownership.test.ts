import { afterEach, it } from 'vitest';
import { KotlinDelivery } from '../dsl/kotlin-delivery.js';

afterEach(() => KotlinDelivery.dispose());

it('refuses contradictory duplicate contribution evidence before native effects', async () => {
  const project = await KotlinDelivery.newProject();
  await project.prepareKotlin(); await project.acceptStarter();
  await project.installDependencies();
  await project.appendDependencyContribution('// Keep this handwritten dependency note.');
  await project.duplicateContributionEvidence();
  await project.appendBuildConfiguration('file("install-ran.txt").writeText("native configuration ran")');
  await project.rememberProjectFiles();
  await project.attemptInstallDependencies();
  project.expectDependencyFailure('native-contribution-conflict');
  await project.expectProjectFilesUnchanged();
  project.expectMissingFile('install-ran.txt');
}, 240_000);

it('keeps a handwritten contribution change before the first native install', async () => {
  const project = await KotlinDelivery.newProject();
  await project.prepareKotlin(); await project.acceptStarter();
  await project.appendDependencyContribution('// Keep the author dependency note.');
  await project.appendBuildConfiguration('file("install-ran.txt").writeText("native configuration ran")');
  await project.rememberProjectFiles();
  await project.attemptInstallDependencies();
  project.expectDependencyFailure('native-contribution-conflict');
  await project.expectProjectFilesUnchanged();
  project.expectFileContains('.expec/kotlin/dependencies.gradle.kts', '// Keep the author dependency note.');
  project.expectMissingFile('install-ran.txt');
}, 240_000);

it('keeps a handwritten contribution change after a successful native install', async () => {
  const project = await KotlinDelivery.newProject();
  await project.prepareKotlin(); await project.acceptStarter();
  await project.installDependencies();
  await project.appendDependencyContribution('// Keep the installed project note.');
  await project.appendBuildConfiguration('file("install-ran.txt").writeText("native configuration ran")');
  await project.rememberProjectFiles();
  await project.attemptInstallDependencies();
  project.expectDependencyFailure('native-contribution-conflict');
  await project.expectProjectFilesUnchanged();
  project.expectFileContains('.expec/kotlin/dependencies.gradle.kts', '// Keep the installed project note.');
  project.expectMissingFile('install-ran.txt');
}, 240_000);

it('retries the same generated contribution after an actual native installation failure', async () => {
  const project = await KotlinDelivery.newProject();
  await project.prepareKotlin(); await project.acceptStarter();
  await project.installDependencies();
  await project.appendBuildConfiguration('throw GradleException("try again")');
  await project.attemptInstallDependencies();
  project.expectDependencyFailure('package-install-failed');
  project.expectMissingFile('.expec/kotlin/classpath.json');
  await project.replaceBuildConfiguration('throw GradleException("try again")', '// Repaired the native build.');
  await project.installDependencies(); await project.readDependencies();
  project.expectInstalledPackage('maven:org.jetbrains.kotlin:kotlin-stdlib', '2.4.10');
  project.expectFileContains('build.gradle.kts', '// Repaired the native build.');
}, 240_000);
