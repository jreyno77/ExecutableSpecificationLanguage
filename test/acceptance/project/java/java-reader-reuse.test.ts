import { describe, it } from 'vitest';
import { JavaReaderExamples } from '../../../dsl/project/java/java-reader.js';

describe('successive Java project questions', { timeout: 90_000 }, () => {
  it('reads a declaration and finds its real caller with one native preparation', async () => {
    const p = await JavaReaderExamples.direct(
      'package store; public class Book { public void save(String title) {} } ' +
      'class Shelf { void run() { new Book().save("Dune"); } }');
    p.associateType('book', 'src/main/java/store/Book.java', 'store.Book');
    p.associateMethod('save', 'src/main/java/store/Book.java', 'store.Book', 'save', ['java.lang.String']);
    await p.openReader();
    await p.read('book'); p.expectReadContains('public class Book'); p.expectReadComplete();
    await p.search('save'); p.expectIncomingToken('save("Dune")', 'save'); p.expectIncomingCount(1); p.expectSearchComplete();
    await p.read('book'); p.expectReadContains('public class Book'); p.expectReadComplete();
    p.expectNativePreparations(1);
    p.expectAnalysisNativeValidations(6);
  });

  it('keeps reuse available through one opened output and reads current ownership', async () => {
    const p = await JavaReaderExamples.output(
      'package store; public class Book { public void save() {} } ' +
      'class Other { public void save() {} void run() { save(); } }');
    await p.recordOwnedType('book', 'src/main/java/store/Book.java', 'store.Book');
    await p.openOutput();
    await p.read('book'); p.expectReadComplete();
    await p.search('book'); p.expectDefinitionType('store.Book'); p.expectSearchComplete();
    await p.read('book'); p.expectReadComplete(); p.expectNativePreparations(1);
    await p.recordOwnedType('book', 'src/main/java/store/Book.java', 'store.Other');
    await p.search('book'); p.expectDefinitionType('store.Other'); p.expectSearchComplete();
    p.expectNativePreparations(2);
  });

  it('an opened output cannot borrow an earlier mapping from invalid ownership', async () => {
    const p = await JavaReaderExamples.output('package store; public class Book {}');
    await p.recordOwnedType('book', 'src/main/java/store/Book.java', 'store.Book');
    await p.openOutput(); await p.search('book'); p.expectDefinitionType('store.Book');
    await p.replaceOwnershipText('{ invalid ownership');
    await p.search('book'); p.expectProblem('invalid-output-state'); p.expectSearchIncomplete();
    p.expectDefinitions([]);
  });

  it('changed bytes replace retained facts even when declared versions are retained', async () => {
    const a = 'package store; public class Book { public String title; public String read() { return title; } }';
    const b = 'package store; public class Book { public String copies; public String read() { return copies; } }';
    const p = await JavaReaderExamples.direct(a);
    p.associateMethod('read', 'src/main/java/store/Book.java', 'store.Book', 'read', []);
    await p.openReader();
    await p.search('read'); p.expectFieldDependency('store.Book', 'title'); p.expectSearchComplete();
    p.replaceSuppliedSourceRetainingVersion(b);
    await p.search('read'); p.expectFieldDependency('store.Book', 'copies'); p.expectSearchComplete();
    p.replaceSuppliedSourceRetainingVersion(a);
    await p.search('read'); p.expectFieldDependency('store.Book', 'title'); p.expectSearchComplete();
    await p.search('read'); p.expectFieldDependency('store.Book', 'title'); p.expectSearchComplete();
    p.expectNativePreparations(3);
  });

  it('a missing subject does not leak findings into a later known subject', async () => {
    const p = await JavaReaderExamples.direct('package store; public class Book {}');
    p.associateType('book', 'src/main/java/store/Book.java', 'store.Book'); await p.openReader();
    await p.read('unknown'); p.expectProblem('mapping-not-found'); p.expectReadIncomplete();
    await p.read('book'); p.expectReadContains('public class Book'); p.expectReadComplete(); p.expectProblems([]);
    p.expectNativePreparations(1);
  });

  it('refuses actual changed JAR bytes before a retained result can be used', async () => {
    const p = await JavaReaderExamples.direct(
      'package store; public class Book { public String read(catalog.Book book) { return book.title; } }',
      { catalogJar: 'public class Book { public String title; }' });
    p.associateMethod('read', 'src/main/java/store/Book.java', 'store.Book', 'read', ['catalog.Book']);
    await p.openReader(); await p.search('read'); p.expectExternalField('catalog.Book', 'title'); p.expectSearchComplete();
    await p.changeActualCatalogJar();
    await p.search('read'); p.expectProblemAtNativeFile('native-input-changed', 'catalog.jar'); p.expectSearchIncomplete();
    p.expectNoResolvedRelationships(); p.expectNativePreparations(1);
  });

  it('refuses actual external mutation between the two native checks on a hit', async () => {
    const p = await JavaReaderExamples.direct(
      'package store; public class Book { public String read(catalog.Book book) { return book.title; } }',
      { catalogSource: 'package catalog; public class Book { public String title; }' });
    p.associateMethod('read', 'src/main/java/store/Book.java', 'store.Book', 'read', ['catalog.Book']);
    await p.openReader(); await p.search('read'); p.expectExternalField('catalog.Book', 'title'); p.expectSearchComplete();
    p.changeActualExternalSourceAfterNextNativeValidation('package catalog; public class Book { public int title; }');
    await p.search('read'); p.expectProblemAtNativeFile('native-input-changed', 'catalog/Book.java'); p.expectSearchIncomplete();
    p.expectNoResolvedRelationships(); p.expectNativePreparations(1);
  });

  it('does not replace a later successful result with an older overlapping completion', async () => {
    const a = 'package store; public class Book { public String title; public String read() { return title; } }';
    const b = 'package store; public class Book { public String copies; public String read() { return copies; } }';
    const p = await JavaReaderExamples.direct(a);
    p.associateMethod('read', 'src/main/java/store/Book.java', 'store.Book', 'read', []); await p.openReader();
    p.holdNextAnswerAfterItsActualFinalNativeValidation();
    const earlier = p.beginSearch('read'); await p.expectEarlierAnswerHeld();
    p.replaceSuppliedSourceRetainingVersion(b);
    await p.search('read'); p.expectFieldDependency('store.Book', 'copies'); p.expectSearchComplete();
    p.releaseEarlierAnswer(); await earlier;
    p.expectEarlierFieldDependency('store.Book', 'title'); p.expectEarlierSearchComplete();
    await p.search('read'); p.expectFieldDependency('store.Book', 'copies'); p.expectSearchComplete();
    p.expectNativePreparations(2);
  });

  it('does not evict a later successful result when an older acquisition is refused', async () => {
    const p = await JavaReaderExamples.direct('package store; public class Book {}');
    p.associateType('book', 'src/main/java/store/Book.java', 'store.Book'); await p.openReader();
    p.replaceSuppliedConfigurationRetainingVersion({ release: 17 });
    p.holdNextAnswerAfterItsActualFirstNativeValidation();
    const earlier = p.beginRead('book'); await p.expectEarlierAnswerHeld();
    p.restoreSuppliedConfiguration();
    await p.read('book'); p.expectReadContains('public class Book'); p.expectReadComplete();
    p.releaseEarlierAnswer(); await earlier;
    p.expectEarlierProblem('unsupported-profile'); p.expectEarlierReadIncomplete();
    await p.read('book'); p.expectReadContains('public class Book'); p.expectReadComplete(); p.expectProblems([]);
    p.expectNativePreparations(1);
  });
});
