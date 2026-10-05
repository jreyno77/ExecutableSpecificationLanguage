import { afterEach, it } from 'vitest';
import { KotlinDelivery } from '../dsl/kotlin-delivery.js';
afterEach(() => KotlinDelivery.dispose());

it('returns an unspecified result obligation in both plan and write, including unchanged repeat', async () => {
  const project = await KotlinDelivery.create();
  project.source('function loadTitle()');
  await project.planContracts();
  project.expectPlannedObligation('unspecified-result', 1, 1);
  await project.buildContracts();
  project.expectObligationAt('unspecified-result', 1, 1);
  project.expectFileContains('src/main/kotlin/store/loadTitle.kt', 'unspecified-result: Any? is a scaffold placeholder.');
  await project.repeatContracts();
  project.expectObligationAt('unspecified-result', 1, 1);
}, 120_000);

it('returns authored field and parameter defaults without evaluating them', async () => {
  const project = await KotlinDelivery.create();
  project.source('type Book { copies: Number = 1 }\nfunction save(copies: Number = 2) returns Nothing');
  await project.buildContracts();
  project.expectObligationAt('default-verification-required', 1, 13);
  project.expectObligationAt('default-verification-required', 2, 15);
  project.expectFileContains('src/main/kotlin/store/Book.kt', 'copies = 1');
  await project.runConsumer('fun main() { try { store.save() } catch (failure: NotImplementedError) { println(failure.message) } }');
  project.expectStdout('Unimplemented default: save.copies');
}, 120_000);

it('keeps declared conditions, prose and failure obligations after an actual body is supplied', async () => {
  const project = await KotlinDelivery.create();
  project.source('error type Rejected { code: "rejected" }\nfunction save(copies: Number) returns Number fails with Rejected {\n requires copies >= 0\n ensures result >= 0\n promises "keeps every copy"\n}');
  await project.buildContracts();
  project.expectObligationAt('failure-verification-required', 2, 57);
  project.expectObligationAt('verification-required', 3, 2);
  project.expectObligationAt('verification-required', 4, 2);
  project.expectObligationAt('verification-required', 5, 2);
  await project.implement('save', 'return copies');
  await project.repeatContracts();
  project.expectObligationAt('failure-verification-required', 2, 57);
  project.expectObligationAt('verification-required', 5, 2);
  project.expectFileContains('src/main/kotlin/store/save.kt', 'return copies');
  project.expectFileContains('src/main/kotlin/store/save.kt', 'keeps every copy');
}, 120_000);

it('does not invent extra contract findings for an ordinary fully specified throwing stub', async () => {
  const project = await KotlinDelivery.create();
  project.source('function loadTitle() returns Text');
  await project.buildContracts();
  project.expectNoContractObligations();
  await project.runConsumer('fun main() { println(store.loadTitle()) }');
  project.expectUnimplemented('loadTitle');
}, 120_000);


