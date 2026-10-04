import { it } from 'vitest';
import { KotlinAcceptance } from '../dsl/kotlin-acceptance.js';

it('reuses private comparison ordinals only for the remaining generated expectations', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { example "one": 1 => 1\nexample "title": "Dune" => "Dune" }');
  await project.buildAcceptance();
  project.retireExamples('examples { example "title": "Dune" => "Dune" }', ['one']);
  await project.updateAcceptance();
  await project.expectComparisonContains('internal fun expectData0(');
  await project.expectComparisonExcludes('fun expectData1(');
  await project.runTests(); project.expectTests(1, 0);
}, 300_000);


it('adds a new data comparison without replacing the implemented observation', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity() returns Number\nexample "one Dune": quantity() => 1 }');
  await project.buildAcceptance();
  await project.implementDriver('package store.tests.driver\nopen class ShoppingDriver {\n  // Real basket data.\n  open fun quantity(): Double = 1.0\n}');
  project.source('examples { observation quantity() returns Number\nobservation title() returns Text\nexample "one Dune": quantity() => 1\nexample "book title": title() => "Dune" }');
  await project.updateAcceptance();
  await project.readOperation('quantity'); project.expectReadContains('// Real basket data.'); project.expectReadContains('open fun quantity(): Double = 1.0');
  await project.runTests(); project.expectTests(1, 1); project.expectFailure('Not implemented: title');
  await project.replaceNativeText('src/test/kotlin/store/tests/driver/ShoppingDriver.kt', 'throw NotImplementedError("Not implemented: title")', '"Dune"');
  await project.runTests(); project.expectTests(2, 0);
}, 300_000);

it('retains an unrelated companion declaration while adding a data comparison', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { example "one": 1 => 1 }');
  await project.buildAcceptance();
  await project.addComparisonNeighbor('// Keep the author note.\ninternal fun authorNote(): String = "Dune is a novel"');
  project.source('examples { example "one": 1 => 1\nexample "title": "Dune" => "Dune" }');
  await project.updateAcceptance();
  await project.expectComparisonContains('// Keep the author note.\ninternal fun authorNote(): String = "Dune is a novel"');
  await project.runTests(); project.expectTests(2, 0);
}, 300_000);

it('does not bless an altered number guard while generating new comparisons', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { example "one": 1 => 1 }');
  await project.buildAcceptance();
  await project.weakenFiniteNumberGuard();
  const support = 'src/test/kotlin/store/tests/dsl/ExpecChecks.kt';
  await project.rememberFile(support);
  project.source('examples { example "one": 1 => 1\nexample "title": "Dune" => "Dune" }');
  await project.expectAcceptanceRefused('output-conflict');
  await project.expectFileUnchanged(support);
}, 300_000);

it('removes an unused comparison after explicitly retiring its last example', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { example "one": 1 => 1\nexample "title": "Dune" => "Dune" }');
  await project.buildAcceptance();
  await project.expectComparisonContains('internal fun expectData1(');
  project.retireExamples('examples { example "one": 1 => 1 }', ['title']);
  await project.updateAcceptance();
  await project.expectComparisonExcludes('fun expectData1(');
  await project.runTests(); project.expectTests(1, 0);
}, 300_000);

it('refuses retirement of a comparison still used by handwritten code', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { example "one": 1 => 1\nexample "title": "Dune" => "Dune" }');
  await project.buildAcceptance();
  const caller = 'src/test/kotlin/store/TitleCheck.kt', support = 'src/test/kotlin/store/tests/dsl/ExpecChecks.kt';
  await project.nativeFile(caller, 'package store\nfun checkTitle() { store.tests.dsl.expectData1("Dune", "Dune") }\n');
  await project.rememberFile(caller); await project.rememberFile(support);
  project.retireExamples('examples { example "one": 1 => 1 }', ['title']);
  await project.expectAcceptanceRefused('output-conflict');
  await project.expectFileUnchanged(caller); await project.expectFileUnchanged(support);
}, 300_000);

it('does not repurpose a same-named comparison called by handwritten code', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { example "one": 1 => 1\nexample "title": "Dune" => "Dune" }');
  await project.buildAcceptance();
  const caller = 'src/test/kotlin/store/QuantityCheck.kt', support = 'src/test/kotlin/store/tests/dsl/ExpecChecks.kt';
  await project.nativeFile(caller, 'package store\nfun checkQuantity() { store.tests.dsl.expectData0(1.0, 1.0) }\n');
  await project.rememberFile(caller); await project.rememberFile(support);
  project.retireExamples('examples { example "title": "Dune" => "Dune" }', ['one']);
  await project.expectAcceptanceRefused('output-conflict');
  await project.expectFileUnchanged(caller); await project.expectFileUnchanged(support);
}, 300_000);

