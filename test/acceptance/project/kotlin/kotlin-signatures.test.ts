import { afterEach, it } from 'vitest';
import { KotlinDelivery } from '../../../dsl/project/kotlin/kotlin-delivery.js';

afterEach(() => KotlinDelivery.dispose());

it('updates a result contract while exposing the retained body mismatch separately', async () => {
  const project = await KotlinDelivery.create();
  project.source('function copies() returns Text');
  await project.buildContracts();
  await project.implement('copies', '// preserve the implementation\n    return "many"');
  project.change('function copies() returns Number');
  await project.updateContracts();
  project.expectFileContains('src/main/kotlin/store/copies.kt', 'fun copies(): Double');
  project.expectFileContains('src/main/kotlin/store/copies.kt', '// preserve the implementation\n    return "many"');
  project.expectNativeObligation('kotlin-RETURN_TYPE_MISMATCH');
  await project.compileConsumer('fun main() { println(store.copies()) }');
  project.expectNativeCompilationFailedAt('String');
}, 120_000);

it('adds an explicit changed result to an adopted expression body without replacing it', async () => {
  const project = await KotlinDelivery.create();
  project.options({ adoptExisting: true });
  project.source('function copies() returns Text');
  await project.file('src/main/kotlin/store/Books.kt', 'package store\nfun copies() /* retained */ = "many"\n');
  project.associateCallable('copies', 'src/main/kotlin/store/Books.kt', [], 'copies', []);
  await project.buildContracts();
  project.change('function copies() returns Number');
  await project.updateContracts();
  project.expectFileText('src/main/kotlin/store/Books.kt', 'package store\nfun copies(): Double /* retained */ = "many"\n');
  project.expectNativeObligation('kotlin-RETURN_TYPE_MISMATCH');
}, 120_000);
