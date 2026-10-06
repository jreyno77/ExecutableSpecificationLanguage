import { afterEach, describe, it } from 'vitest';

import { JavaPreservation } from '../../../dsl/project/java/java-preservation.js';

afterEach(() => JavaPreservation.dispose());

describe('Java contract changes preserve native implementations', { timeout: 120_000 }, () => {
  it('adopts a mapped native implementation without copying its body into the generated baseline', async () => {
    const p = await JavaPreservation.connect();
    p.source('class Store { public title\ncapability title() returns Text }');
    const file = 'src/main/java/store/Store.java';
    await p.file(file, 'package store; public class Store { private final String chosen = "Dune"; public String title() { return chosen; } }');
    p.mapStore(file, 'store.Store', 'title', []); await p.rememberFile(file); await p.adopt();
    p.expectWritten(); p.expectFileUnchanged(file); p.expectGeneratedBaselineExcludes('return chosen;'); await p.runJava('System.out.print(new store.Store().title());'); p.expectStdout('Dune');
  });
  it('adds a visible unfinished operation while keeping the existing implementation', async () => {
    const p = await JavaPreservation.connect();
    p.source('class Store { public title\ncapability title() returns Text }');
    const file = 'src/main/java/store/Store.java';
    await p.file(file, 'package store; public class Store { public String title() { return "Dune"; } }');
    p.mapStore(file, 'store.Store', 'title', []); await p.adopt(); p.expectWritten();
    await p.update('class Store { public title, save\ncapability title() returns Text\ncapability save(title: Text) returns Nothing }');
    p.expectWritten(); p.expectText(file, 'return "Dune";'); await p.runJava('System.out.print(new store.Store().title());'); p.expectStdout('Dune');
    await p.runJava('new store.Store().save("Dune");'); p.expectStub('save');
  });
  it('renames the actual method and its unmodeled caller while preserving unrelated same-spelled code', async () => {
    const p = await JavaPreservation.connect();
    p.source('class Store { public title\ncapability title() returns Text }');
    const file = 'src/main/java/store/Store.java', caller = 'src/main/java/store/Launcher.java';
    await p.file(file, 'package store; public class Store { public String title() { return "Dune"; } }');
    await p.file(caller, 'package store; public class Launcher { public String read(Store store) { return store.title(); } } class Other { String title() { return "Other"; } String read() { return title(); } }');
    p.mapStore(file, 'store.Store', 'title', []); await p.adopt(); p.expectWritten();
    await p.update('class Store { public bookTitle\ncapability bookTitle() returns Text }', ['title', 'bookTitle']);
    p.expectWritten(); p.expectText(file, 'return "Dune";'); p.expectText(caller, 'store.bookTitle()'); p.expectText(caller, 'return title();');
    await p.runJava('System.out.print(new store.Launcher().read(new store.Store()));'); p.expectStdout('Dune');
  });
});

it('updates promises while preserving the implemented body and handwritten documentation', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save(title: Text) returns Nothing { promises "Save to disk." } }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { /** Keep the local retry policy. */ public void save(String title) { System.out.print("local:"+title); } }');
  p.mapStore(file, 'store.Store', 'save', ['java.lang.String']); await p.adopt(); p.expectWritten();
  p.expectAuthoredObligation('verification-required', 'save', 'Save to disk.');
  await p.update('class Store { public save\ncapability save(title: Text) returns Nothing { promises "Persist the snapshot using Supabase." } }');
  p.expectWritten(); p.expectText(file, 'Keep the local retry policy.'); p.expectText(file, 'Persist the snapshot using Supabase.');
  p.expectAuthoredObligation('verification-required', 'save', 'Persist the snapshot using Supabase.');
  p.expectText(file, 'Unverified implementation obligation.');
  await p.runJava('new store.Store().save("Dune");'); p.expectStdout('local:Dune');
});

it('changes a parameter type without erasing its comment or repairing the authored body', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save(title: Text) returns Nothing }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public void save(/* rationale */ String title) { System.out.print(title.toUpperCase()); } }');
  p.mapStore(file, 'store.Store', 'save', ['java.lang.String']); await p.adopt(); p.expectWritten();
  await p.update('class Store { public save\ncapability save(title: Number) returns Nothing }');
  p.expectWritten(); p.expectText(file, '/* rationale */'); p.expectText(file, 'double title'); p.expectText(file, 'title.toUpperCase()'); p.expectImplementationProblem(file,'title.toUpperCase()','double');
  await p.runJava('new store.Store().save(1);'); p.expectNativeProblem('double cannot be dereferenced');
});

it('adds a parameter while retaining the actual existing implementation', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save(title: Text) returns Nothing }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public void save(/* title rationale */ String title) { System.out.print(title); } }');
  p.mapStore(file, 'store.Store', 'save', ['java.lang.String']); await p.adopt(); p.expectWritten();
  await p.update('class Store { public save\ncapability save(title: Text, copies: Number) returns Nothing }');
  p.expectWritten(); p.expectText(file, '/* title rationale */');
  await p.runJava('new store.Store().save("Dune",2);'); p.expectStdout('Dune');
});

it('refuses to discard a handwritten comment on a removed parameter', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save(title: Text, copies: Number) returns Nothing }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public void save(String title, /* copy rationale */ double copies) {} }');
  p.mapStore(file, 'store.Store', 'save', ['java.lang.String', 'double']); await p.adopt(); p.expectWritten(); await p.rememberWrites();
  await p.update('class Store { public save\ncapability save(title: Text) returns Nothing }', undefined, ['copies']);
  p.expectConflictAt(file, 'copy rationale'); await p.expectNoWrites();
});

it('removes an uncommented unused parameter while retaining the adopted method body', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save(title: Text, copies: Number) returns Nothing }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public void save(String title, double copies) { System.out.print(title); } }');
  p.mapStore(file, 'store.Store', 'save', ['java.lang.String','double']); await p.adopt(); p.expectWritten();
  await p.update('class Store { public save\ncapability save(title: Text) returns Nothing }', undefined, ['copies']); p.expectWritten();
  await p.runJava('new store.Store().save("Dune");'); p.expectStdout('Dune');
});

it('adds a top-level function to its shared generated class without replacing another implementation', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect(); p.source('function title() returns Text'); await p.generate(); p.expectWritten();
  const file = 'src/main/java/store/Functions.java';
  await p.file(file, 'package store; public final class Functions { private Functions() {} public static String title() { return "Dune"; } }');
  await p.update('function title() returns Text\nfunction save(title: Text) returns Nothing'); p.expectWritten();
  await p.runJava('System.out.print(store.Functions.title());'); p.expectStdout('Dune');
  await p.runJava('store.Functions.save("Dune");'); p.expectStub('save');
});
