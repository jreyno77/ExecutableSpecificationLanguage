import { it } from 'vitest';
import { KotlinAcceptance } from '../dsl/kotlin-acceptance.js';

it('reads an authored check through its identity and includes its actual Kotlin body', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { check expectOne(actual: Number) { assert actual == 1 }\nexample "one": 1 => 1 }');
  await project.buildAcceptance();
  await project.readOperation('expectOne');
  project.expectReadContains('fun expectOne(actual: Double)');
}, 120_000);

it('reads the complete native acceptance group including its domain and support files', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { example "one": 1 => 1 }');
  await project.buildAcceptance();
  await project.readGroup();
  project.expectReadFiles(['ShoppingAcceptance.kt', 'Shopping.kt', 'ShoppingDriver.kt', 'ShoppingFixture.kt', 'ExpecChecks.kt']);
}, 120_000);
