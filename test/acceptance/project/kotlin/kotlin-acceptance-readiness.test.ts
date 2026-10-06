import { it } from 'vitest';
import { KotlinAcceptance } from '../../../dsl/project/kotlin/kotlin-acceptance.js';

it('returns the real test bytes but reports an erased expectation as incomplete', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  await project.buildAcceptance();
  await project.eraseExpectation('one Dune');
  await project.readGroup();
  project.expectReadProblem('output-conflict');
  project.expectReadExcludes('shopping.quantity("Dune")');
}, 120_000);

it('reports disabled generated tests as incomplete native search', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  await project.buildAcceptance();
  await project.replaceNativeText('src/test/kotlin/store/tests/acceptance/ShoppingAcceptance.kt', '@org.junit.jupiter.api.Test', '@org.junit.jupiter.api.Disabled\n  @org.junit.jupiter.api.Test');
  await project.searchGroup();
  project.expectSearchProblem('output-conflict');
}, 120_000);

it('allows actual driver implementation and an unowned neighboring test method', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  await project.buildAcceptance();
  await project.implementDriver('package store.tests.driver\nopen class ShoppingDriver { open fun quantity(title: String): Double = 1.0 }');
  await project.addTestMember('  // Human note stays.\n  fun authorNote(): String = "Dune"');
  await project.searchGroup(); project.expectCompleteSearch();
  await project.readGroup(); project.expectReadContains('fun authorNote(): String = "Dune"');
}, 180_000);
