import { it } from 'vitest';
import { KotlinAcceptance } from '../dsl/kotlin-acceptance.js';

it('uses a literal-typed fixture as expected data for an actual application result', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('function loadTitle() returns Text\nexamples {\n fixture expectedTitle: "Dune" = "Dune"\n example "stored title": loadTitle() => expectedTitle\n}');
  await project.buildContracts(); await project.implement('loadTitle', 'return "Dune"');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
  await project.implement('loadTitle', 'return "Other"');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value ==> expected: <Dune> but was: <Other>');
}, 240_000);

it('passes the stored fixture value through a distinct inline parameter carrier', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples {\n fixture title: "Dune" = "Dune"\n observation loadTitle(prefix: "Dune") returns Text\n example "stored title": loadTitle(title) => "Dune"\n}');
  await project.buildAcceptance();
  await project.implementDriverOperation('loadTitle', 'return prefix.value');
  await project.runTests(); project.expectTests(1, 0);
  await project.implementDriverOperation('loadTitle', 'return "Other"');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value ==> expected: <Dune> but was: <Other>');
}, 240_000);

it('keeps both stored enum values when bridging into one operation parameter', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples {\n fixture first: "Dune" | "Foundation" = "Dune"\n fixture second: "Dune" | "Foundation" = "Foundation"\n observation loadTitle(prefix: "Dune" | "Foundation") returns Text\n example "first title": loadTitle(first) => "Dune"\n example "second title": loadTitle(second) => "Foundation"\n}');
  await project.buildAcceptance();
  await project.implementDriverOperation('loadTitle', 'return prefix.text');
  await project.runTests(); project.expectTests(2, 0);
  await project.implementDriverOperation('loadTitle', 'return "Dune"');
  await project.runTests(); project.expectTests(1, 1);
  project.expectFailure('value ==> expected: <Foundation> but was: <Dune>');
}, 240_000);

it('keeps a test-only restricted operation result executable and checked', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples {\n observation loadTitle() returns "Dune" | "Foundation"\n example "stored title": loadTitle() => "Dune"\n}');
  await project.buildAcceptance();
  await project.implementDriverOperation('loadTitle', 'return store.tests.dsl.ExamplesLoadTitle.Dune');
  await project.runTests(); project.expectTests(1, 0);
  await project.implementDriverOperation('loadTitle', 'return store.tests.dsl.ExamplesLoadTitle.Foundation');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value ==> expected: <Dune> but was: <Foundation>');
}, 240_000);

it('keeps actual fixture list elements across equal declared types with different native carriers', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('function loadTitles() returns List<"Dune" | "Foundation">\nexamples {\n fixture titles: List<"Dune" | "Foundation"> = ["Dune"]\n example "stored titles": loadTitles() => titles\n}');
  await project.buildContracts(); await project.implement('loadTitles', 'return mutableListOf(store.LoadTitlesResultElement.Dune)');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
  await project.implement('loadTitles', 'return mutableListOf(store.LoadTitlesResultElement.Foundation)');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value[0] ==> expected: <Dune> but was: <Foundation>');
}, 240_000);

it('refuses changed test carrier validation before preserving it', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples {\n observation loadTitle(prefix: "Dune") returns Text\n example "stored title": loadTitle("Dune") => "Dune"\n}');
  await project.buildAcceptance();
  const carrier = 'src/test/kotlin/store/tests/dsl/ExpecTestData.kt';
  await project.replaceNativeText(carrier, 'value == "Dune"', 'value != "Dune"');
  await project.rememberFile(carrier);
  await project.expectAcceptanceRefused('output-conflict'); await project.expectFileUnchanged(carrier);
}, 240_000);

it('rebuilds and retires unused test carrier support while retaining the real application body', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('function loadTitle() returns Text\nexamples {\n fixture title: "Dune" = "Dune"\n example "stored title": loadTitle() => title\n}');
  await project.buildContracts(); await project.implement('loadTitle', 'return "Dune"');
  await project.buildAcceptance();
  await project.rememberFile('src/main/kotlin/store/loadTitle.kt');
  await project.repeatAcceptance();
  project.source('function loadTitle() returns Text\nexamples {\n fixture title: Text = "Dune"\n example "stored title": loadTitle() => title\n}');
  await project.updateAcceptance();
  await project.expectNoNativeFile('src/test/kotlin/store/tests/dsl/ExpecTestData.kt');
  await project.expectFileUnchanged('src/main/kotlin/store/loadTitle.kt');
  await project.runTests(); project.expectTests(1, 0);
}, 300_000);

it('refuses test carrier retirement while a handwritten native caller survives', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('function loadTitle() returns Text\nexamples {\n fixture title: "Dune" = "Dune"\n example "stored title": loadTitle() => title\n}');
  await project.buildContracts(); await project.implement('loadTitle', 'return "Dune"');
  await project.buildAcceptance();
  const caller = 'src/test/kotlin/store/tests/TitleReader.kt', carrier = 'src/test/kotlin/store/tests/dsl/ExpecTestData.kt';
  await project.nativeFile(caller, 'package store.tests\nfun expectedTitle() = store.tests.dsl.ExamplesTitle("Dune").value\n');
  await project.rememberFile(caller); await project.rememberFile(carrier);
  project.source('function loadTitle() returns Text\nexamples {\n fixture title: Text = "Dune"\n example "stored title": loadTitle() => title\n}');
  await project.expectAcceptanceRefused('output-conflict');
  await project.expectFileUnchanged(caller); await project.expectFileUnchanged(carrier);
}, 300_000);

it('passes a checked literal argument through a test-only operation to its actual driver', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('examples {\n observation loadTitle(prefix: "Dune") returns Text\n example "stored title": loadTitle("Dune") => "Dune"\n}');
  await project.buildAcceptance();
  await project.implementDriverOperation('loadTitle', 'return "Dune"');
  await project.runTests(); project.expectTests(1, 0);
  await project.implementDriverOperation('loadTitle', 'return "Other"');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value ==> expected: <Dune> but was: <Other>');
}, 240_000);
