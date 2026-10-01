import { LangiumModel, LangiumReader, type ReadResult, type SourceDocument } from '../../src/index.js';

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
  conceptName(name: string) {
    if (this.result?.status !== 'accepted') throw new Error('The reader did not accept the supplied specification.');
    const model = new LangiumModel(this.result.document.source.sourceId, this.result.document);
    return model.nodes('concept').map(declaration => model.node(declaration.name, 'name')).find(item => item.decoded === name);
  }
}
