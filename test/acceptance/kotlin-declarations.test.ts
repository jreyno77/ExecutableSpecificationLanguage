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

it('finds a named argument through the authored parameter identity', async () => {
  const project = await KotlinDelivery.create();
  project.source('class StoreGame { public save\ncapability save(title: Text) returns Text }');
  await project.buildContracts();
  await project.implement('StoreGame.save', 'return title');
  await project.file('src/main/kotlin/store/Launcher.kt', 'package store\nfun launch(game: StoreGame) = game.save(title = "Dune")\n');
  await project.search('StoreGame.save.title');
  project.expectIncomingCall('src/main/kotlin/store/Launcher.kt', 54, 59);
  await project.read('StoreGame.save.title');
  project.expectReadText('return title');
}, 90_000);

it('finds a field type use through the authored generic parameter identity', async () => {
  const project = await KotlinDelivery.create();
  project.source('type Box<T> { value: T }');
  await project.buildContracts();
  await project.file('src/main/kotlin/store/Box.kt', 'package store\nclass Box<T>(var value: T)\n');
  await project.search('Box.T');
  project.expectIncomingUse('Box.value', 'src/main/kotlin/store/Box.kt', 38, 39);
}, 90_000);

it('reads a sealed union through its actual native interface definition', async () => {
  const project = await KotlinDelivery.create();
  project.source('type Choice = Text | Number');
  await project.buildContracts();
  await project.read('Choice');
  project.expectReadText('sealed interface Choice');
}, 90_000);
