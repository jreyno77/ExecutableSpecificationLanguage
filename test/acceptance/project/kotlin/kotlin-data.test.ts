import { it } from 'vitest';
import { KotlinAcceptance } from '../../../dsl/project/kotlin/kotlin-acceptance.js';

it('compares declared nested book data and identifies a wrong copies field', async () => {
  const project = await KotlinAcceptance.connect();
  project.source(`type Book { title: Text
 copies: Number }
function books() returns List<Book>
examples { example "two available books": books() => [{ title: "Dune", copies: 1 }, { title: "Hyperion", copies: 2 }] }`);
  await project.buildContracts();
  await project.implement('books', 'return mutableListOf(Book("Dune", 1.0), Book("Hyperion", 2.0))');
  await project.buildAcceptance();
  await project.runTests(); project.expectTests(1, 0);
  await project.implement('books', 'return mutableListOf(Book("Dune", 1.0), Book("Hyperion", 3.0))');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value[1].copies');
  project.expectFailure('expected: <2.0> but was: <3.0>');
}, 180_000);

it('does not delegate record equality to handwritten equals', async () => {
  const project = await KotlinAcceptance.connect();
  project.source(`type Book { title: Text
copies: Number }
function loadBook() returns Book
examples { example "one Dune": loadBook() => { title: "Dune", copies: 1 } }`);
  await project.buildContracts();
  await project.nativeFile('src/main/kotlin/store/Book.kt', `package store
 data class Book(var title: String, var copies: Double) {
  override fun equals(other: Any?): Boolean = error("Application equals must not run")
 }`);
  await project.implement('loadBook', 'return Book("Dune", 1.0)');
  await project.buildAcceptance();
  await project.runTests(); project.expectTests(1, 0);
}, 120_000);

it('rejects a custom collection before invoking its iteration or size code', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('function numbers() returns List<Number>\nexamples { example "empty numbers": numbers() => [] }');
  await project.buildContracts();
  await project.implement('numbers', `return object : AbstractMutableList<Double>() {
    override val size: Int get() = error("Collection iteration must not run")
    override fun get(index: Int): Double = error("Collection iteration must not run")
    override fun add(index: Int, element: Double) { error("Collection mutation must not run") }
    override fun removeAt(index: Int): Double = error("Collection mutation must not run")
    override fun set(index: Int, element: Double): Double = error("Collection mutation must not run")
  }`);
  await project.buildAcceptance();
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('expected ordinary List data');
  project.expectNoFailure('Collection iteration must not run');
}, 120_000);

it('rejects nonfinite Number data instead of treating matching NaN as equality', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('function number() returns Number\nexamples { example "finite one": number() => 1 }');
  await project.buildContracts(); await project.implement('number', 'return Double.NaN');
  await project.buildAcceptance();
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('expected finite Number data');
}, 120_000);
