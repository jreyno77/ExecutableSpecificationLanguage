import { afterEach, it } from 'vitest';
import { KotlinDelivery } from '../dsl/kotlin-delivery.js';
afterEach(() => KotlinDelivery.dispose());

it('keeps a local record nested and usable by its private capability', async () => {
  const project = await KotlinDelivery.create();
  project.source('class StoreGame {\nlocal type Snapshot { title: Text }\ncapability save(snapshot: Snapshot) returns Nothing\n}');
  await project.buildContracts();
  project.expectFileContains('src/main/kotlin/store/StoreGame.kt', 'private data class Snapshot(var title: String)');
  project.expectFileContains('src/main/kotlin/store/StoreGame.kt', 'private fun save(snapshot: StoreGame.Snapshot): Unit');
  await project.runConsumer('fun main() { println(store.StoreGame()::class.simpleName) }');
  project.expectStdout('StoreGame');
  await project.search('StoreGame.Snapshot');
  project.expectIncomingCaller('src/main/kotlin/store/StoreGame.kt');
}, 90_000);
