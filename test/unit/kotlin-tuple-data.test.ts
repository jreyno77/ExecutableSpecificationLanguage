import { afterEach, expect, it } from 'vitest';
import { KotlinDeliveryDriver } from '../driver/kotlin-delivery.js';
import { queryKotlin } from '../../src/project/kotlin/kotlin-query.js';
import { kotlinTupleTypes } from '../../src/project/kotlin/kotlin-output-state.js';

const instances: KotlinDeliveryDriver[] = [];
afterEach(async () => { for (const driver of instances.splice(0)) await driver.dispose(); });

it('checks actual tuple carrier bytes even when a supplied snapshot retains its old version', async () => {
  const driver = new KotlinDeliveryDriver(); instances.push(driver);
  await driver.initialize(); await driver.configureNative();
  driver.source('type Position = [Number, Number]'); await driver.build();
  const captured = await driver.context.readSnapshot();
  const changed = { ...captured, files: captured.files.map(file => file.path.endsWith('/Tuple2.kt')
    ? { ...file, bytes: Buffer.concat([Buffer.from(file.bytes), Buffer.from('// edited after capture\n')]) } : file) };
  const native = await queryKotlin(changed, 'expec.kotlin.json');
  expect(native.problems).toEqual([]);
  const carriers = kotlinTupleTypes(changed, native.value!);
  expect(carriers.problems).toEqual([]);
  expect(carriers.value?.has(2)).toBe(true);
  expect(carriers.value?.get(2)).toBeUndefined();
}, 60_000);
