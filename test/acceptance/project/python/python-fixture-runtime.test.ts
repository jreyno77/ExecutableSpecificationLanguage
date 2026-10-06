import { afterEach, describe, it } from 'vitest';
import { PythonFixtures } from '../../../dsl/project/python/python-fixture.js';

afterEach(() => PythonFixtures.dispose());

describe('a selected fixture cannot replace the generated assertions', { timeout: 240_000 }, () => {
  it('rejects a derived receiver with a no-op quantity assertion', async () => {
    const p = await PythonFixtures.shopping();
    await p.useResourceFixture({ copies: 2 });
    await p.returnDerivedDslWithEmptyQuantityCheck();
    await p.generateTests(); await p.runTests();
    p.expectFixtureAdmissionFailed('actual generated Shopping');
    await p.expectFixtureUnchanged(); await p.expectSocketClosedAndRebindable();
  });
  it('rejects an instance replacement of a generated assertion', async () => {
    const p = await PythonFixtures.shopping();
    await p.useResourceFixture({ copies: 2 });
    await p.generateTests();
    await p.replaceQuantityCheckOnReturnedInstance();
    await p.runTests();
    p.expectFixtureAdmissionFailed('expectBookQuantity');
    await p.expectFixtureUnchanged(); await p.expectSocketClosedAndRebindable();
  });
  it('rejects a class operation replaced during fixture setup', async () => {
    const p = await PythonFixtures.shopping();
    await p.useResourceFixture({ copies: 2 });
    await p.generateTests();
    await p.replaceQuantityCheckOnGeneratedClassDuringSetup();
    await p.runTests();
    p.expectFixtureAdmissionFailed('expectBookQuantity');
    await p.expectFixtureUnchanged(); await p.expectSocketClosedAndRebindable();
  });
});
