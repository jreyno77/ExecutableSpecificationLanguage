import { afterEach, describe, it } from 'vitest';

import { JavaPreservation } from '../../../dsl/project/java/java-preservation.js';

afterEach(() => JavaPreservation.dispose());

it('does not schedule writes when an adopted contract and baseline are already current', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public title\ncapability title() returns Text }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public String title() { return "Dune"; } }');
  p.mapStore(file, 'store.Store', 'title', []); await p.adopt(); p.expectWritten();
  await p.planRepeat(); p.expectNoPlanChanges();
});

it('repeats an unchanged error family and its generated exception companion without writes', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect(); p.source('error type Rejected<T> { code: "rejected"\npayload: T }');
  await p.generate(); p.expectWritten(); await p.planRepeat(); p.expectNoPlanChanges();
});

it('does not adopt a same-spelled method merely because its class is mapped', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect(); p.source('class Store { public title\ncapability title() returns Text }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public String title() { return "Dune"; } }');
  p.mapOwner(file, 'store.Store'); await p.rememberWrites(); await p.adopt();
  p.expectConflictAt(file, 'title'); await p.expectNoWrites();
});

it('refuses swapped parameter names even when their native types agree', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save(first: Text, second: Text) returns Nothing }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public void save(String second, String first) { System.out.print(first+second); } }');
  p.mapStore(file, 'store.Store', 'save', ['java.lang.String','java.lang.String']); await p.rememberWrites(); await p.adopt();
  p.expectConflictAt(file, 'second'); await p.expectNoWrites();
});

describe('Java mappings extend without retargeting existing ownership', { timeout: 150_000 }, () => {
  it('adds a mapping for a new declaration while retaining existing native bytes', async () => {
    const p=await JavaPreservation.connect(); p.source('class Store {}'); await p.generate(); p.expectWritten();
    await p.rememberFile('src/main/java/store/Store.java'); p.configureOutput({names:[{declaration:['Shelf'],name:'BookShelf'}]});
    await p.update('class Store {}\nclass Shelf {}'); p.expectWritten(); p.expectFileUnchanged('src/main/java/store/Store.java');
    p.expectText('src/main/java/store/BookShelf.java','public class BookShelf');
    await p.runJava('System.out.print(new store.BookShelf().getClass().getSimpleName());'); p.expectStdout('BookShelf');
  });
  it('accepts a redundant exact mapping without changing the owned declaration', async () => {
    const p=await JavaPreservation.connect(); p.source('class Store {}'); await p.generate(); p.expectWritten();
    await p.rememberFile('src/main/java/store/Store.java'); p.configureOutput({names:[{declaration:['Store'],name:'Store'}]});
    await p.update('class Store {}'); p.expectWritten(); p.expectFileUnchanged('src/main/java/store/Store.java');
  });
  it('refuses a new mapping that would retarget an already-owned declaration', async () => {
    const p=await JavaPreservation.connect(); p.source('class Store {}'); await p.generate(); p.expectWritten(); await p.rememberWrites();
    p.configureOutput({names:[{declaration:['Store'],name:'OtherStore'}]}); await p.update('class Store {}');
    p.expectProblemCode('output-options-changed'); await p.expectNoWrites();
  });
  it('follows an authored rename selector only while retaining its exact native mapping', async () => {
    const p=await JavaPreservation.connect(); p.source('class Store {}'); await p.generate({names:[{declaration:['Store'],name:'NativeStore'}]}); p.expectWritten();
    await p.rememberFile('src/main/java/store/NativeStore.java'); p.configureOutput({names:[{declaration:['Shop'],name:'NativeStore'}]});
    await p.update('class Shop {}',['Store','Shop']); p.expectWritten(); p.expectFileUnchanged('src/main/java/store/NativeStore.java');
    await p.rememberWrites(); p.configureOutput({names:[{declaration:['Shop'],name:'OtherStore'}]}); await p.update('class Shop {}');
    p.expectProblemCode('output-options-changed'); await p.expectNoWrites();
  });
});
