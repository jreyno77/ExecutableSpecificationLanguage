import { it } from 'vitest';
import { KotlinAcceptance } from '../../../dsl/project/kotlin/kotlin-acceptance.js';

it('executes authored arithmetic and Boolean results with finite Number checks', async () => {
  const project = await KotlinAcceptance.connect();
  project.source(`examples {
    observation scaled(value: Number) returns Number { return ((value + 2) * 3 - 1) % 5 }
    observation inRange(value: Number) returns Boolean { return value > 0 and value <= 2 }
    observation isDune(title: Text) returns Boolean { return title == "Dune" }
    observation divide(value: Number, divisor: Number) returns Number { return value / divisor }
    example "arithmetic": scaled(2) => 1
    example "inside": inRange(1) => true
    example "outside": inRange(3) => false
    example "Dune": isDune("Dune") => true
    example "different title": isDune("Children of Dune") => false
    example "finite division": divide(2, 2) => 1
    example "nonfinite division": divide(1, 0) => 0
  }`);
  await project.buildAcceptance();
  await project.runTests(); project.expectTests(6, 1);
  project.expectFailure('Expected finite Number data');
}, 180_000);

it('preserves authored Boolean short circuit without invoking an unused native operation', async () => {
  const project = await KotlinAcceptance.connect();
  project.source(`examples {
    observation unavailable() returns Boolean
    example "and short circuits": false and unavailable() => false
    example "or short circuits": true or unavailable() => true
  }`);
  await project.buildAcceptance();
  await project.implementDriver(`package store.tests.driver
class ShoppingDriver { fun unavailable(): Boolean = error("UNUSED_OPERATION_EXECUTED") }`);
  await project.runTests(); project.expectTests(2, 0);
  project.expectNoFailure('UNUSED_OPERATION_EXECUTED');
}, 180_000);

it('does not convert an application assertion failure into a successful inequality', async () => {
  const project = await KotlinAcceptance.connect();
  project.source(`examples {
    observation quantity() returns Number
    example "different copies": quantity() != 1 => true
  }`);
  await project.buildAcceptance();
  await project.implementDriver(`package store.tests.driver
class ShoppingDriver { fun quantity(): Double = throw org.opentest4j.AssertionFailedError("APPLICATION_CHECK_FAILED") }`);
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('APPLICATION_CHECK_FAILED');
}, 180_000);
