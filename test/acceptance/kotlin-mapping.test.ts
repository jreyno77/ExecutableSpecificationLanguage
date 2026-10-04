import { afterEach, it } from 'vitest';
import { KotlinDelivery } from '../dsl/kotlin-delivery.js';
afterEach(() => KotlinDelivery.dispose());
it('uses readable native names while retaining the authored contract label', async () => {
  const project = await KotlinDelivery.create();
  project.source('class StoreGame { public save\ncapability save(title: Text) returns Text }');
  project.options({ names: [{ declaration: ['StoreGame', 'save'], name: 'saveGame' }] });
  await project.buildContracts();
  project.expectFileContains('src/main/kotlin/store/StoreGame.kt', 'fun saveGame(title: String): String');
  project.expectFileContains('src/main/kotlin/store/StoreGame.kt', 'Unverified implementation obligation: StoreGame.save.');
  await project.runConsumer('fun main() { store.StoreGame().saveGame("Dune") }');
  project.expectUnimplemented('StoreGame.save');
}, 60_000);

it('uses a durable declaration ID without turning an import alias into symbol identity', async () => {
  const project = await KotlinDelivery.create();
  project.external('catalog', 'type Book { title: Text }');
  project.source('use Book from "catalog"\nclass StoreGame { public save\ncapability save(book: Book) returns Nothing }');
  const book = project.identifier('catalog', ['Book']);
  project.options({ imports: [{ id: book, name: 'catalog.Book', as: 'CatalogBook' }] });
  await project.file('src/main/kotlin/catalog/Book.kt', 'package catalog\ndata class Book(var title: String)');
  await project.buildContracts();
  project.expectFileContains('src/main/kotlin/store/StoreGame.kt', 'import catalog.Book as CatalogBook');
  project.expectFileContains('src/main/kotlin/store/StoreGame.kt', 'fun save(book: CatalogBook): Unit');
  await project.file('src/main/kotlin/store/Launcher.kt', 'package store\nfun launch(game: StoreGame) = game.save(catalog.Book("Dune"))');
  await project.search('StoreGame.save');
  project.expectIncomingCaller('src/main/kotlin/store/Launcher.kt');
  project.expectNativeParameters('StoreGame.save', ['catalog.Book']);
}, 60_000);

it('refuses an ambiguous path rather than choosing the first workspace declaration', async () => {
  const project = await KotlinDelivery.create();
  project.workspace({ 'first.expec': 'class StoreGame {}', 'second.expec': 'class StoreGame {}' });
  project.options({ names: [{ declaration: ['StoreGame'], name: 'SavedGame' }] });
  await project.planContracts();
  project.expectProblem('invalid-native-mapping');
  project.expectNoWritePlan();
}, 60_000);

it('requires a mapping for an external type instead of generating an invented local declaration', async () => {
  const project = await KotlinDelivery.create();
  project.external('catalog', 'type Book { title: Text }');
  project.source('use Book from "catalog"\nclass StoreGame { public save\ncapability save(book: Book) returns Nothing }');
  await project.planContracts();
  project.expectProblem('missing-native-mapping');
  project.expectNoWritePlan();
}, 60_000);

it('does not rebind a retained owned method by changing only its mapping', async () => {
  const project = await KotlinDelivery.create();
  project.source('class StoreGame { public save\ncapability save() returns Nothing }');
  project.options({ names: [{ declaration: ['StoreGame', 'save'], name: 'saveGame' }] });
  await project.buildContracts();
  project.change('class StoreGame { public save\ncapability save() returns Nothing }');
  project.options({ names: [{ declaration: ['StoreGame', 'save'], name: 'writeGame' }] });
  await project.expectUpdateRefused('output-options-changed');
  project.expectFileContains('src/main/kotlin/store/StoreGame.kt', 'fun saveGame(');
}, 60_000);
it('allows a new mapping for a newly added capability', async () => {
  const project = await KotlinDelivery.create();
  project.source('class StoreGame { public save\ncapability save() returns Text }');
  await project.buildContracts();
  await project.implement('StoreGame.save', 'return "saved"');
  project.change('class StoreGame { public save, delete\ncapability save() returns Text\ncapability delete() returns Nothing }');
  project.options({ names: [{ declaration: ['StoreGame', 'delete'], name: 'deleteGame' }] });
  await project.updateContracts();
  project.expectFileContains('src/main/kotlin/store/StoreGame.kt', 'return "saved"');
  await project.runConsumer('fun main() { store.StoreGame().deleteGame() }');
  project.expectUnimplemented('StoreGame.delete');
}, 120_000);

it('preserves the same real method when a corresponding identity rename changes its mapping', async () => {
  const project = await KotlinDelivery.create();
  project.source('class StoreGame { public save\ncapability save() returns Text }');
  project.options({ names: [{ declaration: ['StoreGame', 'save'], name: 'saveGame' }] });
  await project.buildContracts();
  await project.implement('StoreGame.save', 'return "saved"');
  await project.file('src/main/kotlin/store/Launcher.kt', 'package store\nfun launch(game: StoreGame) = game.saveGame()');
  project.change('class StoreGame { public persist\ncapability persist() returns Text }', { 'StoreGame.save': 'StoreGame.persist' });
  project.options({ names: [{ declaration: ['StoreGame', 'persist'], name: 'persistGame' }] });
  await project.updateContracts();
  project.expectFileContains('src/main/kotlin/store/StoreGame.kt', 'fun persistGame(): String');
  project.expectFileText('src/main/kotlin/store/Launcher.kt', 'package store\nfun launch(game: StoreGame) = game.persistGame()');
  await project.runConsumer('fun main() { println(store.launch(store.StoreGame())) }');
  project.expectStdout('saved');
}, 120_000);

it('does not use a different declaration rename to authorize remapping an existing method', async () => {
  const project = await KotlinDelivery.create();
  project.source('class StoreGame { public save\ncapability save() returns Text }\nclass Other {}');
  project.options({ names: [{ declaration: ['StoreGame', 'save'], name: 'saveGame' }] });
  await project.buildContracts();
  project.change('class StoreGame { public save\ncapability save() returns Text }\nclass Unrelated {}', { Other: 'Unrelated' });
  project.options({ names: [{ declaration: ['StoreGame', 'save'], name: 'writeGame' }] });
  await project.expectUpdateRefused('output-options-changed');
  project.expectFileContains('src/main/kotlin/store/StoreGame.kt', 'fun saveGame(');
}, 60_000);
