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
  it('allows an unrelated native class with the same name in another package', async () => {
    const fixture = new KotlinDeliveryDriver(); fixtures.push(fixture);
    await fixture.initialize(); await fixture.configureNative(); fixture.options = { adoptExisting: true };
    fixture.source('class StoreGame {}');
    await fixture.file('src/main/kotlin/other/StoreGame.kt', 'package other\nclass StoreGame\n');
    await fixture.build();
    expect(fixture.written.problems).toEqual([]);
    expect(fixture.written.receipt?.status).toBe('applied');
    expect(fixture.files.get('src/main/kotlin/other/StoreGame.kt')).toBe('package other\nclass StoreGame\n');
    expect(fixture.files.get('src/main/kotlin/store/StoreGame.kt')).toContain('class StoreGame');
  }, 90_000);

  it('keeps an unowned provider type in the native comparison of a shared file', async () => {
    const fixture = new KotlinDeliveryDriver(); fixtures.push(fixture);
    await fixture.initialize(); await fixture.configureNative();
    fixture.options = { adoptExisting: true, imports: [{ declaration: ['SystemConfig'], name: 'store.SystemConfig' }] };
    fixture.source('opaque type SystemConfig\nclass StoreGame { public save\ncapability save(config: SystemConfig) returns Text }');
    const path = 'src/main/kotlin/store/Shared.kt';
    const implementation = 'package store\nclass SystemConfig(val title: String)\nclass StoreGame { fun save(config: SystemConfig): String = config.title }\n';
    await fixture.file(path, implementation);
    fixture.associate('StoreGame', path, [{ kind: 'class', name: 'StoreGame' }]);
    fixture.associate('StoreGame.save', path, [{ kind: 'class', name: 'StoreGame' }, { kind: 'function', name: 'save', parameters: ['store.SystemConfig'] }]);
    await fixture.build();
    expect(fixture.written.problems).toEqual([]);
    expect(fixture.written.receipt?.status).toBe('applied');
    expect(fixture.files.get(path)).toBe(implementation);
    expect(fixture.files.has('src/main/kotlin/store/StoreGame.kt')).toBe(false);
    fixture.source('opaque type SystemConfig\nclass StoreGame { public save, load\ncapability save(config: SystemConfig) returns Text\ncapability load(config: SystemConfig) returns Text }');
    await fixture.update();
    expect(fixture.written.problems).toEqual([]);
    expect(fixture.written.receipt?.status).toBe('applied');
    expect(fixture.files.get(path)).toContain('class SystemConfig(val title: String)');
    expect(fixture.files.get(path)).toContain('fun save(config: SystemConfig): String = config.title');
    expect(fixture.files.get(path)).toContain('fun load(config: SystemConfig): String');
    await fixture.execute('fun main() { println(store.StoreGame().save(store.SystemConfig("Dune"))) }');
    expect(fixture.compiled.code, fixture.compiled.stderr).toBe(0);
    expect(fixture.execution.stdout.trim()).toBe('Dune');
    expect(fixture.execution.code, fixture.execution.stderr).toBe(0);
  }, 120_000);

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
  it('refuses a native signature that lacks the promised default argument', async () => {
    const fixture = new KotlinDeliveryDriver(); fixtures.push(fixture);
    await fixture.initialize(); await fixture.configureNative(); fixture.options = { adoptExisting: true };
    fixture.source('function title(book: Text = "Dune") returns Text');
    const path = 'src/main/kotlin/store/Books.kt', selector = [{ kind: 'function', name: 'title', parameters: ['kotlin.String'] }];
    await fixture.file(path, 'package store\nfun title(book: String): String = book\n');
    fixture.associate('title', path, selector);
    fixture.associate('title.book', path, [...selector, { kind: 'parameter', name: 'book' }]);
    await refused(fixture, 'native-signature-conflict');
  }, 90_000);
});
