import { afterEach, it } from 'vitest';
import { KotlinDelivery } from '../dsl/kotlin-delivery.js';
afterEach(() => KotlinDelivery.dispose());

it('preserves adopted handwritten KDoc when its source promise changes', async () => {
  const project = await KotlinDelivery.create();
  project.options({ adoptExisting: true });
  project.source('class StoreGame { public save\ncapability save() returns Text { promises "Saved locally" } }');
  const native = 'package store\nclass StoreGame {\n    /** Author storage note. */\n    fun save(): String = "Dune"\n}\n';
  await project.file('src/main/kotlin/store/StoreGame.kt', native);
  project.associateNative('StoreGame', 'src/main/kotlin/store/StoreGame.kt', ['StoreGame']);
  project.associateNative('StoreGame.save', 'src/main/kotlin/store/StoreGame.kt', ['StoreGame', 'save()']);
  await project.buildContracts();
  project.change('class StoreGame { public save\ncapability save() returns Text { promises "Saved to disk" } }');
  await project.updateContracts();
  project.expectFileText('src/main/kotlin/store/StoreGame.kt', native);
  project.expectNativeObligation('verification-required');
  await project.runConsumer('fun main() { println(store.StoreGame().save()) }');
  project.expectStdout('Dune');
}, 120_000);

it('updates documentation of a newly generated member inside an adopted class', async () => {
  const project = await KotlinDelivery.create();
  project.options({ adoptExisting: true });
  project.source('class StoreGame { public save\ncapability save() returns Text }');
  await project.file('src/main/kotlin/store/StoreGame.kt', 'package store\nclass StoreGame {\n    /** Author storage note. */\n    fun save(): String = "Dune"\n}\n');
  project.associateNative('StoreGame', 'src/main/kotlin/store/StoreGame.kt', ['StoreGame']);
  project.associateNative('StoreGame.save', 'src/main/kotlin/store/StoreGame.kt', ['StoreGame', 'save()']);
  await project.buildContracts();
  project.change('class StoreGame { public save, load\ncapability save() returns Text\ncapability load() returns Text { promises "Reads local data" } }');
  await project.updateContracts();
  await project.implement('StoreGame.load', 'return "Foundation"');
  project.change('class StoreGame { public save, load\ncapability save() returns Text\ncapability load() returns Text { promises "Reads saved data" } }');
  await project.updateContracts();
  project.expectFileContains('src/main/kotlin/store/StoreGame.kt', 'Reads saved data');
  project.expectFileMissingText('src/main/kotlin/store/StoreGame.kt', 'Reads local data');
  project.expectFileContains('src/main/kotlin/store/StoreGame.kt', '/** Author storage note. */');
  await project.runConsumer('fun main() { val game = store.StoreGame(); println(game.save() + ":" + game.load()) }');
  project.expectStdout('Dune:Foundation');
}, 180_000);

it('updates a source promise while keeping handwritten notes and its implementation', async () => {
  const project = await KotlinDelivery.create();
  project.source('function save(title: Text) returns Text { promises "Saved locally" }');
  await project.buildContracts();
  await project.implement('save', 'return "local:" + title');
  await project.replaceContractText('save', 'fun save', '@Suppress("UNUSED_PARAMETER")\nfun save');
  await project.replaceContractText('save', ' * Saved locally\n', ' * Saved locally\n * Author note: keep the local cache.\n');
  project.change('function save(title: Text) returns Text { promises "Saved to disk" }');
  await project.updateContracts();
  project.expectFileContains('src/main/kotlin/store/save.kt', ' * Saved to disk\n * Author note: keep the local cache.');
  project.expectFileMissingText('src/main/kotlin/store/save.kt', 'Saved locally');
  project.expectFileContains('src/main/kotlin/store/save.kt', '@Suppress("UNUSED_PARAMETER")\nfun save');
  await project.read('save');
  project.expectReadText('Saved to disk');
  await project.runConsumer('fun main() { println(store.save("Dune")) }');
  project.expectStdout('local:Dune');
  await project.repeatContracts();
}, 120_000);

it('refuses a competing handwritten change to an owned promise without advancing state', async () => {
  const project = await KotlinDelivery.create();
  project.source('function save(title: Text) returns Text { promises "Saved locally" }');
  await project.buildContracts();
  await project.implement('save', 'return "local:" + title');
  await project.replaceContractText('save', 'Saved locally', 'Saved remotely by the author');
  project.change('function save(title: Text) returns Text { promises "Saved to disk" }');
  await project.expectUpdateRefused('output-conflict');
  project.expectFileContains('src/main/kotlin/store/save.kt', 'Saved remotely by the author');
  project.expectFileContains('src/main/kotlin/store/save.kt', 'return "local:" + title');
}, 120_000);

it('adds and removes an authored condition while retaining unrelated handwritten KDoc links', async () => {
  const project = await KotlinDelivery.create();
  project.source('type Book { title: Text }\nfunction save(copies: Number) returns Number');
  await project.buildContracts();
  await project.implement('save', 'return copies');
  await project.replaceContractText('save', ' * Unverified implementation obligation: save.\n',
    ' * Unverified implementation obligation: save.\n * Author note: see [Book].\n');
  await project.search('save'); await project.expectDocumentationReference('Book', 'src/main/kotlin/store/save.kt', 'Book');
  project.change('type Book { title: Text }\nfunction save(copies: Number) returns Number { requires copies >= 0 }');
  await project.updateContracts();
  project.expectFileContains('src/main/kotlin/store/save.kt', 'requires copies >= 0');
  project.expectFileContains('src/main/kotlin/store/save.kt', 'Author note: see [Book].');
  await project.search('save'); await project.expectDocumentationReference('Book', 'src/main/kotlin/store/save.kt', 'Book');
  project.change('type Book { title: Text }\nfunction save(copies: Number) returns Number');
  await project.updateContracts();
  project.expectFileMissingText('src/main/kotlin/store/save.kt', 'requires copies >= 0');
  project.expectFileContains('src/main/kotlin/store/save.kt', 'Author note: see [Book].');
  await project.search('save'); await project.expectDocumentationReference('Book', 'src/main/kotlin/store/save.kt', 'Book');
  await project.runConsumer('fun main() { println(store.save(2.0)) }');
  project.expectStdout('2.0');
}, 180_000);
