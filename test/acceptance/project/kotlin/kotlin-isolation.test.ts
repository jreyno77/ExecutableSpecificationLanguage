import { it } from 'vitest';
import { KotlinAcceptance } from '../../../dsl/project/kotlin/kotlin-acceptance.js';

it('isolates concurrent Dune baskets despite an inherited shared-instance fixture setting', async () => {
  const project = await KotlinAcceptance.connect();
  project.source(`examples {
    action addBook(title: Text)
    observation quantity(title: Text) returns Number
    scenario "first basket" { when addBook("Dune")\n then quantity("Dune") == 1 }
    scenario "second basket" { when addBook("Dune")\n then quantity("Dune") == 1 }
  }`);
  await project.buildAcceptance();
  await project.implementDriver(`package store.tests.driver
class ShoppingDriver(private val server: java.net.ServerSocket? = null) {
  private val basket = java.util.concurrent.ConcurrentHashMap<String, Double>()
  fun addBook(title: String) { basket.merge(title, 1.0) { first, next -> first + next } }
  fun quantity(title: String): Double {
    check(server?.isClosed == false)
    ready.countDown()
    check(ready.await(20, java.util.concurrent.TimeUnit.SECONDS)) { "Both native scenarios must run concurrently" }
    val actual = basket[title] ?: 0.0
    println("QUANTITY=" + actual)
    return actual
  }
  companion object { private val ready = java.util.concurrent.CountDownLatch(2) }
}`);
  const fixture = 'src/test/kotlin/store/tests/dsl/ConcurrentShopping.kt';
  await project.nativeFile(fixture, `package store.tests.dsl
@org.junit.jupiter.api.TestInstance(org.junit.jupiter.api.TestInstance.Lifecycle.PER_CLASS)
@org.junit.jupiter.api.parallel.Execution(org.junit.jupiter.api.parallel.ExecutionMode.CONCURRENT)
open class ConcurrentShopping {
  private val server = java.net.ServerSocket(0, 50, java.net.InetAddress.getLoopbackAddress())
  protected val shopping = Shopping(store.tests.driver.ShoppingDriver(server))
  @org.junit.jupiter.api.BeforeEach fun resource() { println("RESOURCE_PORT=" + server.localPort) }
  @org.junit.jupiter.api.AfterEach fun close() {
    server.close()
    println("RESOURCE_CLOSED=" + server.isClosed)
  }
}`);
  project.selectFixture(fixture, 'ConcurrentShopping');
  await project.updateAcceptance();
  await project.runTests(true);
  project.expectTests(2, 0);
  project.expectRuntimeLines('QUANTITY=1.0', 2);
  project.expectDistinctResources(2);
  project.expectRuntimeLines('RESOURCE_CLOSED=true', 2);
}, 180_000);

it('refuses changing the owned per-method test lifecycle to shared state', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { example "one": 1 => 1 }');
  await project.buildAcceptance();
  const testFile = 'src/test/kotlin/store/tests/acceptance/ShoppingAcceptance.kt';
  await project.replaceNativeText(testFile, 'Lifecycle.PER_METHOD', 'Lifecycle.PER_CLASS');
  await project.rememberFile(testFile);
  await project.expectAcceptanceRefused('output-conflict');
  await project.expectFileUnchanged(testFile);
}, 180_000);
