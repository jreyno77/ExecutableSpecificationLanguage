import { it } from 'vitest';
import { KotlinAcceptance } from '../dsl/kotlin-acceptance.js';

it('compares a native tuple in authored order and detects a wrong component', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type BookCount = [Text, Number]\nfunction count() returns BookCount\nexamples { example "one Dune": count() => ["Dune", 1] }');
  await project.buildContracts(); await project.implement('count', 'return Tuple2("Dune", 1.0)');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
  await project.implement('count', 'return Tuple2("Dune", 2.0)');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value[1]'); project.expectFailure('expected: <1.0> but was: <2.0>');
}, 180_000);

it('constructs tuple fixture data without requiring application declarations', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { fixture book: [Text, Number] = ["Dune", 1]\nexample "tuple fixture": book => ["Dune", 1] }');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
}, 180_000);

it('refuses changed tuple support instead of running its authored initialization', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type BookCount = [Text, Number]\nfunction count() returns BookCount\nexamples { example "one Dune": count() => ["Dune", 1] }');
  await project.buildContracts(); await project.implement('count', 'return Tuple2("Dune", 1.0)');
  const tuple = 'src/main/kotlin/store/Tuple2.kt';
  await project.nativeFile(tuple, 'package store\ndata class Tuple2<A, B>(var item1: A, var item2: B) { init { println("TUPLE_INITIALIZATION") } }');
  await project.rememberFile(tuple);
  await project.expectAcceptanceRefused('unsupported-native-data'); await project.expectFileUnchanged(tuple);
}, 180_000);

it('refuses changed test-only tuple initialization instead of trusting its regenerated preview', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples { fixture book: [Text, Number] = ["Dune", 1]\nexample "tuple fixture": book => ["Dune", 1] }');
  await project.buildAcceptance();
  const tuple = 'src/test/kotlin/store/tests/dsl/Tuple2.kt';
  await project.replaceNativeText(tuple, 'var item2: T2)', 'var item2: T2) { init { println("TUPLE_INITIALIZATION") } }');
  await project.rememberFile(tuple);
  await project.expectAcceptanceRefused('output-conflict'); await project.expectFileUnchanged(tuple);
}, 180_000);
