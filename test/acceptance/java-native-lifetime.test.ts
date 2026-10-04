import { afterEach, describe, it } from 'vitest';
import { JavaExamples } from '../dsl/java-output.js';

afterEach(() => JavaExamples.dispose());
describe('native Java evidence outlives the actual query', { timeout: 90_000 }, () => {
  it('discards a native answer when its selected JAR changes before the query finishes', async () => {
    const p = await JavaExamples.connect();
    await p.installCatalogJar('public class Book { public String title; }');
    const file = 'src/main/java/store/Read.java';
    await p.file(file, 'package store; class Read { String title(catalog.Book book) { return book.title; } }');
    p.mapType('read', file, 'store.Read');

    await p.searchWhileCatalogChanges('read');

    p.expectNativeInputChanged(); p.expectQueryIncomplete();
    await p.expectFinishedNativeQueryAndCleanup();
  });
  it('uses current captured bytes without changing an earlier returned file', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    const file = 'src/main/java/store/Store.java';
    const original = 'package store; class Store { String title() { return "Dune"; } }';
    const changed = 'package store; class Store { String title() { return "Dune Messiah"; } }';
    await p.file(file, original); p.mapType('store', file, 'store.Store');
    await p.read('store'); p.expectReadText(file, original); p.retainRead();

    p.replaceCapturedSource(file, changed);
    await p.readCurrentCapture('store');

    p.expectReadText(file, changed); p.expectRetainedRead(file, original);
  });
  it('reports an interrupted actual native process and removes its scratch without changing an earlier read', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    const file = 'src/main/java/store/Store.java', source = 'package store; class Store { String title="Dune"; }';
    await p.file(file, source); p.mapType('store', file, 'store.Store');
    await p.read('store'); p.expectReadText(file, source); p.retainRead();
    await p.interruptNativeQuery('store');
    await p.expectNativeFailureAndCleanup(); p.expectRetainedRead(file, source);
  });
  it('refuses every planned write after the selected JAR changes', async () => {
    const p = await JavaExamples.connect(); await p.installCatalogJar('public class Book {}');
    p.source('class Book {}\nclass Store {}'); p.changeCatalogBeforeApplyingPlan();

    await p.createContracts({ package: 'store' });

    await p.expectNativeWriteStopped([]);
  });
  it('refuses a generated contract after its selected external source changes', async () => {
    const p = await JavaExamples.connect();
    await p.installExternalSource('catalog/Book.java', 'package catalog; public class Book { public String title; }');
    p.source('opaque type Book\nclass Read { construction(book: Book) }');
    p.changeExternalSourceBeforeApplyingPlan('package catalog; public class Book { public int title; }');

    await p.createContracts({ package: 'store', imports: [{ module: 'main', declaration: ['Book'], name: 'catalog.Book' }] });

    await p.expectNativeWriteStopped([]);
  });
  it('keeps earlier source, read and search reports unchanged after actual generation', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    const file = 'src/main/java/store/Store.java', source = 'package store; class Store { String title="Dune"; }';
    await p.file(file, source); p.mapType('store', file, 'store.Store');
    await p.read('store'); p.expectReadText(file, source); await p.search('store'); p.expectCoverageComplete(); p.retainCurrentReports();

    p.source('class Book {}'); await p.createContracts({ package: 'store' }); p.expectContractsWritten();

    p.expectEarlierReportsUnchanged();
  });
  it('retains the actual applied prefix when native evidence changes between writes', async () => {
    const p = await JavaExamples.connect(); await p.installCatalogJar('public class Book {}');
    p.source('class Book {}\nclass Store {}'); p.changeCatalogAfterFirstWrite();

    await p.createContracts({ package: 'store' });

    await p.expectNativeWriteStopped(['src/main/java/store/Book.java']);
  });
  it('inspects actual library types without executing build scripts, processors or static initializers', async () => {
    const p = await JavaExamples.connect(); await p.installInspectionCanaries();
    const file = 'src/main/java/store/Read.java';
    const source = 'package store; class Read { String title(catalog.Book book) { return book.title; } }';
    await p.file(file, source); p.mapType('read', file, 'store.Read');

    await p.read('read'); p.expectReadText(file, source);
    await p.search('read'); p.expectExternalTarget('catalog.Book', 'title'); p.expectCoverageComplete();
    p.source('class Store {}'); await p.createContracts({ package: 'store' }); p.expectContractsWritten();

    await p.expectNoExecutionCanaryEffects();
  });
});
