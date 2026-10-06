import { afterEach, describe, it } from 'vitest';
import { PythonFixtures } from '../../../dsl/project/python/python-fixture.js';

afterEach(() => PythonFixtures.dispose(), 30_000);

describe('pytest owns the real selected resource fixture', { timeout: 240_000 }, () => {
  it('adopts a native resource fixture and releases its real socket', async () => {
    const p = await PythonFixtures.shopping(); await p.useResourceFixture();
    await p.generateTests(); await p.runTests(); p.expectPassed();
    await p.expectSocketClosedAndRebindable(); await p.expectFixtureUnchanged();
  });
  it('retains both setup and cleanup failures after acquiring a resource', async () => {
    const p = await PythonFixtures.shopping(); await p.useResourceFixture({ finalizer: true, setupFails: true, cleanupFails: true });
    await p.generateTests(); await p.runTests(); p.expectFailedDuring(['setup', 'teardown'], false);
    await p.expectSocketClosedAndRebindable(); await p.expectFixtureUnchanged();
  });
  it('fails the native test when its call passed but cleanup failed', async () => {
    const p = await PythonFixtures.shopping(); await p.useResourceFixture({ cleanupFails: true });
    await p.generateTests(); await p.runTests(); p.expectFailedDuring(['teardown'], true);
    await p.expectSocketClosedAndRebindable();
  });
  it('rejects unsupported async fixtures before writing a test', async () => {
    const p = await PythonFixtures.shopping(); await p.useResourceFixture({ async: true });
    await p.expectGenerationRefused('unsupported-native-async'); await p.expectFixtureUnchanged();
  });
  it('keeps an explicit fixture name and lets it construct the configured driver', async () => {
    const p = await PythonFixtures.shopping(); await p.useResourceFixture({ name: 'basket', requiredConstructor: true });
    await p.generateTests(); p.expectFixtureName('basket'); await p.runTests(); p.expectPassed();
    await p.expectFixtureUnchanged(); await p.expectSocketClosedAndRebindable();
  });
  it('refuses a fixture that declares the wrong supplied value', async () => {
    const p = await PythonFixtures.shopping(); await p.useResourceFixture({ result: 'str' });
    await p.expectGenerationRefused('incompatible-native-fixture');
  });
  it('does not certify an unknown fixture value', async () => {
    const p = await PythonFixtures.shopping(); await p.useResourceFixture({ result: 'Any' });
    await p.expectGenerationRefused('incompatible-native-fixture');
  });
  it('does not claim fresh per-scenario state for a module fixture', async () => {
    const p = await PythonFixtures.shopping(); await p.useResourceFixture({ scope: 'module' });
    await p.expectGenerationRefused('unsupported-native-fixture');
  });
});
