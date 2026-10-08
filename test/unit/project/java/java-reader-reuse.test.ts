import { describe, expect, it } from 'vitest';
import { JavaAnalysis } from '../../../../src/project/java/java-analysis.js';
import { expectFields, nativeJava } from '../../../dsl/project/java/java-analysis.js';
import { JavaReaderExamples } from '../../../dsl/project/java/java-reader.js';

describe('owned Java reader facts', { timeout: 90_000 }, () => {
  it('keeps supplied captures and mutable answers separate from retained facts', async () => {
    const p = await JavaReaderExamples.direct('package store; public class Book {}');
    p.associateType('book', 'src/main/java/store/Book.java', 'store.Book'); await p.openReader();
    p.holdNextAnswerAfterItsActualFirstNativeValidation();
    const first = p.beginRead('book'); await p.expectEarlierAnswerHeld();
    p.replaceSuppliedSourceRetainingVersion('package store; public class Other {}');
    p.releaseEarlierAnswer(); await first;
    p.expectEarlierReadContains('public class Book'); p.expectEarlierReadComplete();
    p.mutateEarlierAnswerBytesAndCoverage();
    p.replaceSuppliedSourceRetainingVersion('package store; public class Book {}');
    await p.read('book'); p.expectReadContains('public class Book'); p.expectReadComplete(); p.expectProblems([]);
    p.expectNativePreparations(1);
  });

  it('retries interrupted analysis without retaining its failure or sharing across readers', async () => {
    const p = await JavaReaderExamples.direct('package store; public class Book {}');
    p.associateType('book', 'src/main/java/store/Book.java', 'store.Book'); await p.openReader();
    p.interruptNextActualNativePreparation();
    await p.read('book'); p.expectProblem('native-analysis-failed'); p.expectReadIncomplete();
    await p.read('book'); p.expectReadComplete(); await p.read('book'); p.expectReadComplete();
    p.expectNativePreparations(2);
    await p.openAnotherReader(); await p.read('book'); p.expectReadComplete(); p.expectNativePreparations(3);
    await p.expectNativeProcessesAndScratchDisposed();
  });

  it('validates changed acquisition evidence before reuse and discards the latest refused slot', async () => {
    const p = await JavaReaderExamples.direct('package store; public class Book {}');
    p.associateType('book', 'src/main/java/store/Book.java', 'store.Book'); await p.openReader();
    await p.read('book'); p.expectReadComplete();
    p.replaceSuppliedConfigurationRetainingVersion({ release: 17 });
    await p.read('book'); p.expectProblem('unsupported-profile'); p.expectReadIncomplete(); p.expectNativePreparations(1);
    p.restoreSuppliedConfiguration();
    await p.read('book'); p.expectReadComplete(); p.expectNativePreparations(2);
    p.supplyReadOnlyFileWithIncorrectBodyHash();
    await p.expectReadThrowsTypeError('book'); p.expectNativePreparations(2);
    p.restoreSuppliedReadOnlyFiles();
    await p.read('book'); p.expectReadContains('public class Book'); p.expectReadComplete(); p.expectProblems([]);
    p.expectNativePreparations(3);
  });

  it('an operation still retains several successful captures independently of reader retention', async () => {
    const project = await nativeJava('package store; public class Book { public String title; }');
    const analysis = new JavaAnalysis('expec.java.json');
    expectFields(await analysis.read(project.snapshot), 'store.Book', ['title']);
    project.replaceSourceBytes('package store; public class Book { public int copies; }');
    expectFields(await analysis.read(project.snapshot), 'store.Book', ['copies']);
    project.replaceSourceBytes('package store; public class Book { public String title; }');
    expectFields(await analysis.read(project.snapshot), 'store.Book', ['title']);
    expect(project.nativeAnalyses).toBe(2);
  });
});
