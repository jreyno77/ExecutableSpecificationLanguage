import { afterEach, it } from 'vitest';
import { KotlinDelivery } from '../dsl/kotlin-delivery.js';
afterEach(() => KotlinDelivery.dispose());

it('exposes authored construction while reporting its missing implementation at runtime', async () => {
  const project = await KotlinDelivery.create();
  project.source('class StoreGame { construction(title: Text) }');
  await project.buildContracts();
  project.expectConstructionParameters('StoreGame.construction', ['kotlin.String']);
  await project.runConsumer('fun main() { store.StoreGame("Dune") }');
  project.expectUnimplemented('StoreGame.construction');
}, 90_000);

it('does not silently discard construction on a native interface', async () => {
  const project = await KotlinDelivery.create();
  project.source('interface StoreGame { construction(title: Text) }');
  await project.expectBuildRefused('unsupported-native-construction');
}, 60_000);
