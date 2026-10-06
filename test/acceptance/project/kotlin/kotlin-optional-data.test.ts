import { it } from 'vitest';
import { KotlinAcceptance } from '../../../dsl/project/kotlin/kotlin-acceptance.js';

it('constructs present optional record, list and tuple values using their checked inner types', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Book { title: Text }\ntype Selection { book: Book?\nnumbers: List<Number>?\nposition: [Number, Number]? }\nfunction loadSelection() returns Selection\nexamples { example "present values": loadSelection() => { book: { title: "Dune" }, numbers: [1, 2], position: [0, 1] } }');
  await project.buildContracts();
  await project.implement('loadSelection', 'return Selection(Book("Dune"), mutableListOf(1.0, 2.0), Tuple2(0.0, 1.0))');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
  await project.implement('loadSelection', 'return Selection(Book("Dune"), mutableListOf(1.0, 3.0), Tuple2(0.0, 1.0))');
  await project.runTests(); project.expectTests(0, 1); project.expectFailure('value.numbers[1]');
}, 180_000);

it('retains present record data through a nullable alias used in another optional slot', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Book { title: Text }\ntype MaybeBook = Book?\nfunction loadBook() returns MaybeBook?\nexamples { example "present aliased book": loadBook() => { title: "Dune" } }');
  await project.buildContracts(); await project.implement('loadBook', 'return Book("Dune")');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
}, 180_000);
