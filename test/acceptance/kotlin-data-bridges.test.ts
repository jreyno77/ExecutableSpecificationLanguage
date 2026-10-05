import { it } from 'vitest';
import { KotlinAcceptance } from '../dsl/kotlin-acceptance.js';

it('preserves a present nullable fixture while changing its native carrier context', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples {\n fixture title: ("Dune" | "Foundation")? = "Foundation"\n observation readTitle(prefix: ("Dune" | "Foundation")?) returns Text\n example "present title": readTitle(title) => "Foundation"\n}');
  await project.buildAcceptance();
  await project.implementDriverOperation('readTitle', 'return prefix?.text ?: "absent"');
  await project.runTests(); project.expectTests(1, 0);
  await project.implementDriverOperation('readTitle', 'return "absent"');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value ==> expected: <Foundation> but was: <absent>');
}, 240_000);

it('preserves actual absence when passing a nullable application result into an operation', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('function loadTitle() returns ("Dune" | "Foundation")?\nexamples {\n observation readTitle(prefix: ("Dune" | "Foundation")?) returns Text\n example "absent title": readTitle(loadTitle()) => "absent"\n}');
  await project.buildContracts(); await project.implement('loadTitle', 'return null');
  await project.buildAcceptance();
  await project.implementDriverOperation('readTitle', 'return prefix?.text ?: "absent"');
  await project.runTests(); project.expectTests(1, 0);
  await project.implement('loadTitle', 'return LoadTitleResult.Foundation');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value ==> expected: <absent> but was: <Foundation>');
}, 240_000);

it('retains instantiated generic list data across distinct checked union carriers', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Choice<T> = List<T> | Number\nfunction loadTitles() returns Choice<Text>\nexamples {\n observation readTitles(value: List<Text> | Number) returns Text\n example "stored title": readTitles(loadTitles()) => "Dune"\n}');
  await project.buildContracts(); await project.implement('loadTitles', 'return Choice.List(mutableListOf("Dune"))');
  await project.buildAcceptance();
  await project.implementDriverOperation('readTitles', 'return when (value) { is store.tests.dsl.ExamplesReadTitlesValue.List -> value.value[0]; else -> "number" }');
  await project.runTests(); project.expectTests(1, 0);
  await project.implement('loadTitles', 'return Choice.List(mutableListOf("Foundation"))');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value ==> expected: <Dune> but was: <Foundation>');
}, 240_000);
