import { LangiumModel, LangiumReader, type ReadResult, type SourceDocument, type SyntaxDiagnostic } from '../../../src/index.js';

export class SourceReadingDriver {
  private readonly reader = new LangiumReader();
  source: SourceDocument | undefined;
  originalSource: SourceDocument | undefined;
  result: ReadResult | undefined;

  sourceIs(text: string): void {
    this.source = { sourceId: 'memory:example', text };
    this.originalSource = { ...this.source };
    this.result = undefined;
  }
  readSource(): void {
    if (!this.source) throw new Error('Supply a specification before reading it.');
    this.result = this.reader.read(this.source);
  }
  syntaxProblems(): readonly SyntaxDiagnostic[] {
    if (this.result?.status !== 'rejected') throw new Error('Expected rejected source with syntax diagnostics.');
    return this.result.diagnostics;
  }
  syntaxProblemText(problem: SyntaxDiagnostic): string {
    if (!this.originalSource) throw new Error('Supply a specification before reading a diagnostic.');
    return Array.from(this.originalSource.text)
      .slice(problem.primaryRange.start.offset, problem.primaryRange.end.offset).join('');
  }
  conceptName(name: string) {
    if (this.result?.status !== 'accepted') throw new Error('The reader did not accept the supplied specification.');
    const model = new LangiumModel(this.result.document.source.sourceId, this.result.document);
    return model.nodes('concept').map(declaration => model.node(declaration.name, 'name')).find(item => item.decoded === name);
  }
}
