import { afterEach, it } from 'vitest';

import { JavaPreservation } from '../dsl/java-preservation.js';

afterEach(() => JavaPreservation.dispose());

it('keeps an adopted throwing body manual when its contract is removed', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save(title: Text) returns Nothing }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public void save(String title) { throw new java.lang.UnsupportedOperationException("Not implemented: save"); } }');
  p.mapStore(file, 'store.Store', 'save', ['java.lang.String']); await p.adopt(); p.expectWritten(); await p.rememberWrites();
  await p.update('class Store {}', undefined, ['save']);
  p.expectConflictAt(file, 'save'); await p.expectNoWrites();
});

it('deletes an unused untouched generated contract', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect(); p.source('class Store {}');
  await p.generate(); p.expectWritten();
  await p.remove('Store'); p.expectDeletionWritten(); p.expectFileAbsent('src/main/java/store/Store.java');
});

it('refuses to delete a generated class with an actual unmodeled caller', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect(); p.source('class Store {}'); await p.generate(); p.expectWritten();
  const caller = 'src/main/java/store/Launcher.java';
  await p.file(caller, 'package store; public class Launcher { Store make() { return new Store(); } }');
  await p.rememberWrites(); await p.remove('Store');
  p.expectConflictAt(caller, 'Store'); await p.expectNoWrites();
});

it('refuses deletion after the owned generated class acquires handwritten code', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect(); p.source('class Store {}'); await p.generate(); p.expectWritten();
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { private String title = "Dune"; }');
  await p.rememberWrites(); await p.remove('Store');
  p.expectConflictAt(file, 'Store'); await p.expectNoWrites();
});

it('inserts and deletes a generated record without changing an adopted implementation', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  const contract = 'class Store { public title\ncapability title() returns Text }';
  p.source(contract); const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public String title() { return "Dune"; } }');
  p.mapStore(file, 'store.Store', 'title', []); await p.adopt(); p.expectWritten(); await p.rememberFile(file);
  await p.insert(contract + '\ntype Book { title: Text }'); p.expectWritten(); p.expectFileUnchanged(file);
  await p.runJava('System.out.print(new store.Book("Dune").title()+new store.Store().title());'); p.expectStdout('DuneDune');
  await p.remove('Book'); p.expectDeletionWritten(['Store', 'title']); p.expectFileAbsent('src/main/java/store/Book.java'); p.expectFileUnchanged(file);
});

it('refuses moving an implemented capability to another owner', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save(title: Text) returns Nothing }\nclass Archive {}');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public void save(String title) { System.out.print(title); } }');
  p.mapStore(file, 'store.Store', 'save', ['java.lang.String']); await p.adopt(); p.expectWritten();
  await p.rememberWrites();
  await p.update('class Store {}\nclass Archive { public save\ncapability save(title: Text) returns Nothing }', ['save', 'save']);
  p.expectProblemCode('implemented-move'); p.expectConflictAt(file, 'save'); await p.expectNoWrites();
});

it('preserves a standalone class comment and refuses ambiguous duplicate obligation documentation', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save() returns Nothing { promises "Save to disk." } }'); await p.generate(); p.expectWritten();
  const file = 'src/main/java/store/Store.java';
  await p.annotateGeneratedClass(file, 'Keep this migration rationale.', 'Save to disk.'); await p.rememberWrites();
  await p.remove('Store'); p.expectConflictAt(file, 'Keep this migration rationale.');
  p.expectProblemCode('ambiguous-documentation'); await p.expectNoWrites();
});
