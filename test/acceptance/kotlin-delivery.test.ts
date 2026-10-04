import { afterEach, describe, it } from 'vitest';
import { KotlinDelivery } from '../dsl/kotlin-delivery.js';

afterEach(() => KotlinDelivery.dispose());
describe('a Kotlin consumer can use the specified contracts', () => {
  it('keeps actual runtime-only dependencies unavailable to compilation', async () => {
    const project = await KotlinDelivery.newProject();
    await project.prepareKotlin();
    await project.acceptStarter();
    await project.appendBuildConfiguration('dependencies { runtimeOnly("org.junit.jupiter:junit-jupiter-api:6.1.3") }');
    await project.installDependencies();
    await project.compileConsumer('import org.junit.jupiter.api.Test\nfun consume(value: Test) {}');
    project.expectNativeCompilationFailedAt("unresolved reference 'Test'");
    await project.runConsumer('fun main() { println(Class.forName("org.junit.jupiter.api.Test").name) }');
    project.expectStdout('org.junit.jupiter.api.Test');
  }, 240_000);

  it('reads stale build inputs without evaluating their new configuration', async () => {
    const project = await KotlinDelivery.newProject();
    await project.prepareKotlin();
    await project.acceptStarter();
    await project.installDependencies();
    await project.appendBuildConfiguration('file("read-ran.txt").writeText("configuration executed")');
    await project.attemptReadDependencies();
    project.expectDependencyFailure('native-configuration-stale');
    project.expectMissingFile('read-ran.txt');
  }, 240_000);

  it('does not retain an old successful report after a real native install fails', async () => {
    const project = await KotlinDelivery.newProject();
    await project.prepareKotlin();
    await project.acceptStarter();
    await project.installDependencies();
    await project.appendBuildConfiguration('throw GradleException("example installation failure")');
    await project.attemptInstallDependencies();
    project.expectDependencyFailure('package-install-failed');
    project.expectMissingFile('.expec/kotlin/classpath.json');
    await project.attemptReadDependencies();
    project.expectDependencyFailure('native-inputs-unavailable');
  }, 240_000);

  it('reports an unsupported applied script after its actual configuration effects', async () => {
    const project = await KotlinDelivery.newProject();
    await project.prepareKotlin();
    await project.acceptStarter();
    await project.file('build.gradle.kts', 'plugins { kotlin("jvm") version "2.4.10" }\nrepositories { mavenCentral() }\nkotlin { jvmToolchain(21) }\napply(from=".expec/kotlin/dependencies.gradle.kts")\napply(from="extra.gradle.kts")');
    await project.file('extra.gradle.kts', 'file("configured.txt").writeText("actual configuration ran")');
    await project.attemptInstallDependencies();
    project.expectInstallationRefusedAt('extra.gradle.kts');
    project.expectFileText('configured.txt', 'actual configuration ran');
    project.expectMissingFile('.expec/kotlin/classpath.json');
  }, 240_000);

  it('keeps a real Java consumer visible as unsupported native coverage', async () => {
    const project = await KotlinDelivery.newProject();
    await project.prepareKotlin();
    await project.acceptStarter();
    await project.installDependencies();
    await project.file('src/main/java/store/Caller.java', 'package store; public class Caller { public String title() { return "Dune"; } }');
    await project.expectNativeCaptureRefusedAt('src/main/java/store/Caller.java');
  }, 240_000);

  it('installs the starter requirements and uses their actual native classpath', async () => {
    const project = await KotlinDelivery.newProject();
    await project.prepareKotlin();
    await project.acceptStarter();
    await project.installDependencies();
    project.expectInstalledPackage('maven:org.jetbrains.kotlin:kotlin-stdlib', '2.4.10');
    project.expectInstalledPackage('maven:org.junit.jupiter:junit-jupiter', '6.1.3');
    project.expectInstalledPackage('maven:org.junit.platform:junit-platform-console', '6.1.3');
    project.expectInstalledPackage('maven:org.junit.platform:junit-platform-reporting', '6.1.3');
    await project.readDependencies();
    project.expectInstalledPackage('maven:org.jetbrains.kotlin:kotlin-gradle-plugin', '2.4.10');
    project.source('class StoreGame { public save\ncapability save() returns Nothing }');
    await project.buildContracts();
    await project.runConsumer('fun main() { store.StoreGame().save() }');
    project.expectUnimplemented('StoreGame.save');
  }, 240_000);

  it('previews a Kotlin starter with its exact native prerequisites before effects', async () => {
    const project = await KotlinDelivery.newProject();
    await project.prepareKotlin();
    project.expectRequiredPackages([
      { name: 'maven:org.jetbrains.kotlin:kotlin-gradle-plugin', version: '2.4.10', phases: ['build'] },
      { name: 'maven:org.jetbrains.kotlin:kotlin-stdlib', version: '2.4.10', phases: ['runtime'] },
      { name: 'maven:org.junit.jupiter:junit-jupiter', version: '6.1.3', phases: ['test'] },
      { name: 'maven:org.junit.platform:junit-platform-launcher', version: '6.1.3', phases: ['test'] },
      { name: 'maven:org.junit.platform:junit-platform-console', version: '6.1.3', phases: ['test'] },
      { name: 'maven:org.junit.platform:junit-platform-reporting', version: '6.1.3', phases: ['test'] },
    ]);
    await project.expectEmptyDestination();
  });

  it('creates the chosen Kotlin starter without an installed report or acceptance tests', async () => {
    const project = await KotlinDelivery.newProject();
    await project.prepareKotlin();
    await project.acceptStarter();
    project.expectStarterFiles(['settings.gradle.kts', 'build.gradle.kts', 'expec.kotlin.json', '.gitignore',
      'gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.jar', 'gradle/wrapper/gradle-wrapper.properties',
      '.expec/kotlin/dependencies.gradle.kts', 'src/main/kotlin/Empty.kt']);
    project.expectFileContains('build.gradle.kts', 'kotlin("jvm") version "2.4.10"');
    project.expectFileContains('build.gradle.kts', 'apply(from = ".expec/kotlin/dependencies.gradle.kts")');
  });

  it('leaves the chosen destination empty when the Kotlin starter is declined', async () => {
    const project = await KotlinDelivery.newProject();
    await project.prepareKotlin();
    await project.declineStarter();
    await project.expectEmptyDestination();
  });

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

  it('claims only the source sets actually inspected by Kotlin', async () => {
    const project = await KotlinDelivery.create();
    project.source('class StoreGame {}');
    await project.buildContracts();
    await project.file('notes/Untracked.kt', 'fun unrelated() = missing.Name()');
    await project.search('StoreGame');
    project.expectSearchScope(['src/main/kotlin/store/StoreGame.kt']);
  }, 60_000);

  it('adds a capability while retaining private state and handwritten behavior', async () => {
    const project = await KotlinDelivery.create();
    project.source('class StoreGame { public save\ncapability save() returns Nothing }');
    await project.buildContracts();
    await project.file('src/main/kotlin/store/StoreGame.kt', `package store
class StoreGame {
    private var saves = 0
    fun save(): Unit { saves += 1 }
}`);
    project.change('class StoreGame { public save, delete\ncapability save() returns Nothing\ncapability delete() returns Nothing }');
    await project.updateContracts();
    project.expectFileContains('src/main/kotlin/store/StoreGame.kt', 'private var saves = 0');
    project.expectFileContains('src/main/kotlin/store/StoreGame.kt', 'fun save(): Unit { saves += 1 }');
    await project.runConsumer('fun main() { store.StoreGame().delete() }');
    project.expectUnimplemented('StoreGame.delete');
  }, 120_000);

  it('renames only the selected capability and actual callers', async () => {
    const project = await KotlinDelivery.create();
    project.source('class StoreGame { public save\ncapability save(title: Text) returns Text }');
    await project.buildContracts();
    await project.file('src/main/kotlin/store/StoreGame.kt', `package store
class StoreGame {
    fun save(title: String): String { // Dune
        return "saved:$title"
    }
}`);
    await project.file('src/main/kotlin/store/Launcher.kt', 'package store\nfun launch(game: StoreGame) = game.save("Dune")');
    await project.file('src/main/kotlin/store/Other.kt', 'package store\nclass Other { fun save() = "other" }');
    project.change('class StoreGame { public saveGame\ncapability saveGame(title: Text) returns Text }', { 'StoreGame.save': 'StoreGame.saveGame' });
    await project.updateContracts();
    project.expectFileContains('src/main/kotlin/store/StoreGame.kt', 'fun saveGame(title: String): String { // Dune\n        return "saved:$title"');
    project.expectFileText('src/main/kotlin/store/Launcher.kt', 'package store\nfun launch(game: StoreGame) = game.saveGame("Dune")');
    project.expectFileText('src/main/kotlin/store/Other.kt', 'package store\nclass Other { fun save() = "other" }');
    await project.runConsumer('fun main() { println(store.launch(store.StoreGame())) }');
    project.expectStdout('saved:Dune');
  }, 120_000);

  it('moves an output-created file with its renamed class and bound callers', async () => {
    const project = await KotlinDelivery.create();
    project.source('class StoreGame { public save\ncapability save() returns Text }');
    await project.buildContracts();
    await project.file('src/main/kotlin/store/StoreGame.kt', 'package store\nclass StoreGame { fun save(): String { /* retained */ return "saved" } }');
    await project.file('src/main/kotlin/store/Launcher.kt', 'package store\nfun launch() = StoreGame().save()');
    project.change('class SavedGame { public save\ncapability save() returns Text }', { StoreGame: 'SavedGame' });
    await project.updateContracts();
    project.expectMissingFile('src/main/kotlin/store/StoreGame.kt');
    project.expectFileContains('src/main/kotlin/store/SavedGame.kt', '/* retained */ return "saved"');
    project.expectFileText('src/main/kotlin/store/Launcher.kt', 'package store\nfun launch() = SavedGame().save()');
    await project.runConsumer('fun main() { println(store.launch()) }');
    project.expectStdout('saved');
  }, 120_000);

  it('reads the current handwritten implementation as complete raw content', async () => {
    const project = await KotlinDelivery.create();
    project.source('class StoreGame { public save\ncapability save(title: Text) returns Text }');
    await project.buildContracts();
    await project.implement('StoreGame.save', '// preserve this note\n    return "saved:$title"');
    await project.read('StoreGame');
    project.expectReadText('// preserve this note\n    return "saved:$title"');
  }, 60_000);

  it('retires an unchanged generated stub without touching implemented neighbors', async () => {
    const project = await KotlinDelivery.create();
    project.source('class StoreGame { public save, delete\ncapability save() returns Text\ncapability delete() returns Nothing }');
    await project.buildContracts();
    await project.implement('StoreGame.save', 'return "saved"');
    project.change('class StoreGame { public save\ncapability save() returns Text }', {}, ['StoreGame.delete']);
    await project.updateContracts();
    project.expectFileMissingText('src/main/kotlin/store/StoreGame.kt', 'fun delete(');
    project.expectFileContains('src/main/kotlin/store/StoreGame.kt', 'return "saved"');
    await project.runConsumer('fun main() { println(store.StoreGame().save()) }');
    project.expectStdout('saved');
  }, 120_000);

  it('refuses to retire handwritten behavior after its contract retires', async () => {
    const project = await KotlinDelivery.create();
    project.source('class StoreGame { public save\ncapability save() returns Text }');
    await project.buildContracts();
    await project.implement('StoreGame.save', 'return "saved"');
    project.change('class StoreGame {}', {}, ['StoreGame.save']);
    await project.expectUpdateRefused('handwritten-removal');
  }, 120_000);

  it('does not make test-only declarations available to production code', async () => {
    const project = await KotlinDelivery.create();
    project.source('class StoreGame {}');
    await project.buildContracts();
    await project.file('src/test/kotlin/store/TestOnly.kt', 'package store\nclass TestOnly');
    await project.file('src/main/kotlin/store/Launcher.kt', 'package store\nfun launch() = TestOnly()');
    await project.search('StoreGame');
    project.expectIncompleteSearch('kotlin-UNRESOLVED_REFERENCE');
  }, 60_000);

  it('lets a native test use the production declarations through its real module dependency', async () => {
    const project = await KotlinDelivery.create();
    project.source('class StoreGame {}');
    await project.buildContracts();
    await project.file('src/test/kotlin/store/Example.kt', 'package store\nfun example() = StoreGame()');
    await project.search('StoreGame');
    project.expectIncomingCall('src/test/kotlin/store/Example.kt', 30, 39);
  }, 60_000);
});
