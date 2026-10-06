import { it } from 'vitest';
import { KotlinAcceptance } from '../../../dsl/project/kotlin/kotlin-acceptance.js';

it('refuses to compare a handwritten getter instead of executing it', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Book { title: Text\ncopies: Number }\nfunction loadBook() returns Book\nexamples { example "one Dune": loadBook() => { title: "Dune", copies: 1 } }');
  await project.buildContracts();
  await project.nativeFile('src/main/kotlin/store/Book.kt', `package store
class Book(var title: String, copies: Double) {
  var copies: Double = copies
    get() { println("APPLICATION_GETTER_EXECUTED"); error("A getter is not stored data") }
}`);
  await project.implement('loadBook', 'return Book("Dune", 1.0)');
  await project.expectAcceptanceRefused('unsupported-comparison-data');
}, 180_000);

it('refuses an application getter that could hide a wrong stored quantity', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Book { title: Text\ncopies: Number }\nfunction loadBook() returns Book\nexamples { example "one Dune": loadBook() => { title: "Dune", copies: 1 } }');
  await project.buildContracts();
  await project.nativeFile('src/main/kotlin/store/Book.kt', `package store
class Book(var title: String, copies: Double) {
  var copies: Double = copies
    get() { println("APPLICATION_GETTER_EXECUTED"); return 1.0 }
}`);
  await project.implement('loadBook', 'return Book("Dune", 2.0)');
  await project.expectAcceptanceRefused('unsupported-comparison-data');
}, 180_000);

it('refuses a computed-only property without invoking its application getter', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Book { title: Text\ncopies: Number }\nfunction loadBook() returns Book\nexamples { example "one Dune": loadBook() => { title: "Dune", copies: 1 } }');
  await project.buildContracts();
  await project.nativeFile('src/main/kotlin/store/Book.kt', `package store
class Book(var title: String, copies: Double) {
  var copies: Double
    get() { println("APPLICATION_GETTER_EXECUTED"); return 1.0 }
    set(value) {}
}`);
  await project.implement('loadBook', 'return Book("Dune", 1.0)');
  await project.expectAcceptanceRefused('unsupported-comparison-data');
}, 180_000);

it('refuses to construct authored expected data through an application initializer', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Book { title: Text\ncopies: Number }\nfunction loadBook() returns Book\nexamples { example "one Dune": loadBook() => { title: "Dune", copies: 1 } }');
  await project.buildContracts();
  await project.nativeFile('src/main/kotlin/store/Book.kt', `package store
data class Book(var title: String, var copies: Double) {
  init { copies = 2.0; println("APPLICATION_CONSTRUCTOR_EXECUTED") }
}`);
  await project.implement('loadBook', 'return Book("Dune", 1.0)');
  await project.expectAcceptanceRefused('unsupported-fixture-data');
}, 180_000);


it('observes ordinary data already produced by an application constructor', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Book { title: Text\ncopies: Number }\nfunction loadBook() returns Book\nexamples { example "stored copies": loadBook().copies => 2 }');
  await project.buildContracts();
  await project.nativeFile('src/main/kotlin/store/Book.kt', `package store
data class Book(var title: String, var copies: Double) {
  init { copies = 2.0; println("APPLICATION_CONSTRUCTOR_EXECUTED") }
}`);
  await project.implement('loadBook', 'return Book("Dune", 1.0)');
  await project.buildAcceptance();
  await project.runTests(); project.expectTests(1, 0);
  project.expectRuntimeLines('APPLICATION_CONSTRUCTOR_EXECUTED', 1);
}, 180_000);

it('refuses an implicitly overridable property before a subclass getter can redefine data', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Book { title: Text\ncopies: Number }\nfunction loadBook() returns Book\nexamples { example "one Dune": loadBook().copies => 1 }');
  await project.buildContracts();
  await project.nativeFile('src/main/kotlin/store/Book.kt', `package store
interface Counts { var copies: Double }
open class Book(var title: String, override var copies: Double): Counts
class HiddenBook: Book("Dune", 2.0) {
  override var copies: Double
    get() { println("SUBCLASS_GETTER_EXECUTED"); return 1.0 }
    set(value) {}
}`);
  await project.implement('loadBook', 'return HiddenBook()');
  await project.expectAcceptanceRefused('unsupported-comparison-data');
}, 180_000);
