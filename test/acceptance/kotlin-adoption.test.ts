import { afterEach, it } from 'vitest';
import { KotlinDelivery } from '../dsl/kotlin-delivery.js';
afterEach(() => KotlinDelivery.dispose());

it('retains an adopted shared native file when its source module moves', async () => {
  const project = await KotlinDelivery.create();
  project.options({ adoptExisting: true });
  project.sourceFile('game.expec', 'class StoreGame { public save\ncapability save() returns Text }');
  await project.file('src/main/kotlin/store/Shared.kt', 'package store\nclass StoreGame { fun save(): String = "saved" }\nclass Other { val note = "retained" }');
  project.associateNative('StoreGame', 'src/main/kotlin/store/Shared.kt', ['StoreGame']);
  project.associateNative('StoreGame.save', 'src/main/kotlin/store/Shared.kt', ['StoreGame', 'save()']);
  await project.buildContracts();
  project.moveSource('contracts/game.expec', ['StoreGame']);
  await project.updateContracts();
  project.expectDefinitionFile('StoreGame', 'src/main/kotlin/store/Shared.kt');
  project.expectFileContains('src/main/kotlin/store/Shared.kt', 'fun save(): String = "saved"');
  project.expectFileContains('src/main/kotlin/store/Shared.kt', 'class Other { val note = "retained" }');
  project.expectMissingFile('src/main/kotlin/store/StoreGame.kt');
  await project.runConsumer('fun main() { println(store.StoreGame().save()) }');
  project.expectStdout('saved');
}, 120_000);

it('requires explicit complete mappings before adopting handwritten code', async () => {
  const project = await KotlinDelivery.create();
  project.options({ adoptExisting: true });
  project.source('class StoreGame { public save\ncapability save() returns Text }');
  await project.file('src/main/kotlin/store/Game.kt', 'package store\nclass StoreGame { fun save() = "saved" }');
  await project.expectBuildRefused('unowned-declaration');
  project.associateNative('StoreGame', 'src/main/kotlin/store/Game.kt', ['StoreGame']);
  project.associateNative('StoreGame.save', 'src/main/kotlin/store/Game.kt', ['StoreGame', 'save()']);
  await project.buildContracts();
  project.expectFileContains('src/main/kotlin/store/Game.kt', 'fun save() = "saved"');
  project.expectMissingFile('src/main/kotlin/store/StoreGame.kt');
  await project.runConsumer('fun main() { println(store.StoreGame().save()) }');
  project.expectStdout('saved');
}, 120_000);
