import { afterEach, describe, it } from 'vitest';

import { JavaExamples } from '../../../dsl/project/java/java-output.js';

afterEach(() => JavaExamples.dispose());

describe('explicit Java native prerequisites', () => {
  it('requires an explicitly configured JDK without discarding captured application source', async () => {
    const p = await JavaExamples.connect();
    await p.configureMissingJdk();
    await p.file('src/main/java/store/Store.java', 'package store; public class Store {}');
    await p.capture();
    p.expectProblemAt('native-toolchain-unavailable', 'javaHome'); p.expectCoverageIncomplete();
    p.expectCapturedSource('src/main/java/store/Store.java', 'package store; public class Store {}');
  });
  it('refuses a different Java release instead of silently using the host default', async () => {
    const p = await JavaExamples.connect(); await p.configureUnsupportedRelease(17); await p.capture();
    p.expectProblemAt('unsupported-profile', 'release'); p.expectCoverageIncomplete();
  });
});

describe('native Java questions over captured source', { timeout: 90_000 }, () => {
  it('keeps native query coverage complete for ordinary imported collection types', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    const file = 'src/main/java/store/Basket.java';
    await p.file(file, 'package store;\nimport java.util.Map;\nimport java.util.HashMap;\nclass Basket { private final Map<String, Double> contents = new HashMap<>(); double quantity(String title) { return contents.getOrDefault(title, 0.0); } }');
    p.mapType('basket', file, 'store.Basket');
    await p.search('basket'); p.expectCoverageComplete();
  });

  it('keeps an unavailable imported type unresolved inside a real package', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    const file = 'src/main/java/store/Basket.java';
    await p.file(file, 'package store;\nimport java.util.Missing;\nclass Basket { Missing contents; }');
    p.mapType('basket', file, 'store.Basket');
    await p.search('basket'); p.expectUnresolvedAt('Missing'); p.expectQueryIncomplete();
  });

  it('reports real missing and extra relationships instead of matching native names', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    p.source('class A {}\nclass B {}\nclass C {}\nclass D {}\nclass Use {}');
    const file = 'src/main/java/store/Use.java';
    await p.file(file, 'package store; class A {} class B {} class C {} class D {} class Use { A a; B b; D d; }');
    p.mapAuthoredType('A', file, 'store.A'); p.mapAuthoredType('B', file, 'store.B'); p.mapAuthoredType('C', file, 'store.C');
    p.mapAuthoredType('D', file, 'store.D'); p.mapAuthoredType('Use', file, 'store.Use');
    await p.search('Use'); p.expectCoverageComplete(); p.reconcileOutgoingWith(['A', 'B', 'C']);
    p.expectRelationships(['A', 'B'], ['C'], ['D']);
  });
  it('uses an actual external JAR without inventing editable dependency source', async () => {
    const p = await JavaExamples.connect(); await p.installCatalogJar('public class Book { public String title; }');
    const file = 'src/main/java/store/Read.java';
    await p.file(file, 'package store; class Read { String title(catalog.Book book) { return book.title; } catalog.Book create() { return new catalog.Book(); } }');
    p.mapType('read', file, 'store.Read'); await p.search('read');
    p.expectExternalTarget('catalog.Book', 'title'); p.expectExternalConstructor('catalog.Book', []); p.expectNativeCatalogEvidence([file]); p.expectCoverageComplete();
  });
  it('refuses changed native input before a direct query uses its old capture', async () => {
    const p = await JavaExamples.connect(); await p.installCatalogJar('public class Book { public String title; }');
    const file = 'src/main/java/store/Read.java';
    await p.file(file, 'package store; class Read { String title(catalog.Book book) { return book.title; } }');
    p.mapType('read', file, 'store.Read'); await p.search('read'); p.expectCoverageComplete(); p.rememberCapture();
    await p.replaceCatalogJar('public class Book { public int title; }');
    await p.searchUsingRememberedCapture('read'); p.expectNativeInputChanged(); p.expectQueryIncomplete();
    await p.readUsingRememberedCapture('read'); p.expectReadIncomplete();
  });
  it('reads the complete current shared source including handwritten private code', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    const text = 'package store; class StoreGame { private String note="Dune"; void save(String title){ System.out.print(title+note); } } class Other {}';
    await p.file('src/main/java/store/Game.java', text);
    p.mapType('game', 'src/main/java/store/Game.java', 'store.StoreGame');
    await p.read('game'); p.expectReadText('src/main/java/store/Game.java', text);
    await p.file('src/main/java/store/Game.java', text.replace('Dune', 'Dune Messiah'));
    await p.read('game'); p.expectReadText('src/main/java/store/Game.java', text.replace('Dune', 'Dune Messiah'));
  });
  it('finds real unmodeled callers and ignores a same-spelled method', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    await p.file('src/main/java/store/StoreGame.java', 'package store; public class StoreGame { public void save(String title) {} }');
    await p.file('src/main/java/store/Launcher.java', 'package store; class Launcher { void run() { new StoreGame().save("Dune"); } } class Other { void save(String title) {} void run() { save("Other"); } }');
    p.mapMethod('save', 'src/main/java/store/StoreGame.java', 'store.StoreGame', 'save', ['java.lang.String']);
    await p.search('save');
    p.expectIncomingToken('src/main/java/store/Launcher.java', 'save("Dune")', 'save', 'project');
    p.expectIncomingCount(1); p.expectCoverageComplete();
  });
  it('keeps overloaded calls and method references bound to the exact method', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    await p.file('src/main/java/store/Store.java', 'package store; class Store { void save(String title) {} void save(double quantity) {} void run() { save("Dune"); save(1.0); java.util.function.Consumer<String> action=this::save; } }');
    p.mapMethod('title-save', 'src/main/java/store/Store.java', 'store.Store', 'save', ['java.lang.String']);
    await p.search('title-save');
    p.expectIncomingToken('src/main/java/store/Store.java', 'save("Dune")', 'save', 'project');
    p.expectIncomingToken('src/main/java/store/Store.java', 'this::save', 'save', 'project');
    p.expectIncomingCount(2); p.expectCoverageComplete();
  });
  it('reports the implicit Iterable protocol at the actual enhanced-for expression', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    const file = 'src/main/java/store/Books.java';
    await p.file(file, 'package store; class Books implements Iterable<String> { public java.util.Iterator<String> iterator() { return java.util.List.of("Dune").iterator(); } void read(Books books) { for (String title : books) { System.out.print(title); } } }');
    p.mapMethod('iterator', file, 'store.Books', 'iterator', []); await p.search('iterator');
    p.expectNativeLimitationAt('implicit-native-reference', file, 'for (String title : books)', 'books');
    p.expectIncomingCount(0); p.expectQueryIncomplete();
  });
  it('reports implicit resource close without inventing an editable close token', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    const file = 'src/main/java/store/Basket.java';
    await p.file(file, 'package store; class Basket implements AutoCloseable { public void close() {} void run(Basket basket) { try (basket) { System.out.print("Dune"); } } }');
    p.mapMethod('close', file, 'store.Basket', 'close', []); await p.search('close');
    p.expectNativeLimitationAt('implicit-native-reference', file, 'try (basket)', 'basket');
    p.expectIncomingCount(0); p.expectQueryIncomplete();
  });
  it('keeps array enhanced-for complete because it has no user iterator protocol', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    const file = 'src/main/java/store/Basket.java';
    await p.file(file, 'package store; class Basket { void save(String title) {} void run(String[] titles) { for (String title : titles) { save(title); } } }');
    p.mapMethod('save', file, 'store.Basket', 'save', ['java.lang.String']); await p.search('save');
    p.expectIncomingToken(file, 'save(title)', 'save', 'project'); p.expectIncomingCount(1); p.expectCoverageComplete();
  });
  it('preserves exact source locations after BOM and non-BMP text', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    const file = 'src/main/java/store/Store.java', text = '\uFEFFpackage store; // 🪐\r\nclass Store { void save() {} void run() { save(); } }';
    await p.file(file, text); p.mapMethod('save', file, 'store.Store', 'save', []);
    await p.search('save'); p.expectIncomingToken(file, 'save();', 'save', 'project'); p.expectCoverageComplete();
    await p.read('save'); p.expectReadText(file, text);
  });
  it('retains unresolved native names and reflection coverage limitations', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    await p.file('src/main/java/store/Store.java', 'package store; class Store { void save() {} void run() throws Exception { Missing.call(); Store.class.getDeclaredMethod("save").invoke(this); } }');
    p.mapMethod('save', 'src/main/java/store/Store.java', 'store.Store', 'save', []);
    await p.search('save'); p.expectUnresolvedAt('Missing'); p.expectReflectionLimitationAt('getDeclaredMethod'); p.expectQueryIncomplete();
  });
  it('does not let a main source borrow a test-only type', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    await p.file('src/test/java/store/Fixture.java', 'package store; public class Fixture {}');
    await p.file('src/main/java/store/Store.java', 'package store; public class Store { Fixture fixture; }');
    p.mapType('store', 'src/main/java/store/Store.java', 'store.Store');
    await p.search('store'); p.expectUnresolvedAt('Fixture'); p.expectQueryIncomplete();
  });
  it('attributes an unmodeled method to its actually mapped class owner', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    await p.file('src/main/java/store/Store.java', 'package store; class Store { void save() {} }');
    await p.file('src/main/java/store/Launcher.java', 'package store; class Launcher { void run() { new Store().save(); } }');
    p.mapMethod('save', 'src/main/java/store/Store.java', 'store.Store', 'save', []);
    p.mapType('launcher', 'src/main/java/store/Launcher.java', 'store.Launcher');
    await p.search('save'); p.expectIncomingOwner('launcher'); p.expectCoverageComplete();
  });
  it('binds a selected parameter without borrowing a same-named field or another overload', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    const file = 'src/main/java/store/Store.java';
    await p.file(file, 'package store; class Store { String title; void save(String title) { System.out.print(title); System.out.print(this.title); } void save(double title) { System.out.print(title); } }');
    p.mapParameter('title', file, 'store.Store', 'save', ['java.lang.String'], 0);
    await p.search('title'); p.expectIncomingToken(file, 'print(title)', 'title', 'project');
    p.expectIncomingCount(1); p.expectCoverageComplete();
  });
  it('names only its selected source roots as searched scope', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    const file = 'src/main/java/store/Store.java';
    await p.file(file, 'package store; class Store {}');
    await p.file('examples/NotSelected.java', 'not valid native source');
    p.mapType('store', file, 'store.Store'); await p.search('store');
    p.expectSourceScope([file]); p.expectCoverageComplete();
  });
  it('keeps project-only native identities stable across repeated queries', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    const file = 'src/main/java/store/Store.java';
    await p.file(file, 'package store; class Store { String read(String title) { return title; } }');
    p.mapType('store', file, 'store.Store'); await p.search('store'); p.expectCoverageComplete(); p.rememberSearch();
    await p.search('store'); p.expectSameSearch();
  });
  it('binds constructor calls and references to their exact native signature', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    const file = 'src/main/java/store/Book.java';
    await p.file(file, 'package store; class Book { Book(String title) {} Book(double number) {} } class Reader { void read() { new Book("Dune"); new Book(1); java.util.function.Function<String,Book> factory=Book::new; } }');
    p.mapConstructor('book-title', file, 'store.Book', ['java.lang.String']); await p.search('book-title');
    p.expectIncomingToken(file, 'new Book("Dune")', 'Book', 'project');
    p.expectIncomingToken(file, 'Book::new', 'Book', 'project'); p.expectIncomingCount(2); p.expectCoverageComplete();
  });
});

describe('Java read-only source dependencies retain their origin', { timeout: 90_000 }, () => {
  it('attributes a real source-backed library member to its authorized external file', async () => {
    const p = await JavaExamples.connect();
    await p.installExternalSource('catalog/Book.java', 'package catalog; public class Book { public String title; }');
    const file = 'src/main/java/store/Read.java';
    await p.file(file, 'package store; class Read { String title(catalog.Book book) { return book.title; } }');
    p.mapType('read', file, 'store.Read'); await p.search('read');
    p.expectExternalSourceTarget('catalog.Book', 'title'); p.expectNativeSourceEvidence([file]); p.expectCoverageComplete();
  });
  it('retains the actual read-only caller location without claiming editable source ownership', async () => {
    const p = await JavaExamples.connect();
    const file = 'src/main/java/store/Store.java';
    await p.file(file, 'package store; public class Store { public void save(String title) {} }');
    await p.installExternalSource('catalog/Caller.java', 'package catalog; public class Caller { void run(store.Store store) { store.save("Dune"); } }');
    p.mapMethod('save', file, 'store.Store', 'save', ['java.lang.String']); await p.search('save');
    await p.expectReadonlyIncoming('catalog.Caller', 'store.save("Dune")', 'save'); p.expectIncomingCount(1); p.expectCoverageComplete();
  });
});

it('keeps unrelated upstream evidence guarded without treating it as Java source authority', { timeout: 90_000 }, async () => {
  const p = await JavaExamples.connect(); await p.installNativeProfile(); await p.useUpstreamEvidence();
  const file = 'src/main/java/store/Store.java'; await p.file(file, 'package store; class Store {}');
  p.mapType('store', file, 'store.Store'); await p.search('store'); p.expectCoverageComplete(); p.expectSourceScope([file]);
  p.expectUpstreamEvidenceRetained();
});

it('refuses contradictory upstream and Java fingerprints for the same actual native file', { timeout: 90_000 }, async () => {
  const p = await JavaExamples.connect(); await p.installNativeProfile(); await p.useConflictingUpstreamEvidence();
  await p.capture(); p.expectNativeEvidenceConflict();
});

it('uses primitive spelling and array dimensions in exact native overload selectors', { timeout: 120_000 }, async () => {
  const p = await JavaExamples.connect(); await p.installNativeProfile();
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public void save(double[] copies, boolean active) {} public void save(String title) {} void run() { save(new double[]{1}, true); save("Dune"); } }');
  p.mapMethod('save-copies', file, 'store.Store', 'save', ['double[]', 'boolean']);
  await p.search('save-copies'); p.expectIncomingToken(file, 'save(new double[]{1}, true)', 'save', 'project'); p.expectIncomingCount(1); p.expectCoverageComplete();
});
