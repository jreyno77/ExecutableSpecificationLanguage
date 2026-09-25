import { expect } from 'vitest';
import { createSyntaxReader } from '../../src/index.js';
import type { AcceptedSource, ReadResult, SourceDocument, SourceNode, SourceNodeId } from '../../src/index.js';
import { sourceFixture } from './source-fixture.js';

type ConceptExpectation = {
  quoted: boolean;
  at: { line: number; column: number };
};

/** Domain actions and observations for an author reading a specification. */
export class SourceReading {
  private readonly reader = createSyntaxReader();
  private source: SourceDocument | undefined;
  private originalSource: SourceDocument | undefined;
  private result: ReadResult | undefined;

  sourceIs(fixture: string): void {
    this.source = sourceFixture(fixture, 'grammar');
    this.originalSource = structuredClone(this.source);
    this.result = undefined;
  }

  readSource(): void {
    if (!this.source) throw new Error('Supply a specification before reading it.');
    this.result = this.reader.read(this.source);
  }

  expectConceptNamed(name: string, expected: ConceptExpectation): void {
    const result = this.acceptedResult();
    const declaration = result.description.nodes.find(node => {
      if (node.payload.kind !== 'concept') return false;
      const declaredName = this.nodeFor(node.payload.name);
      return declaredName?.payload.kind === 'name' && declaredName.payload.decoded === name;
    });
    expect(declaration, `the specification declares the concept ${name}`).toBeDefined();
    if (declaration?.payload.kind !== 'concept') throw new Error(`No concept named ${name} was observed.`);

    const declaredName = this.nodeFor(declaration.payload.name);
    expect(declaredName?.payload).toEqual({ kind: 'name', decoded: name, quoted: expected.quoted });
    expect(declaredName?.range).toMatchObject({ sourceId: this.originalSource!.sourceId, start: expected.at });
  }

  expectOriginalSourcePreserved(): void {
    expect(this.acceptedResult().document).toEqual(this.originalSource);
  }

  expectGrammarVersion(version: AcceptedSource['grammarVersion']): void {
    expect(this.acceptedResult().grammarVersion).toBe(version);
  }

  private acceptedResult(): AcceptedSource {
    expect(this.result?.status, 'the author can read this specification').toBe('accepted');
    if (this.result?.status !== 'accepted') throw new Error('The reader did not accept the supplied specification.');
    return this.result;
  }

  private nodeFor(id: SourceNodeId): SourceNode | undefined {
    return this.acceptedResult().description.nodes.find(node => node.id.sourceId === id.sourceId && node.id.ordinal === id.ordinal);
  }
}
