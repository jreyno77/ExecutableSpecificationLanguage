import { it } from 'vitest';
import { KotlinAcceptance } from '../../../dsl/project/kotlin/kotlin-acceptance.js';

it('accepts a readable DSL property inherited by a fixture even when the example makes no call', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { example "one": 1 => 1 }');
  const fixture = 'src/test/kotlin/store/tests/dsl/InheritedShopping.kt';
  await project.nativeFile(fixture, 'package store.tests.dsl\nopen class BaseShopping { protected val shopping = Shopping(store.tests.driver.ShoppingDriver()) }\nopen class InheritedShopping : BaseShopping()');
  project.selectFixture(fixture, 'InheritedShopping');
  await project.rememberFile(fixture);
  await project.buildAcceptance(); await project.expectFileUnchanged(fixture);
  await project.runTests(); project.expectTests(1, 0);
}, 180_000);

it('refuses an inherited fixture property with the wrong native DSL type', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { example "one": 1 => 1 }');
  const fixture = 'src/test/kotlin/store/tests/dsl/InheritedShopping.kt';
  await project.nativeFile(fixture, 'package store.tests.dsl\nopen class BaseShopping { protected val shopping = "wrong native type" }\nopen class InheritedShopping : BaseShopping()');
  project.selectFixture(fixture, 'InheritedShopping');
  await project.rememberFile(fixture);
  await project.expectAcceptanceRefused('invalid-native-fixture'); await project.expectFileUnchanged(fixture);
}, 180_000);
