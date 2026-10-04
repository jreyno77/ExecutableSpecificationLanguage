import { afterEach, it } from 'vitest';
import { KotlinDelivery } from '../dsl/kotlin-delivery.js';
afterEach(() => KotlinDelivery.dispose());

it('checks singleton text, boolean and number values at native construction', async () => {
  const project = await KotlinDelivery.create();
  project.source('type Title = "Dune"\ntype Enabled = true\ntype Copies = 1');
  await project.buildContracts();
  await project.runConsumer(`import store.*
fun main() {
    println(Title("Dune").value + ":" + Enabled(true).value + ":" + Copies(1.0).value)
    val refused = listOf<() -> Unit>({ Title("Other") }, { Enabled(false) }, { Copies(2.0) }, { Copies(Double.NaN) })
        .count { attempt -> try { attempt(); false } catch (error: IllegalArgumentException) { true } }
    println("refused=$refused")
}`);
  project.expectStdout('Dune:true:1.0\nrefused=4');
}, 90_000);

it('constructs and exhaustively matches the actual alternatives of a tagged union', async () => {
  const project = await KotlinDelivery.create();
  project.source('type TextOrNumber = Text | Number');
  await project.buildContracts();
  await project.runConsumer(`import store.*
fun display(value: TextOrNumber): String = when (value) {
    is TextOrNumber.Text -> value.value
    is TextOrNumber.Number -> value.value.toString()
}
fun main() { println(display(TextOrNumber.Text("Dune"))); println(display(TextOrNumber.Number(2.0))) }`);
  project.expectStdout('Dune\n2.0');
  await project.compileConsumer('import store.*\nval value = TextOrNumber.Number("two")');
  project.expectNativeCompilationFailedAt('"two"');
}, 90_000);

it('refuses to choose between overlapping union alternatives', async () => {
  const project = await KotlinDelivery.create();
  project.source('type Choice = Text | "Dune"');
  await project.planContracts();
  project.expectProblem('ambiguous-native-union');
  project.expectNoWritePlan();
}, 30_000);

it('does not round an authored integer into a different Double restriction', async () => {
  const project = await KotlinDelivery.create();
  project.source('type Count = 9007199254740993');
  await project.planContracts();
  project.expectProblemAt('unsupported-number', 1, 14);
  project.expectNoWritePlan();
}, 30_000);

it('does not turn an authored finite small number into zero', async () => {
  const project = await KotlinDelivery.create();
  project.source('type Small = 1e-400');
  await project.planContracts();
  project.expectProblemAt('unsupported-number', 1, 14);
  project.expectNoWritePlan();
}, 30_000);

it('does not emit an infinite native numeric restriction', async () => {
  const project = await KotlinDelivery.create();
  project.source('type Large = 1e309');
  await project.planContracts();
  project.expectProblemAt('unsupported-number', 1, 14);
  project.expectNoWritePlan();
}, 30_000);

it('retains anonymous property restrictions through readable native wrapper names', async () => {
  const project = await KotlinDelivery.create();
  project.source('type Book { title: "Dune"\nreference: Text | Number }');
  await project.buildContracts();
  await project.runConsumer(`import store.*
fun main() {
    val book = Book(BookTitle("Dune"), BookReference.Number(2.0))
    println(book.title.value)
    println((book.reference as BookReference.Number).value)
}`);
  project.expectStdout('Dune\n2.0');
}, 90_000);

it('reports an anonymous restriction name collision at its source field', async () => {
  const project = await KotlinDelivery.create();
  project.source('type BookTitle = Text\ntype Book { title: "Dune" }');
  await project.planContracts();
  project.expectProblemAt('native-name-conflict', 2, 13);
  project.expectNoWritePlan();
}, 30_000);

it('keeps primitive meanings when native declarations reuse Kotlin builtin names', async () => {
  const project = await KotlinDelivery.create();
  project.source('type String { value: Number }\ntype Book { title: Text }');
  await project.buildContracts();
  await project.runConsumer('fun main() { println(store.Book("Dune").title) }');
  project.expectStdout('Dune');
}, 90_000);

it('keeps a generic record alternative typed in a sealed union', async () => {
  const project = await KotlinDelivery.create();
  project.source('type Box<T> { value: T }\ntype Choice<T> = Box<T> | Text');
  await project.buildContracts();
  await project.runConsumer(`import store.*
fun main() {
    val choice: Choice<Double> = Choice.Box(Box(2.0))
    val text: Choice<Double> = Choice.Text("Dune")
    println((choice as Choice.Box).value.value)
    println((text as Choice.Text).value)
}`);
  project.expectStdout('2.0\nDune');
}, 90_000);

it('gives different anonymous tuple elements distinct checked native wrappers', async () => {
  const project = await KotlinDelivery.create();
  project.source('type Pair = ["Dune", 1]\ntype Book { titles: List<"Dune"> }');
  await project.buildContracts();
  await project.runConsumer(`import store.*
fun main() {
    val pair: Pair = Tuple2(PairValueItem1("Dune"), PairValueItem2(1.0))
    val book = Book(mutableListOf(BookTitlesElement("Dune")))
    println(pair.item1.value + ":" + pair.item2.value + ":" + book.titles[0].value)
}`);
  project.expectStdout('Dune:1.0:Dune');
}, 90_000);

it('keeps Text independent of a generic parameter named String', async () => {
  const project = await KotlinDelivery.create();
  project.source('type Shelf<String> { title: Text }');
  await project.buildContracts();
  await project.runConsumer('fun main() { println(store.Shelf<Int>("Dune").title) }');
  project.expectStdout('Dune');
}, 90_000);

it('retains generic arity while admitting a declared operating-system value', async () => {
  const project = await KotlinDelivery.create();
  project.source('type OS<T> = "windows" | "linux"');
  await project.buildContracts();
  await project.runConsumer('fun main() { println(store.OS<Double>("windows").value) }');
  project.expectStdout('windows');
}, 90_000);

it('refuses a string outside a generic finite text restriction', async () => {
  const project = await KotlinDelivery.create();
  project.source('type OS<T> = "windows" | "linux"');
  await project.buildContracts();
  await project.runConsumer('fun main() { try { store.OS<Double>("plan9"); println("accepted") } catch (error: IllegalArgumentException) { println("rejected") } }');
  project.expectStdout('rejected');
}, 90_000);

it('does not erase a generic restriction argument during native assignment', async () => {
  const project = await KotlinDelivery.create();
  project.source('type OS<T> = "windows" | "linux"');
  await project.buildContracts();
  await project.compileConsumer('val value: store.OS<String> = store.OS<String>("windows")');
  project.expectNativeCompilationPassed();
  await project.compileConsumer('val value: store.OS<String> = store.OS<Double>("windows")');
  project.expectNativeCompilationFailedAt('OS<Double>');
}, 90_000);

it('carries the enclosing record parameter into its anonymous union companion', async () => {
  const project = await KotlinDelivery.create();
  project.source('type Box<T> { value: T }\ntype Shelf<T> { item: Box<T> | Text }');
  await project.buildContracts();
  await project.runConsumer('fun main() { val shelf: store.Shelf<Double> = store.Shelf(store.ShelfItem.Box(store.Box(2.0))); println((shelf.item as store.ShelfItem.Box).value.value) }');
  project.expectStdout('2.0');
}, 90_000);
