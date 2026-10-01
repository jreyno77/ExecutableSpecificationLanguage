import { expect } from 'vitest';
import type { AcceptedSource } from '../../src/index.js';
import { SourceReadingDriver } from '../driver/source-reading.js';

type ConceptExpectation = { quoted: boolean; at: { line: number; column: number } };

/** Domain actions and expectations for an author reading a specification. */
export class SourceReading {
  private readonly driver = new SourceReadingDriver();
  sourceIs(text: string): void { this.driver.sourceIs(text); }
  readSource(): void { this.driver.readSource(); }

  expectConceptNamed(name: string, expected: ConceptExpectation): void {
    this.acceptedResult();
    const declaration = this.driver.conceptNamed(name);
    expect(declaration, `the specification declares the concept ${name}`).toBeDefined();
    if (declaration?.payload.kind !== 'concept') throw new Error(`No concept named ${name} was observed.`);
    const declaredName = this.driver.nodeFor(declaration.payload.name);
    expect(declaredName?.payload).toEqual({ kind: 'name', decoded: name, quoted: expected.quoted });
    expect(declaredName?.range).toMatchObject({ sourceId: this.driver.originalSource!.sourceId, start: expected.at });
  }
  expectOriginalSourcePreserved(): void { expect(this.acceptedResult().document).toEqual(this.driver.originalSource); }
  expectGrammarVersion(version: AcceptedSource['grammarVersion']): void { expect(this.acceptedResult().grammarVersion).toBe(version); }

  private acceptedResult(): AcceptedSource {
    expect(this.driver.result?.status, 'the author can read this specification').toBe('accepted');
    return this.driver.acceptedResult();
  }
}
