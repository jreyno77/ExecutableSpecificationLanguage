import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { KotlinDeliveryDriver } from '../driver/kotlin-delivery.js';

const fixtures: KotlinDeliveryDriver[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.dispose(); });
async function project() {
  const fixture = new KotlinDeliveryDriver(); fixtures.push(fixture);
  await fixture.initialize(); await fixture.configureNative();
  fixture.source('class StoreGame { public save\ncapability save() returns Text }'); await fixture.build();
  expect(fixture.written.problems).toEqual([]); return fixture;
}

describe('Kotlin preservation edits only established native ownership', () => {
  it('leaves captured non-source binary bytes untouched during a capability addition', async () => {
    const fixture = await project(), binary = join(fixture.root, 'ordinary.bin');
    await fs.writeFile(binary, new Uint8Array([0, 255, 192, 128]));
    fixture.source('class StoreGame { public save, delete\ncapability save() returns Text\ncapability delete() returns Nothing }');
    await fixture.update();
    expect(fixture.written.problems).toEqual([]);
    expect(fixture.written.receipt?.status).toBe('applied');
    expect(fixture.files.get('src/main/kotlin/store/StoreGame.kt')).toContain('fun delete(): Unit');
    expect([...await fs.readFile(binary)]).toEqual([0, 255, 192, 128]);
  }, 120_000);

  it('does not move an unowned neighboring top-level class with a renamed generated class', async () => {
    const fixture = await project();
    await fixture.file('src/main/kotlin/store/StoreGame.kt', 'package store\nclass StoreGame { fun save() = "saved" }\nclass Other { val note = "retained" }');
    const before = await fixture.capturedFiles();
    fixture.source('class SavedGame { public save\ncapability save() returns Text }', { StoreGame: 'SavedGame' });
    await fixture.update();
    expect(fixture.written.problems.map(problem => problem.code)).toContain('output-conflict');
    expect(fixture.written.receipt).toBeUndefined();
    expect(fixture.files).toEqual(before);
  }, 120_000);
});
