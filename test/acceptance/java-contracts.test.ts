import { afterEach, describe, it } from 'vitest';

import { JavaExamples } from '../dsl/java-output.js';

afterEach(() => JavaExamples.dispose());

describe('Java contracts remain native and readable', { timeout: 90_000 }, () => {
  it('refuses interface construction rather than inventing a factory API', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    p.source('interface Store { construction(title: Text) }');
    await p.createContracts({ package: 'store' });
    p.expectContractProblemAt('unsupported-native-construction', 'construction'); await p.expectNoWrites();
  });
  it('keeps authored construction explicit and visibly unfinished', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    p.source('class StoreGame { construction(title: Text, copies: Number = 1) }');
    await p.createContracts({ package: 'store' }); p.expectContractsWritten();
    await p.javac('class Consumer { void run() { new store.StoreGame("Dune"); new store.StoreGame("Dune", 2); } }');
    p.expectNativeCompilationPassed();
    await p.runJava('new store.StoreGame("Dune");');
    p.expectThrown('UnsupportedOperationException', 'Not implemented: StoreGame.construction');
  });
  it('compiles a callable contract and keeps its stub visibly unfinished', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    p.source('class StoreGame { public save\ncapability save(title: Text) returns Nothing }');
    await p.createContracts({ package: 'store' }); p.expectContractsWritten();
    await p.javac('import store.StoreGame; class Consumer { void run() { new StoreGame().save("Dune"); } }');
    p.expectNativeCompilationPassed();
    await p.runJava('new store.StoreGame().save("Dune");'); p.expectThrown('UnsupportedOperationException', 'Not implemented: save');
  });
  it('rejects the wrong native argument through javac', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    p.source('class StoreGame { public save\ncapability save(title: Text) returns Nothing }');
    await p.createContracts({ package: 'store' }); p.expectContractsWritten();
    await p.javac('import store.StoreGame; class Consumer { void run() { new StoreGame().save(64); } }');
    p.expectNativeCompilationProblemAt('64');
  });
  it('keeps actual record data and optional presence available to a Java caller', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    p.source('type Book { title: Text\ncopies: Number? }');
    await p.createContracts({ package: 'store' }); p.expectContractsWritten();
    await p.runJava('var book = new store.Book("Dune", java.util.Optional.empty()); System.out.print(book.title()+":"+book.copies().isPresent());');
    p.expectStdout('Dune:false');
  });
  it('associates a generated record accessor with the authored field identity', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    p.source('type Book { title: Text }'); await p.createContracts({ package: 'store' }); p.expectContractsWritten();
    const file = 'src/main/java/store/Reader.java';
    await p.file(file, 'package store; class Reader { String read(Book book) { return book.title(); } } class Other { String title() { return "Other"; } String read() { return title(); } }');
    await p.search('title'); p.expectIncomingToken(file, 'book.title()', 'title', 'project');
    p.expectIncomingFrom(file, 1); p.expectCoverageComplete();
  });
  it('retains generic records, tuple positions and optional absence', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    p.source('type Pair<T> = [T, T]\ntype Book { title: Text\ncopies: Number? }\ntype Shelf { books: List<Book>\nposition: Pair<Number> }');
    await p.createContracts({ package: 'store' }); p.expectContractsWritten();
    await p.runJava('var shelf = new store.Shelf(java.util.List.of(new store.Book("Dune", java.util.Optional.empty())), new store.Tuple2<>(1.0, 2.0)); System.out.print(shelf.books().get(0).title()+":"+shelf.books().get(0).copies().isEmpty()+":"+shelf.position().item2());');
    p.expectStdout('Dune:true:2.0');
    await p.runJava('new store.Book("Dune", null);'); p.expectInvalidData('copies');
  });
  it('checks literal data at the native boundary without claiming a javac refinement', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    p.source('type SystemConfig { os: "windows"\nbrightness: Number }');
    await p.createContracts({ package: 'store' }); p.expectContractsWritten();
    await p.runJava('new store.SystemConfig("windows", 0.5);'); p.expectExitCode(0);
    await p.runJava('new store.SystemConfig("linux", 0.5);'); p.expectInvalidData('os');
    await p.runJava('new store.SystemConfig("windows", Double.NaN);'); p.expectInvalidData('brightness');
  });
  it('refuses lossy numbers and unsupported unnamed unions before writing', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    p.source('type Data { count: 9007199254740993\nvalue: Text | Number }');
    await p.createContracts({ package: 'store' });
    p.expectContractProblemAt('unsupported-native-number', '9007199254740993');
    p.expectContractProblemAt('unsupported-native-type', 'Text | Number'); await p.expectNoWrites();
  });
  it('refuses conflicting native erasure and generic names before writes', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    p.source('type Book { title: Text }\ntype Box<T> { item: Book }\nfunction first(books: List<Book>) returns Nothing\nfunction second(titles: List<Text>) returns Nothing');
    await p.createContracts({ package: 'store', names: [{ declaration: ['Box', 'T'], name: 'Book' },
      { declaration: ['first'], name: 'save' }, { declaration: ['second'], name: 'save' }] });
    p.expectNativeConflict('native-name-conflict', 'Book'); p.expectNativeConflict('native-signature-conflict', 'save');
    await p.expectNoWrites();
  });
  it('uses an actual mapped opaque native type without wrapping it', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    p.source('opaque type URL\nfunction open(url: URL) returns Nothing');
    await p.createContracts({ package: 'store', names: [{ declaration: ['open'], name: 'openUrl' }], imports: [{ module: 'main', declaration: ['URL'], name: 'java.net.URI' }] });
    p.expectContractsWritten();
    await p.javac('class Consumer { void run() { store.Functions.openUrl(java.net.URI.create("https://example.test")); } }');
    p.expectNativeCompilationPassed(); p.expectNoNativeType('store.URL');
  });
  it('erases a transparent alias without inventing a nominal native type', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    p.source('type Title = Text\nfunction save(title: Title) returns Nothing');
    await p.createContracts({ package: 'store' }); p.expectContractsWritten(); await p.read('Title');
    p.expectAliasDocumentation('Title', 'java.lang.String'); p.expectNoNativeType('store.Title');
    await p.javac('class Consumer { void run(String title) { store.Functions.save(title); } }'); p.expectNativeCompilationPassed();
    await p.search('Title'); p.expectAliasSpellingLimitation();
  });
  it('retains default obligations and distinguishes unspecified from Nothing', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    p.source('function save(title: Text, copies: Number = 1) returns Nothing\nfunction discover()');
    await p.createContracts({ package: 'store' }); p.expectContractsWritten();
    await p.expectMethod('store.Functions', 'save', ['java.lang.String'], 'void');
    await p.expectMethod('store.Functions', 'save', ['java.lang.String', 'double'], 'void');
    await p.expectMethod('store.Functions', 'discover', [], 'java.lang.Object');
    p.expectUnverifiedDefault('copies', '1'); p.expectUnverifiedResult('discover');
    await p.runJava('store.Functions.save("Dune");'); p.expectThrown('UnsupportedOperationException', 'Not implemented: save');
  });
  it('keeps domain error payloads separate from non-generic exceptions and normal results', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    p.source('type Book { title: Text }\nerror type Rejected<T> { code: "rejected"\npayload: T }\nfunction save(book: Book) returns Book fails with Rejected<Book>');
    await p.createContracts({ package: 'store' }); p.expectContractsWritten();
    await p.runJava('var details = new store.Rejected<>("rejected",new store.Book("Dune")); var failure = new store.RejectedException(details); System.out.print(failure.details().code()+":"+((store.Book)failure.details().payload()).title());');
    p.expectStdout('rejected:Dune'); await p.expectMethod('store.Functions', 'save', ['store.Book'], 'store.Book');
    p.expectFailureObligation('save', 'Rejected<Book>');
  });
});

it('requires explicit workspace authority for a provider capability under an owned class', { timeout: 120_000 }, async () => {
  const p = await JavaExamples.connect(); await p.installNativeProfile();
  p.library('library', 'use Game from "main"\nextend Game { public save\ncapability save() returns Nothing }');
  p.source('include "library"\nclass Game {}');
  await p.createContracts({ package: 'store' }); p.expectLocatedGenerationProblem('unsupported-augmentation');
  p.workspaceModules(['library']); await p.createContracts({ package: 'store' }); p.expectContractsWritten();
  await p.runJava('new store.Game().save();'); p.expectThrown('UnsupportedOperationException','Not implemented: save');
});

it('associates a generated record component with its field, accessor and canonical parameter', { timeout: 120_000 }, async () => {
  const p = await JavaExamples.connect(); await p.installNativeProfile(); p.source('type Book { title: Text }');
  await p.createContracts({ package: 'store' }); p.expectContractsWritten();
  p.expectRecordComponentFacets('title', 'store.Book', ['java.lang.String'], 0);
  await p.read('title'); p.expectReadWholeFile('src/main/java/store/Book.java');
  await p.search('title'); p.expectIncomingToken('src/main/java/store/Book.java', 'title =', 'title', 'specified');
  p.expectIncomingToken('src/main/java/store/Book.java', 'required(title,', 'title', 'specified'); p.expectCoverageComplete();
});
