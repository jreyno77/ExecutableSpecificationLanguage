import { afterEach, describe, it } from 'vitest';
import { KotlinDelivery } from '../dsl/kotlin-delivery.js';

afterEach(() => KotlinDelivery.dispose());
describe('a Kotlin consumer can use the specified contracts', () => {
  it('builds StoreGame and its reusable snapshot types', async () => {
    const project = await KotlinDelivery.create();
    project.source(`type Pair<T> = [T, T]
type ShoppingCart { itemsCount: Number }
type PlayerStateSnapshot { characterPosition: Pair<Number>\nshoppingCart: ShoppingCart }
class StoreGame {
  depends on PlayerStateSnapshot
  public save
  capability save(snapshot: PlayerStateSnapshot) returns Nothing
}`);
    await project.buildContracts();
    await project.compileConsumer(`import store.*
fun consume(game: StoreGame) { game.save(PlayerStateSnapshot(Tuple2(0.0, 0.0), ShoppingCart(0.0))) }`);
    project.expectNativeCompilationPassed();
    await project.runConsumer(`import store.*
fun main() { StoreGame().save(PlayerStateSnapshot(Tuple2(0.0, 0.0), ShoppingCart(0.0))) }`);
    project.expectUnimplemented('StoreGame.save');
  }, 60_000);

  it('retains explicit interfaces and successful result signatures', async () => {
    const project = await KotlinDelivery.create();
    project.source('interface Catalog { public title\ncapability title() returns Text }');
    await project.buildContracts();
    await project.runConsumer(`import store.Catalog
class Books : Catalog { override fun title(): String = "Dune" }
fun main() { println(Books().title()) }`);
    project.expectStdout('Dune');
  }, 30_000);

  it('does not widen a finite operating-system contract to String', async () => {
    const project = await KotlinDelivery.create();
    project.source('type OS = "windows" | "linux"\ntype SystemConfig { os: OS }');
    await project.buildContracts();
    await project.compileConsumer('import store.*\nval config = SystemConfig("plan9")');
    project.expectNativeCompilationFailedAt('"plan9"');
    await project.compileConsumer('import store.*\nval config = SystemConfig(OS.Windows)');
    project.expectNativeCompilationPassed();
  }, 60_000);

  it('rejects a tuple with the wrong element type', async () => {
    const project = await KotlinDelivery.create();
    project.source('type Position = [Number, Number]\ntype Snapshot { position: Position }');
    await project.buildContracts();
    await project.compileConsumer('import store.*\nval state = Snapshot(Tuple2(0.0, "north"))');
    project.expectNativeCompilationFailedAt('"north"');
  }, 30_000);

  it('finds a real native caller absent from the specification', async () => {
    const project = await KotlinDelivery.create();
    project.source('class StoreGame {}');
    await project.buildContracts();
    await project.file('src/main/kotlin/store/Launcher.kt', 'package store\nfun launch() = StoreGame()\n');
    await project.search('StoreGame');
    project.expectIncomingCall('src/main/kotlin/store/Launcher.kt', 29, 38);
  }, 30_000);

  it('selects the declared overload and retains an unrelated same-named member', async () => {
    const project = await KotlinDelivery.create();
    project.source('class StoreGame { public save\ncapability save(title: Text) returns Text }');
    await project.buildContracts();
    await project.file('src/main/kotlin/store/StoreGame.kt', `package store
class StoreGame {
    fun save(title: String): String = title
    fun save(count: Int): Int = count
}`);
    await project.file('src/main/kotlin/store/Launcher.kt', 'package store\nfun launch(game: StoreGame) = game.save("Dune")\n');
    await project.search('StoreGame.save');
    project.expectIncomingCall('src/main/kotlin/store/Launcher.kt', 49, 53);
  }, 60_000);

  it('retains a generic domain failure without an illegal generic exception', async () => {
    const project = await KotlinDelivery.create();
    project.source(`error type Rejected<T> { code: "rejected"\ndetail: T }
function save(title: Text) returns Nothing fails with Rejected<Text>`);
    await project.buildContracts();
    await project.runConsumer(`import store.*
fun main() {
    try { throw RejectedException(Rejected(RejectedCode.Rejected, "Dune")) }
    catch (failure: RejectedException) { println(failure.details.code.value + ":" + failure.details.detail) }
}`);
    project.expectStdout('rejected:Dune');
  }, 60_000);
});
