import { afterEach, it } from 'vitest';
import { KotlinDelivery } from '../dsl/kotlin-delivery.js';
afterEach(() => KotlinDelivery.dispose());

it('preserves actual anonymous member targets when an earlier declaration name changes length', async () => {
  const project = await KotlinDelivery.create();
  project.source('function value() returns Number');
  await project.buildContracts();
  await project.implement('value', 'val state = object { val number = 2.0; fun read() = number }; return state.read()');
  project.change('function observedValue() returns Number', { value: 'observedValue' });
  await project.updateContracts();
  await project.read('observedValue');
  project.expectReadText('val state = object { val number = 2.0; fun read() = number }; return state.read()');
  await project.runConsumer('fun main() { println(store.observedValue()) }'); project.expectStdout('2.0');
}, 120_000);
