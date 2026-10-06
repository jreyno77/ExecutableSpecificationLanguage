import { it } from 'vitest';
import { KotlinAcceptance } from '../../../dsl/project/kotlin/kotlin-acceptance.js';

it('compares actual multiplication with authored 64 and fails for the wrong application result', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('function multiply(a: Number, b: Number) returns Number\nexamples { example "eight squared": multiply(8, 8) => 64 }');
  await project.buildContracts();
  await project.implement('multiply', 'return a * b');
  await project.buildAcceptance();
  project.expectVisibleSteps(['8.0', '64.0']);
  await project.runTests(); project.expectTests(1, 0);
  await project.implement('multiply', 'return 63.0');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('expected: <64.0> but was: <63.0>');
}, 180_000);

it('keeps a missing native driver operation explicitly unfinished and failing', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  await project.buildAcceptance();
  project.expectVisibleSteps(['shopping.quantity("Dune")', '1.0']);
  project.expectObligation('implementation-required');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('Not implemented: quantity');
}, 180_000);
