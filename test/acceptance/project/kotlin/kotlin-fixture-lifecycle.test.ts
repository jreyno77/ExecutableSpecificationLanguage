import { it } from 'vitest';
import { KotlinAcceptance } from '../../../dsl/project/kotlin/kotlin-acceptance.js';

it('adopts a handwritten native fixture after the default scaffold and closes its resource', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one available Dune": quantity("Dune") => 1 }');
  await project.buildAcceptance();
  await project.implementDriver(`package store.tests.driver
class ShoppingDriver(private val server: java.net.ServerSocket? = null) {
  private val inventory = mapOf("Dune" to 1.0)
  fun quantity(title: String): Double { check(server?.isClosed == false); return inventory[title] ?: 0.0 }
}`);
  const fixture = 'src/test/kotlin/store/tests/dsl/ConnectedShopping.kt';
  await project.nativeFile(fixture, `package store.tests.dsl
// Handwritten resource lifetime stays here. 🛒
open class ConnectedShopping {
  private var server: java.net.ServerSocket? = null
  protected lateinit var shopping: Shopping
  @org.junit.jupiter.api.BeforeEach fun connect() {
    server = java.net.ServerSocket(0, 50, java.net.InetAddress.getLoopbackAddress())
    shopping = Shopping(store.tests.driver.ShoppingDriver(server))
  }
  @org.junit.jupiter.api.AfterEach fun disconnect() {
    server!!.close()
    println("RESOURCE_CLOSED=" + server!!.isClosed)
  }
}`);
  await project.addTestMember('  // A handwritten neighbor must survive fixture migration. 🛒\n  fun handwrittenNeighbor(): String = "keep me"');
  await project.rememberFile(fixture);
  await project.rememberFile('src/test/kotlin/store/tests/driver/ShoppingDriver.kt');
  project.selectFixture(fixture, 'ConnectedShopping');
  await project.updateAcceptance();
  project.expectVisibleSteps(['class ShoppingAcceptance : store.tests.dsl.ConnectedShopping()', 'fun handwrittenNeighbor(): String = "keep me"', '// A handwritten neighbor must survive fixture migration. 🛒']);
  await project.expectFileUnchanged(fixture);
  await project.expectFileUnchanged('src/test/kotlin/store/tests/driver/ShoppingDriver.kt');
  await project.runTests(); project.expectTests(1, 0);
  project.expectRuntimeOutput('RESOURCE_CLOSED=true');
  await project.readGroup();
  project.expectReadContains('// Handwritten resource lifetime stays here. 🛒');
}, 180_000);

it('closes a resource acquired before setup fails without executing the application', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('function save() returns Nothing\nexamples { scenario "save" { when save()\n then true } }');
  await project.buildContracts();
  await project.implement('save', 'println("APPLICATION_ACTION_EXECUTED")');
  await project.resourceFixture('setup failed');
  await project.buildAcceptance();
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('setup failed');
  project.expectNoRuntimeOutput('APPLICATION_ACTION_EXECUTED');
  project.expectRuntimeOutput('RESOURCE_CLOSED=true');
}, 180_000);

it('retains both an actual assertion failure and a native cleanup failure', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('function quantity() returns Number\nexamples { example "one Dune": quantity() => 1 }');
  await project.buildContracts(); await project.implement('quantity', 'return 2.0');
  await project.resourceFixture(undefined, 'cleanup failed');
  await project.buildAcceptance();
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('expected: <1.0> but was: <2.0>');
  project.expectFailure('cleanup failed');
  project.expectRuntimeOutput('RESOURCE_CLOSED=true');
}, 180_000);

it('refuses fixture migration when an owned expectation has been erased', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  await project.buildAcceptance();
  const testFile = 'src/test/kotlin/store/tests/acceptance/ShoppingAcceptance.kt';
  await project.nativeFile(testFile, `package store.tests.acceptance
class ShoppingAcceptance : store.tests.dsl.ShoppingFixture() {
  @org.junit.jupiter.api.Test fun oneDune() {}
}`);
  await project.nativeFile('src/test/kotlin/store/tests/dsl/OtherFixture.kt', `package store.tests.dsl
open class OtherFixture {
  protected val shopping = Shopping(store.tests.driver.ShoppingDriver())
}`);
  await project.rememberFile(testFile);
  project.selectFixture('src/test/kotlin/store/tests/dsl/OtherFixture.kt', 'OtherFixture');
  await project.expectAcceptanceRefused('output-conflict');
  await project.expectFileUnchanged(testFile);
}, 180_000);

it('protects owned expectations when a parent folder is named driver', async () => {
  const project = await KotlinAcceptance.connect();
  project.testRoot('src/test/kotlin/driver/custom');
  project.source('examples { observation quantity(title: Text) returns Number\nexample "one Dune": quantity("Dune") => 1 }');
  await project.buildAcceptance();
  const testFile = 'src/test/kotlin/driver/custom/store/tests/acceptance/ShoppingAcceptance.kt';
  await project.nativeFile(testFile, `package store.tests.acceptance
class ShoppingAcceptance : store.tests.dsl.ShoppingFixture() {
  @org.junit.jupiter.api.Test fun oneDune() {}
}`);
  const fixture = 'src/test/kotlin/driver/custom/store/tests/dsl/OtherFixture.kt';
  await project.nativeFile(fixture, `package store.tests.dsl
open class OtherFixture {
  protected val shopping = Shopping(store.tests.driver.ShoppingDriver())
}`);
  await project.rememberFile(testFile);
  project.selectFixture(fixture, 'OtherFixture');
  await project.expectAcceptanceRefused('output-conflict');
  await project.expectFileUnchanged(testFile);
}, 180_000);
