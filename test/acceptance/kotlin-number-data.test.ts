import { it } from 'vitest';
import { KotlinAcceptance } from '../dsl/kotlin-acceptance.js';

it('normalizes negative zero only while preserving other finite record data', async () => {
  const project = await KotlinAcceptance.connect();
  project.source(`type Position { x: Number
 y: Number }
function coordinates() returns Position
examples { example "finite coordinates": coordinates() => { x: -0, y: 0.1 } }`);
  await project.buildContracts(); await project.implement('coordinates', 'return Position(0.0, 0.1)');
  await project.buildAcceptance();
  await project.runTests(); project.expectTests(1, 0);
  await project.implement('coordinates', 'return Position(-0.0, 0.2)');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value.y');
  project.expectFailure('expected: <0.1> but was: <0.2>');
}, 180_000);
