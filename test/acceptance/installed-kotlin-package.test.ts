import { afterAll, beforeAll, it } from 'vitest';
import { InstalledKotlin } from '../dsl/installed-kotlin-package.js';

beforeAll(() => InstalledKotlin.prepare());
afterAll(() => InstalledKotlin.finish());

it('delivers Kotlin through the installed root API and detects a wrong application', async () => {
  const project = new InstalledKotlin();
  await project.installCurrentPackage();
  await project.deliver(`function multiply(a: Number, b: Number) returns Number
examples { example "eight squared": multiply(8, 8) => 64 }`);
  project.expectInitializedAndInstalled('maven:org.jetbrains.kotlin:kotlin-stdlib', '2.4.10');
  project.expectGeneratedSteps(['generated.multiply(8.0, 8.0)', '64.0']);
  project.expectCurrentReadContains('return a * b');
  project.expectOnlyCaller('src/main/kotlin/generated/Launcher.kt', 'multiply');
  project.expectImplementedBodyPreserved();
  project.expectPassed('eightSquared');
  project.expectWrongApplicationFailed('eightSquared', 64, 16);
  await project.expectInstalledPackageAndNotices();
  project.expectCheckoutCanariesDenied();
});

it('uses the installed Kotlin commands from initialization through actual verification', async () => {
  const project = new InstalledKotlin();
  await project.installCurrentPackage();
  await project.deliverCli('function multiply(a: Number, b: Number) returns Number\nexamples { example "eight squared": multiply(8, 8) => 64 }');
  project.expectCliDelivery();
}, 600_000);
