import { it } from 'vitest';
import { KotlinAcceptance } from '../../../dsl/project/kotlin/kotlin-acceptance.js';

it('constructs a single declared error code as data without invoking an exception', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('error type Rejected { code: "missing"\ndetail: Text }\nfunction rejection() returns Rejected\nexamples { example "missing Dune": rejection() => { code: "missing", detail: "Dune" } }');
  await project.buildContracts(); await project.implement('rejection', 'return Rejected(RejectedCode.Missing, "Dune")');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
  await project.implement('rejection', 'return Rejected(RejectedCode.Missing, "Other")');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value.detail ==> expected: <Dune> but was: <Other>');
}, 240_000);

it('compares error code data while keeping the exception companion out of record identity', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('error type Rejected { code: "missing" | "rejected"\ndetail: Text }\nfunction rejection() returns Rejected\nexamples { example "missing Dune": rejection() => { code: "missing", detail: "Dune" } }');
  await project.buildContracts(); await project.implement('rejection', 'return Rejected(RejectedCode.Missing, "Dune")');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
  await project.implement('rejection', 'return Rejected(RejectedCode.Rejected, "Dune")');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value.code ==> expected: <missing> but was: <rejected>');
}, 240_000);

