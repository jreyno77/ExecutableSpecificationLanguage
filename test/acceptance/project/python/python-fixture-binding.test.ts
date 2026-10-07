import { afterEach, describe, it } from 'vitest';
import { PythonFixtures } from '../../../dsl/project/python/python-fixture.js';

afterEach(() => PythonFixtures.dispose(), 30_000);

describe('a selected pytest fixture reaches the actual generated DSL', { timeout: 240_000 }, () => {
  it('refuses a project module that hides the generated assertions', async () => {
    const p = await PythonFixtures.shopping(); await p.useResourceFixture(); await p.shadowDsl();
    await p.expectGenerationRefused('invalid-native-mapping'); await p.expectFixtureUnchanged();
  });
  it('does not accept a same-spelled local function as the pytest decorator', async () => {
    const p = await PythonFixtures.shopping(); await p.useResourceFixture(); await p.replaceFixtureDecorator();
    await p.expectGenerationRefused('invalid-native-fixture'); await p.expectFixtureUnchanged();
  });
  it('refuses the fixture name reserved by native pytest', async () => {
    const p = await PythonFixtures.shopping(); await p.useResourceFixture({ name: 'request' });
    await p.expectGenerationRefused('invalid-native-fixture'); await p.expectFixtureUnchanged();
  });
});
