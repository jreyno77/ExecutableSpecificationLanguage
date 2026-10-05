import { it } from 'vitest';
import { KotlinAcceptance } from '../dsl/kotlin-acceptance.js';

it('checks the instantiated field of a generic record after native type erasure', async () => {
  const project = await KotlinAcceptance.connect();
  project.source(`type Box<T> { value: T }
function loadBox() returns Box<Number>
examples { example "one boxed number": loadBox() => { value: 1 } }`);
  await project.buildContracts();
  await project.implement('loadBox', 'return Box(1.0)');
  await project.buildAcceptance();
  await project.runTests(); project.expectTests(1, 0);
  await project.implement('loadBox', 'return Box("many") as Box<Double>');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value.value: expected Double data');
}, 180_000);
