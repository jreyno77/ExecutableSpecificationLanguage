import { afterEach, it } from 'vitest';
import { KotlinDelivery } from '../../../dsl/project/kotlin/kotlin-delivery.js';

afterEach(() => KotlinDelivery.dispose());

it('refuses colliding finite text cases without inventing a native name', async () => {
  const project = await KotlinDelivery.create();
  project.source('type OS = "windows" | "Windows"');
  await project.expectBuildRefused('unsupported-literal-name');
}, 60_000);

it('keeps an unspecified result visibly Any rather than promising Unit', async () => {
  const project = await KotlinDelivery.create();
  project.source('class StoreGame { public save\ncapability save() }');
  await project.buildContracts();
  project.expectFileContains('src/main/kotlin/store/StoreGame.kt', 'fun save(): Any?');
  project.expectFileContains('src/main/kotlin/store/StoreGame.kt', 'unspecified-result: Any? is a scaffold placeholder.');
  await project.runConsumer('fun main() { val result: Any? = store.StoreGame().save(); println(result) }');
  project.expectUnimplemented('StoreGame.save');
}, 90_000);

it('does not execute an authored default while generating or invoking its stub', async () => {
  const project = await KotlinDelivery.create();
  project.source('function startingCopies() returns Number\nfunction save(copies: Number = startingCopies()) returns Nothing');
  await project.buildContracts();
  await project.implement('startingCopies', 'println("APPLICATION_DEFAULT_EXECUTED"); return 1.0');
  await project.runConsumer('fun main() { try { store.save() } catch (failure: NotImplementedError) { println(failure.message) } }');
  project.expectStdout('Unimplemented default: save.copies');
}, 90_000);

it('reports an unresolved real native caller instead of claiming complete empty usage', async () => {
  const project = await KotlinDelivery.create();
  project.source('class StoreGame {}');
  await project.buildContracts();
  await project.file('src/main/kotlin/store/Launcher.kt', 'package store\nfun launch() = missing.Library(StoreGame())');
  await project.search('StoreGame');
  project.expectIncompleteSearch('kotlin-UNRESOLVED_REFERENCE');
}, 90_000);
