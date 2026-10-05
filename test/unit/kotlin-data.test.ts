import { afterEach, expect, it } from 'vitest';
import { queryKotlin } from '../../src/kotlin-query.js';
import { KotlinDeliveryDriver } from '../driver/kotlin-delivery.js';

const instances: KotlinDeliveryDriver[] = [];
afterEach(async () => { for (const driver of instances.splice(0)) await driver.dispose(); });
async function declarations(source: string) {
  const driver = new KotlinDeliveryDriver(); instances.push(driver);
  await driver.initialize(); await driver.configureNative();
  await driver.file('src/main/kotlin/store/Data.kt', 'package store\n' + source);
  const result = await queryKotlin(await driver.context.readSnapshot(), 'expec.kotlin.json');
  expect(result.problems).toEqual([]);
  return result.value!.declarations;
}

it('separates ordinary stored data from application initialization', async () => {
  const result = await declarations('data class Plain(var copies: Double)\ndata class Normalized(var copies: Double) { init { copies = 2.0 } }');
  expect(result.filter(item => item.kind === 'class').map(item => [item.name, item.dataConstruction])).toEqual([
    ['Plain', true], ['Normalized', false],
  ]);
  expect(result.filter(item => item.kind === 'property').map(item => [item.selector[0]!.name, item.name, item.storedProperty])).toEqual([
    ['Plain', 'copies', true], ['Normalized', 'copies', true],
  ]);
}, 60_000);

it('distinguishes a stored property from a computed or delegated getter', async () => {
  const result = await declarations('class Book { val stored = 1.0\nval computed get() = 1.0\nval delegated by lazy { 1.0 } }');
  expect(result.filter(item => item.kind === 'property' && item.selector.length === 2).map(item => [item.name, item.storedProperty])).toEqual([
    ['stored', true], ['computed', false], ['delegated', false],
  ]);
}, 60_000);

it('does not permit authored data construction through companion or secondary initialization', async () => {
  const result = await declarations('data class Companion(val title: String) { companion object { val setup = println("application") } }\nclass Secondary(val title: String) { constructor(): this("Dune") { println("application") } }');
  expect(result.filter(item => item.kind === 'class').map(item => [item.name, item.dataConstruction])).toEqual([
    ['Companion', false], ['Secondary', false],
  ]);
}, 60_000);

it('uses native finality for implicit overrides and final record classes', async () => {
  const result = await declarations('interface Counts { val copies: Double }\nopen class OpenBook(override val copies: Double): Counts\nclass ClosedBook(override val copies: Double): Counts\nopen class FinalSlot(final override val copies: Double): Counts');
  expect(result.filter(item => item.kind === 'property' && item.name === 'copies' && item.selector.length === 2).map(item => [item.selector[0]!.name, item.storedProperty])).toEqual([
    ['Counts', false], ['OpenBook', false], ['ClosedBook', true], ['FinalSlot', true],
  ]);
}, 60_000);

it('reads the concrete type of an inherited fixture property without private or extension properties', async () => {
  const result = await declarations('class Shopping\nopen class Base<T>(protected val shopping: T) { private val hidden = 1.0\nval String.extension get() = this }\nclass Fixture: Base<Shopping>(Shopping())');
  expect(result.find(item => item.name === 'Fixture' && item.kind === 'class')?.readableProperties).toEqual([
    { name: 'shopping', type: 'store.Shopping' },
  ]);
}, 60_000);
