import { expect } from 'vitest';
import { SourceReadingDriver } from '../driver/source-reading.js';

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
