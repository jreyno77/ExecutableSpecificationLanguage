import { it } from 'vitest';
import { KotlinAcceptance } from '../dsl/kotlin-acceptance.js';

it('constructs inline singleton record fields through their actual generated carriers', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Book { title: "Dune"\ncopy: 1\nenabled: true }\nfunction loadBook() returns Book\nexamples { example "one enabled Dune": loadBook() => { title: "Dune", copy: 1, enabled: true } }');
  await project.buildContracts();
  await project.implement('loadBook', 'return Book(BookTitle("Dune"), BookCopy(1.0), BookEnabled(true))');
  await project.buildAcceptance();
  await project.runTests(); project.expectTests(1, 0);
}, 240_000);

it('compares an inline text union without widening it to String', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Device { system: "windows" | "linux" }\nfunction loadDevice() returns Device\nexamples { example "windows device": loadDevice() => { system: "windows" } }');
  await project.buildContracts();
  await project.implement('loadDevice', 'return Device(DeviceSystem.Windows)');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
  await project.implement('loadDevice', 'return Device(DeviceSystem.Linux)');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value.system ==> expected: <windows> but was: <linux>');
}, 240_000);

it('keeps equal inline union shapes attached to their distinct receiving fields', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Choice { first: Text | Number\nsecond: Text | Number }\nfunction choices() returns Choice\nexamples { example "title and quantity": choices() => { first: "Dune", second: 1 } }');
  await project.buildContracts();
  await project.implement('choices', 'return Choice(ChoiceFirst.Text("Dune"), ChoiceSecond.Number(1.0))');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
  await project.implement('choices', 'return Choice(ChoiceFirst.Text("Dune"), ChoiceSecond.Number(2.0))');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value.second ==> expected: <1.0> but was: <2.0>');
}, 240_000);

it('uses an inline result companion beside the actual implemented function', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('function choice() returns Text | Number\nexamples { example "Dune title": choice() => "Dune" }');
  await project.buildContracts(); await project.implement('choice', 'return ChoiceResult.Text("Dune")');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
  await project.implement('choice', 'return ChoiceResult.Number(1.0)');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value: declared union alternative');
}, 240_000);

it('retains inline restriction context through a list element', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Titles { values: List<"Dune" | "Foundation"> }\nfunction loadTitles() returns Titles\nexamples { example "Dune list": loadTitles() => { values: ["Dune"] } }');
  await project.buildContracts(); await project.implement('loadTitles', 'return Titles(mutableListOf(TitlesValuesElement.Dune))');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
  await project.implement('loadTitles', 'return Titles(mutableListOf(TitlesValuesElement.Foundation))');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value.values[0] ==> expected: <Dune> but was: <Foundation>');
}, 240_000);

it('does not trust an altered inline carrier beside an unchanged associated record', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Device { system: "windows" | "linux" }\nfunction loadDevice() returns Device\nexamples { example "windows device": loadDevice() => { system: "windows" } }');
  await project.buildContracts();
  await project.nativeFile('src/main/kotlin/store/Device.kt', 'package store\ndata class Device(var system: DeviceSystem)\nenum class DeviceSystem(val text: String) { Windows("windows"), Linux("linux"); init { println("Carrier side effect") } }');
  await project.implement('loadDevice', 'return Device(DeviceSystem.Windows)');
  await project.expectAcceptanceRefused('unsupported-fixture-data');
  project.expectNoGeneratedStep('fun windowsDevice()');
}, 180_000);

it('retains instantiated generic arguments inside an inline union carrier', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Box<T> { value: List<T> | Number }\nfunction loadBox() returns Box<Text>\nexamples { example "Dune titles": loadBox() => { value: ["Dune"] } }');
  await project.buildContracts(); await project.implement('loadBox', 'return Box<String>(BoxValue.List<String>(mutableListOf("Dune")))');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
  await project.implement('loadBox', 'return Box<String>(BoxValue.List<String>(mutableListOf("Other")))');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value.value[0] ==> expected: <Dune> but was: <Other>');
}, 240_000);

it('keeps repeated inline tuple shapes in their own ordered carrier slots', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Pair { values: [Text | Number, Text | Number] }\nfunction loadPair() returns Pair\nexamples { example "title then quantity": loadPair() => { values: ["Dune", 1] } }');
  await project.buildContracts(); await project.implement('loadPair', 'return Pair(Tuple2(PairValuesItem1.Text("Dune"), PairValuesItem2.Number(1.0)))');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
  await project.implement('loadPair', 'return Pair(Tuple2(PairValuesItem1.Number(1.0), PairValuesItem2.Text("Dune")))');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value.values[0]: declared union alternative');
}, 240_000);

it('retains the inner alias carrier through optional data', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Titles = List<"Dune" | "Foundation">\ntype MaybeTitles = Titles?\nfunction loadTitles() returns MaybeTitles?\nexamples { example "present title": loadTitles() => ["Dune"] }');
  await project.buildContracts(); await project.implement('loadTitles', 'return mutableListOf(TitlesValueElement.Dune)');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
  await project.implement('loadTitles', 'return mutableListOf(TitlesValueElement.Foundation)');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value[0] ==> expected: <Dune> but was: <Foundation>');
}, 240_000);

it('retains the nested carrier inside an inline list union alternative', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Choice { value: List<"Dune" | "Foundation"> | Number }\nfunction loadChoice() returns Choice\nexamples { example "Dune alternative": loadChoice() => { value: ["Dune"] } }');
  await project.buildContracts();
  await project.implement('loadChoice', 'return Choice(ChoiceValue.List(mutableListOf(ChoiceValueElement.Dune)))');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
  await project.implement('loadChoice', 'return Choice(ChoiceValue.List(mutableListOf(ChoiceValueElement.Foundation)))');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value.value[0] ==> expected: <Dune> but was: <Foundation>');
}, 240_000);
