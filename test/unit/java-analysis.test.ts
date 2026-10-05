import { describe, expect, it } from 'vitest';
import { JavaAnalysis } from '../../src/project/java/java-analysis.js';
import { nativeJava, expectFields, expectFieldUse, expectRefusedAnalysis } from '../dsl/java-analysis.js';

describe('Java analysis owned by one caller operation', { timeout: 90_000 }, () => {
  it('reuses actual Java facts without sharing a returned answer', async () => {
    const project = await nativeJava('package store; public class Book { public String title; }');
    const analysis = new JavaAnalysis('expec.java.json');
    const first = await analysis.read(project.snapshot);
    expectFields(first, 'store.Book', ['title']);
    first.facts.declarations.length = 0;

    const second = await analysis.read(project.snapshot);
    expectFields(second, 'store.Book', ['title']);
    expect(first.facts.declarations).toEqual([]);
    expect(project.nativeAnalyses).toBe(1);
  });

  it('analyzes changed source bytes even when its supplied version label is unchanged', async () => {
    const project = await nativeJava('package store; public class Book { public String title; }');
    const analysis = new JavaAnalysis('expec.java.json');
    expectFields(await analysis.read(project.snapshot), 'store.Book', ['title']);

    project.replaceSourceBytes('package store; public class Book { public int copies; }');
    expectFields(await analysis.read(project.snapshot), 'store.Book', ['copies']);
    expect(project.nativeAnalyses).toBe(2);
  });

  it('owns the supplied source before waiting for native validation', async () => {
    const project = await nativeJava('package store; public class Book { public String title; }');
    const analysis = new JavaAnalysis('expec.java.json');
    const pending = analysis.read(project.snapshot);
    project.replaceSourceBytes('package store; public class Book { public int copies; }');

    expectFields(await pending, 'store.Book', ['title']);
    expectFields(await analysis.read(project.snapshot), 'store.Book', ['copies']);
  });

  it('refuses an earlier answer after its actual dependency JAR changes', async () => {
    const project = await nativeJava('package store; public class Book { String title(catalog.Book book) { return book.title; } }', {
      catalogJar: 'public class Book { public String title; }',
    });
    const analysis = new JavaAnalysis('expec.java.json');
    expectFieldUse(await analysis.read(project.snapshot), 'catalog.Book', 'title');

    await project.changeCatalogJarBytes();
    expectRefusedAnalysis(await analysis.read(project.snapshot), 'native-input-changed');
    expect(project.nativeAnalyses).toBe(1);
  });

  it('refuses reuse when actual external source changes after its first fresh validation', async () => {
    const project = await nativeJava('package store; public class Book { String title(catalog.Book book) { return book.title; } }', {
      catalogSource: 'package catalog; public class Book { public String title; }',
    });
    const analysis = new JavaAnalysis('expec.java.json');
    expectFieldUse(await analysis.read(project.snapshot), 'catalog.Book', 'title');

    project.changeExternalSourceAfterNextValidation('package catalog; public class Book { public int copies; }');
    expectRefusedAnalysis(await analysis.read(project.snapshot), 'native-input-changed');
    expect(project.nativeAnalyses).toBe(1);
  });

  it('retries the same source after an actual native analysis is interrupted', async () => {
    const project = await nativeJava('package store; public class Book { public String title; }');
    const analysis = new JavaAnalysis('expec.java.json');
    project.interruptNextNativeAnalysis();
    expectRefusedAnalysis(await analysis.read(project.snapshot), 'native-analysis-failed');

    expectFields(await analysis.read(project.snapshot), 'store.Book', ['title']);
    expect(project.nativeAnalyses).toBe(2);
  });

  it('keeps analysis reuse inside the caller operation that owns it', async () => {
    const project = await nativeJava('package store; public class Book { public String title; }');
    const firstOperation = new JavaAnalysis('expec.java.json');
    expectFields(await firstOperation.read(project.snapshot), 'store.Book', ['title']);

    const nextOperation = new JavaAnalysis('expec.java.json');
    expectFields(await nextOperation.read(project.snapshot), 'store.Book', ['title']);
    expect(project.nativeAnalyses).toBe(2);
  });
});
