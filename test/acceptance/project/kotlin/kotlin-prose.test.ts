import { it } from 'vitest';
import { KotlinAcceptance } from '../../../dsl/project/kotlin/kotlin-acceptance.js';

it('keeps an unbound prose expectation failing after its native action is implemented', async () => {
  const project = await KotlinAcceptance.connect();
  project.source(`examples {
    action save() returns Nothing
    scenario "saved game" {
      when save()
      then satisfies "the game is safely saved"
    }
  }`);
  await project.buildAcceptance();
  project.expectObligation('implementation-required');
  project.expectObligation('verification-required');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('Not implemented: save');
  await project.implementDriver(`package store.tests.driver
class ShoppingDriver { fun save() { println("APPLICATION_ACTION_EXECUTED") } }`);
  await project.runTests(); project.expectTests(0, 1);
  project.expectRuntimeOutput('APPLICATION_ACTION_EXECUTED');
  project.expectFailure('Verification required: the game is safely saved');
  project.expectNoFailure('Not implemented: save');
}, 180_000);
