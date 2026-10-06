import { it } from 'vitest';
import { KotlinAcceptance } from '../../../dsl/project/kotlin/kotlin-acceptance.js';

it('compares an operating-system enum with the authored text value', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type OS = "windows" | "linux"\nfunction system() returns OS\nexamples { example "windows device": system() => "windows" }');
  await project.buildContracts();
  await project.implement('system', 'return OS.Windows');
  await project.buildAcceptance();
  await project.runTests(); project.expectTests(1, 0);
  await project.implement('system', 'return OS.Linux');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('expected: <windows> but was: <linux>');
}, 180_000);

it('retains a generic restriction while comparing its declared value', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type OS<T> = "windows" | "linux"\nfunction system() returns OS<Number>\nexamples { example "windows device": system() => "windows" }');
  await project.buildContracts();
  await project.implement('system', 'return OS<Double>("windows")');
  await project.buildAcceptance();
  await project.runTests(); project.expectTests(1, 0);
  await project.implement('system', 'return OS<Double>("linux")');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('expected: <windows> but was: <linux>');
}, 180_000);

it('compares the selected tagged-union alternative and refuses a different alternative', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Choice = Text | Number\nfunction selectedChoice() returns Choice\nexamples { example "Dune title": selectedChoice() => "Dune" }');
  await project.buildContracts();
  await project.implement('selectedChoice', 'return Choice.Text("Dune")');
  await project.buildAcceptance();
  await project.runTests(); project.expectTests(1, 0);
  await project.implement('selectedChoice', 'return Choice.Number(1.0)');
  await project.runTests(); project.expectTests(0, 1);
  project.expectFailure('value: declared union alternative');
}, 180_000);

it('constructs singleton field data through its checked native wrappers', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Title = "Dune"\ntype Enabled = true\ntype Copies = 1\ntype Book { title: Title\nenabled: Enabled\ncopies: Copies }\nfunction loadBook() returns Book\nexamples { example "one enabled Dune": loadBook() => { title: "Dune", enabled: true, copies: 1 } }');
  await project.buildContracts();
  await project.implement('loadBook', 'return Book(Title("Dune"), Enabled(true), Copies(1.0))');
  await project.buildAcceptance();
  await project.runTests(); project.expectTests(1, 0);
}, 180_000);

it('does not run custom restriction initialization while preparing authored expected data', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type OS = "windows" | "linux"\nfunction system() returns OS\nexamples { example "windows device": system() => "windows" }');
  await project.buildContracts();
  await project.nativeFile('src/main/kotlin/store/OS.kt', 'package store\nenum class OS(val text: String) { Windows("windows"), Linux("linux"); init { println("Expected data initialization ran") } }');
  await project.implement('system', 'return OS.Windows');
  await project.expectAcceptanceRefused('unsupported-fixture-data');
  project.expectNoGeneratedStep('fun windowsDevice()');
}, 120_000);

it('retains a negative singleton value through native expected data', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Debt = -1\nfunction amount() returns Debt\nexamples { example "one owed": amount() => -1 }');
  await project.buildContracts(); await project.implement('amount', 'return Debt(-1.0)');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
}, 180_000);

it('constructs a record inside its selected union alternative', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Book { title: Text }\ntype Choice = Book | Number\nfunction selection() returns Choice\nexamples { example "Dune selection": selection() => { title: "Dune" } }');
  await project.buildContracts(); await project.implement('selection', 'return Choice.Book(Book("Dune"))');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
  await project.implement('selection', 'return Choice.Book(Book("Other"))');
  await project.runTests(); project.expectTests(0, 1); project.expectFailure('value.title ==> expected: <Dune> but was: <Other>');
}, 180_000);

it('constructs an empty list using its declared union alternative', async () => {
  const project = await KotlinAcceptance.connect();
  project.source('type Choice = List<Text> | Number\nfunction selection() returns Choice\nexamples { example "no books": selection() => [] }');
  await project.buildContracts(); await project.implement('selection', 'return Choice.List(mutableListOf())');
  await project.buildAcceptance(); await project.runTests(); project.expectTests(1, 0);
  await project.implement('selection', 'return Choice.List(mutableListOf("Dune"))');
  await project.runTests(); project.expectTests(0, 1); project.expectFailure('value.size ==> expected: <0> but was: <1>');
}, 180_000);

