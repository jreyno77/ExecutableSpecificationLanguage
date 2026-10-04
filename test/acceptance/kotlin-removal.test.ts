import { afterEach, it } from 'vitest';
import { KotlinDelivery } from '../dsl/kotlin-delivery.js';

afterEach(() => KotlinDelivery.dispose());

it('deletes an unused generated declaration and recognizes a repeated request', async () => {
  const project = await KotlinDelivery.create();
  project.source('function unused() returns Nothing\nclass Kept {}');
  await project.buildContracts();
  await project.deleteContracts('unused');
  project.expectMissingFile('src/main/kotlin/store/unused.kt');
  project.expectFileContains('src/main/kotlin/store/Kept.kt', 'class Kept');
  await project.deleteContracts('unused');
  project.expectUnchanged();
}, 120_000);

it('deletes a nested generated stub while retaining its implemented neighbor', async () => {
  const project = await KotlinDelivery.create();
  project.source('class StoreGame { public save, delete\ncapability save() returns Text\ncapability delete() returns Nothing }');
  await project.buildContracts();
  await project.implement('StoreGame.save', 'return "Dune"');
  await project.deleteContracts('StoreGame.delete');
  project.expectFileMissingText('src/main/kotlin/store/StoreGame.kt', 'fun delete(');
  project.expectFileContains('src/main/kotlin/store/StoreGame.kt', 'return "Dune"');
  await project.runConsumer('fun main() { println(store.StoreGame().save()) }');
  project.expectStdout('Dune');
}, 120_000);

it('does not delete a handwritten implementation through the direct output API', async () => {
  const project = await KotlinDelivery.create();
  project.source('function title() returns Text');
  await project.buildContracts();
  await project.implement('title', 'return "Dune"');
  await project.expectDeleteRefused('title', 'handwritten-removal');
}, 120_000);

it('does not orphan a native caller when directly deleting a generated stub', async () => {
  const project = await KotlinDelivery.create();
  project.source('function title() returns Text');
  await project.buildContracts();
  await project.file('src/main/kotlin/store/Caller.kt', 'package store\nfun launch() = title()\n');
  await project.expectDeleteRefused('title', 'output-conflict');
}, 120_000);
