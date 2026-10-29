import { expect } from 'vitest';
import type { SourceRange, SyntaxDiagnostic } from '../../../src/index.js';
import { SourceReadingDriver } from '../../driver/language/source-reading.js';

/** Domain actions and observations for an author reading a specification. */
export class SourceReading {
  private readonly driver = new SourceReadingDriver();
  sourceIs(text: string): void { this.driver.sourceIs(text); }
  readSource(): void { this.driver.readSource(); }
  expectConceptNamed(name: string, expected: { quoted: boolean; at: { line: number; column: number } }): void {
    const declaredName = this.driver.conceptName(name);
    expect(declaredName, `the specification declares the concept ${name}`).toMatchObject({ kind: 'name', decoded: name, quoted: expected.quoted });
    expect(declaredName?.origin).toMatchObject({ kind: 'source', range: { sourceId: this.driver.originalSource!.sourceId, start: expected.at } });
  }
  expectSyntaxProblem(expected: {
    category: SyntaxDiagnostic['category'];
    primaryRange: Pick<SourceRange, 'start' | 'end'>;
    relatedRanges: readonly Pick<SourceRange, 'start' | 'end'>[];
  }): void {
    const result = this.driver.result;
    expect(result?.status, 'the author receives a located syntax problem').toBe('rejected');
    if (result?.status !== 'rejected') throw new Error('The reader did not reject the supplied specification.');
    expect(result.diagnostics).toHaveLength(1);
    const problem = result.diagnostics[0]!;
    const sourceId = this.driver.originalSource!.sourceId;
    expect(problem.explanation.trim()).not.toBe('');
    expect(problem.category).toBe(expected.category);
    expect(problem.primaryRange).toEqual({ sourceId, ...expected.primaryRange });
    expect(problem.relatedRanges).toEqual(expected.relatedRanges.map(range => ({ sourceId, ...range })));
  }
  expectFirstSyntaxProblemAt(token: string, at: { line: number; column: number }): void {
    expect(this.driver.result?.status, 'the malformed source is rejected').toBe('rejected');
    const problem = this.driver.syntaxProblems()[0];
    if (!problem) throw new Error('The reader supplied no syntax diagnostic.');
    expect(problem.category).toBe('expected-token');
    expect(this.driver.syntaxProblemText(problem)).toBe(token);
    expect(problem.primaryRange).toMatchObject({ sourceId: this.driver.originalSource!.sourceId,
      start: at, end: { line: at.line, column: at.column + Array.from(token).length } });
    expect(problem.explanation).toContain(token);
    expect(problem.explanation).not.toMatch(/\bEOF\b|end of file/i);
  }
  expectSyntaxProblemTokens(expected: readonly string[]): void {
    expect(this.driver.result?.status, 'independently malformed declarations are rejected').toBe('rejected');
    const problems = this.driver.syntaxProblems();
    expect(problems.map(problem => this.driver.syntaxProblemText(problem))).toEqual(expected);
    for (const problem of problems) expect(problem.explanation.trim()).not.toBe('');
  }
  expectOriginalSourcePreserved(): void {
    const result = this.acceptedResult();
    expect(result.document.source).toEqual(this.driver.originalSource);
    expect(this.driver.source).toEqual(this.driver.originalSource);
  }
  expectGrammarVersion(version: string): void { expect(this.acceptedResult().grammarVersion).toBe(version); }
  private acceptedResult() {
    expect(this.driver.result?.status, 'the author can read this specification').toBe('accepted');
    if (this.driver.result?.status !== 'accepted') throw new Error('The reader did not accept the supplied specification.');
    return this.driver.result;
  }
}
