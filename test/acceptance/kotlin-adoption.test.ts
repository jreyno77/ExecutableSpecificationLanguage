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

it('adopts signature parameters through the explicitly selected callable', async () => {
  const project = await KotlinDelivery.create();
  project.options({ adoptExisting: true });
  project.source('function title(book: Text) returns Text');
  await project.file('src/main/kotlin/store/Books.kt', 'package store\nfun title(book: String): String = book\n');
  project.associateCallable('title', 'src/main/kotlin/store/Books.kt', [], 'title', ['kotlin.String']);
  await project.buildContracts();
  project.expectFileText('src/main/kotlin/store/Books.kt', 'package store\nfun title(book: String): String = book\n');
  await project.read('title.book');
  project.expectReadText('fun title(book: String): String = book');
}, 90_000);

it('does not silently rebind a differently named native parameter', async () => {
  const project = await KotlinDelivery.create();
  project.options({ adoptExisting: true });
  project.source('function title(book: Text) returns Text');
  await project.file('src/main/kotlin/store/Books.kt', 'package store\nfun title(item: String): String = item\n');
  project.associateCallable('title', 'src/main/kotlin/store/Books.kt', [], 'title', ['kotlin.String']);
  await project.expectBuildRefused('native-signature-conflict');
}, 90_000);

it('does not accept swapped same-type parameters as the same signature', async () => {
  const project = await KotlinDelivery.create();
  project.options({ adoptExisting: true });
  project.source('function combine(first: Text, second: Text) returns Text');
  await project.file('src/main/kotlin/store/Books.kt', 'package store\nfun combine(second: String, first: String): String = first + second\n');
  project.associateCallable('combine', 'src/main/kotlin/store/Books.kt', [], 'combine', ['kotlin.String', 'kotlin.String']);
  await project.expectBuildRefused('native-signature-conflict');
}, 90_000);

it('preserves a compatible handwritten default when adopting its callable', async () => {
  const project = await KotlinDelivery.create();
  project.options({ adoptExisting: true });
  project.source('function title(book: Text = "Dune") returns Text');
  const native = 'package store\nfun title(book: String = "Dune"): String = book\n';
  await project.file('src/main/kotlin/store/Books.kt', native);
  project.associateCallable('title', 'src/main/kotlin/store/Books.kt', [], 'title', ['kotlin.String']);
  await project.buildContracts();
  project.expectFileText('src/main/kotlin/store/Books.kt', native);
  await project.runConsumer('fun main() { println(store.title()) }');
  project.expectStdout('Dune');
}, 90_000);

it('refuses a rename that would capture a real caller with a different local function', async () => {
  const project = await KotlinDelivery.create();
  project.source('function save() returns Text');
  await project.buildContracts();
  await project.implement('save', 'return "Dune"');
  const caller = 'package store\nfun launch(): String {\n    fun load(): String = "wrong"\n    return save()\n}\n';
  await project.file('src/main/kotlin/store/Launcher.kt', caller);
  project.change('function load() returns Text', { save: 'load' });
  await project.expectUpdateRefused('native-binding-changed');
  project.expectFileText('src/main/kotlin/store/Launcher.kt', caller);
  project.expectMissingFile('src/main/kotlin/store/load.kt');
}, 120_000);

it('renames a parameter in its signature, implementation and named callers', async () => {
  const project = await KotlinDelivery.create();
  project.source('function save(title: Text) returns Text');
  await project.buildContracts();
  await project.implement('save', 'return title');
  await project.file('src/main/kotlin/store/Launcher.kt', 'package store\nfun launch() = save(title = "Dune")\n');
  project.change('function save(book: Text) returns Text', { 'save.title': 'save.book' });
  await project.updateContracts();
  project.expectFileContains('src/main/kotlin/store/save.kt', 'fun save(book: String): String');
  project.expectFileContains('src/main/kotlin/store/save.kt', 'return book');
  project.expectFileText('src/main/kotlin/store/Launcher.kt', 'package store\nfun launch() = save(book = "Dune")\n');
  await project.runConsumer('fun main() { println(store.launch()) }');
  project.expectStdout('Dune');
}, 120_000);

it('renames an error family together with its data and exception companions', async () => {
  const project = await KotlinDelivery.create();
  project.source('error type Rejected { code: "rejected"\ndetail: Text }');
  await project.buildContracts();
  await project.file('src/main/kotlin/store/Launcher.kt', 'package store\nfun failure() = RejectedException(Rejected(RejectedCode.Rejected, "Dune"))\n');
  project.change('error type Denied { code: "rejected"\ndetail: Text }', { Rejected: 'Denied' });
  await project.updateContracts();
  project.expectMissingFile('src/main/kotlin/store/Rejected.kt');
  project.expectFileText('src/main/kotlin/store/Launcher.kt', 'package store\nfun failure() = DeniedException(Denied(DeniedCode.Rejected, "Dune"))\n');
  await project.runConsumer('fun main() { println(store.failure().details.detail) }');
  project.expectStdout('Dune');
}, 120_000);

it('retires an unchanged class and its members without overlapping their removals', async () => {
  const project = await KotlinDelivery.create();
  project.source('class OldGame { public save\ncapability save(title: Text) returns Nothing }\nclass Kept {}');
  await project.buildContracts();
  project.change('class Kept {}', {}, ['OldGame', 'OldGame.save', 'OldGame.save.title']);
  await project.updateContracts();
  project.expectFileMissingText('src/main/kotlin/store/OldGame.kt', 'class OldGame');
  project.expectFileContains('src/main/kotlin/store/Kept.kt', 'class Kept');
  await project.runConsumer('fun main() { println(store.Kept()::class.simpleName) }');
  project.expectStdout('Kept');
}, 120_000);
