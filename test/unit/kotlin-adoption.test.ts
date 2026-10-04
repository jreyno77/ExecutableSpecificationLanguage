import { afterEach, describe, expect, it } from 'vitest';
import { KotlinDeliveryDriver } from '../driver/kotlin-delivery.js';

const fixtures: KotlinDeliveryDriver[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.dispose(); });
async function adoption(code: string, complete = true) {
  const fixture = new KotlinDeliveryDriver(); fixtures.push(fixture);
  await fixture.initialize(); await fixture.configureNative(); fixture.options = { adoptExisting: true };
  fixture.source('class StoreGame { public save\ncapability save() returns Text }');
  await fixture.file('src/main/kotlin/store/Game.kt', 'package store\n' + code);
  fixture.associate('StoreGame', 'src/main/kotlin/store/Game.kt', [{ kind: 'class', name: 'StoreGame' }]);
  if (complete) fixture.associate('StoreGame.save', 'src/main/kotlin/store/Game.kt', [{ kind: 'class', name: 'StoreGame' }, { kind: 'function', name: 'save', parameters: [] }]);
  return fixture;
}
async function refused(fixture: KotlinDeliveryDriver, code: string) {
  const before = await fixture.capturedFiles(); await fixture.build();
  expect(fixture.written.problems.map(problem => problem.code)).toContain(code);
  expect(fixture.written.receipt).toBeUndefined(); expect(fixture.files).toEqual(before);
}

describe('explicit Kotlin adoption verifies actual native contract facts', () => {
  it('does not infer ownership of an unmapped member from its mapped class', async () => {
    await refused(await adoption('class StoreGame { fun save() = "saved" }', false), 'unowned-declaration');
  }, 60_000);

  it('compares an inferred native result instead of trusting a matching method name', async () => {
    await refused(await adoption('class StoreGame { fun save() = 7 }'), 'native-signature-conflict');
  }, 60_000);

  it('does not expose an actual private method as a public source capability', async () => {
    await refused(await adoption('class StoreGame { private fun save() = "saved" }'), 'native-signature-conflict');
  }, 60_000);

  it('requires the ordinary zero-argument constructor promised by the source class', async () => {
    await refused(await adoption('class StoreGame(val title: String) { fun save() = title }'), 'native-signature-conflict');
  }, 60_000);

  it('does not treat a private zero-argument constructor as the public default construction', async () => {
    await refused(await adoption('class StoreGame private constructor() { fun save() = "saved" }'), 'native-signature-conflict');
  }, 60_000);
});
