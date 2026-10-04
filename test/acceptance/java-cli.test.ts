import { afterEach, beforeAll, describe, it } from 'vitest';
import { JavaCommands } from '../dsl/java-cli.js';

beforeAll(() => JavaCommands.prepare(), 120_000);
afterEach(() => JavaCommands.dispose());
describe('Java follows the ordinary connected CLI workflow', { timeout: 300_000 }, () => {
  it('requires an explicitly available JDK before writing a starter', async () => {
    const p = await JavaCommands.create(); await p.source('class StoreGame {}');
    await p.initialize('/missing/expec-jdk-21');
    p.expectProblem('native-toolchain-unavailable'); await p.expectNoProject();
  });
  it('initializes Java files and exact native requirements without acquiring or generating tests', async () => {
    const p = await JavaCommands.create(); await p.source('class StoreGame {}');
    await p.initialize(); p.expectStatus('initialized'); await p.expectStarterOnly();
  });
  it('installs the native catalog graph and preserves its lock and handwritten build on repeat', async () => {
    const p = await JavaCommands.create(); await p.source('class StoreGame {}');
    await p.initialize(); p.expectStatus('initialized'); await p.catalog(); await p.requireCatalog();
    await p.install(); p.expectStatus('installed'); await p.expectCatalogInstalled(); await p.rememberLock();
    await p.install(); p.expectStatus('installed'); await p.expectSameNativeBuild();
  });
  it('keeps failed native installation effects visible and refuses stale availability', async () => {
    const p = await JavaCommands.create(); await p.source('class StoreGame {}');
    await p.initialize(); p.expectStatus('initialized'); await p.catalog(); await p.requireCatalog(); await p.install(); p.expectStatus('installed');
    await p.requireCatalog('9.9.9'); await p.install(); p.expectInstallationStopped();
    await p.build(); p.expectProblem('install-required');
  });
  it('builds Dune tests after contracts and executes the actual correct and wrong baskets', async () => {
    const p = await JavaCommands.create();
    await p.source('class StoreGame { public save\ncapability save(title: Text) returns Nothing }\nexamples { setup available(title: Text)\naction add(title: Text)\nobservation quantity(title: Text) returns Number\ncheck expectBookQuantity(title: Text, expected: Number) { assert quantity(title) == expected }\nscenario "a shopper adds Dune" { given available("Dune")\nwhen add("Dune")\nthen expectBookQuantity("Dune", 1) } }');
    await p.initialize(); p.expectStatus('initialized'); await p.install(); p.expectStatus('installed');
    await p.build(); p.expectStatus('built'); await p.implementBasket(1); await p.test(); p.expectNativeTest(true, 1);
    await p.implementBasket(2); await p.test(); p.expectNativeTest(false, 2);
  });
  it('executes locally included examples without claiming dependency-library examples', async () => {
    const p = await JavaCommands.create();
    await p.source('include "./local.expec"\ninclude "catalog"\nclass Store {}');
    await p.localSource('local.expec', 'examples { action begin() {}\ncheck data() { assert "Dune" == "Dune" }\nscenario "Local Dune" { when begin()\nthen data() } }');
    await p.sourceLibrary('catalog', 'examples { action providerBegin() {}\ncheck providerData() { assert 1 == 2 }\nscenario "Provider counterexample" { when providerBegin()\nthen providerData() } }');
    await p.initialize(); p.expectStatus('initialized'); await p.install(); p.expectStatus('installed');
    await p.build(); p.expectStatus('built'); await p.test(); p.expectExecutedTitles(['Local Dune']);
  });
});
