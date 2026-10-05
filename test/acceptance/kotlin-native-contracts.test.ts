import { afterEach, it } from 'vitest';
import { KotlinDelivery } from '../dsl/kotlin-delivery.js';

afterEach(() => KotlinDelivery.dispose());

it('constructs independent empty records without inventing native fields', async () => {
  const project = await KotlinDelivery.create();
  project.source('type Empty {}');
  await project.buildContracts();
  await project.runConsumer('import store.Empty\nfun main() { val first = Empty(); val second = Empty(); println("distinct=" + (first !== second)); println("fields=" + Empty::class.java.declaredFields.joinToString { it.name }) }');
  project.expectStdout('distinct=true\nfields=');
}, 60_000);

it('maps an external declaration to a real installed Kotlin library', async () => {
  const project = await KotlinDelivery.newProject();
  await project.prepareKotlin(); await project.acceptStarter();
  project.external('books', 'type Book { title: Text }');
  project.source('use Book from "books"\nfunction save(book: Book) returns Nothing');
  await project.installLocalLibrary('catalog:books', '1.0.0', 'data class Book(var title: String)', 'catalog');
  project.options({ imports: [{ module: 'books', declaration: ['Book'], name: 'catalog.Book' }] });
  await project.buildContracts();
  project.expectFileContains('src/main/kotlin/store/save.kt', 'fun save(book: Book): Unit');
  project.expectMissingFile('src/main/kotlin/store/Book.kt');
  await project.compileConsumer('fun consume() { store.save(catalog.Book("Dune")) }');
  project.expectNativeCompilationPassed();
}, 240_000);
