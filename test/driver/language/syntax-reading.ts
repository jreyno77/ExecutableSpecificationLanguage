import { LangiumReader, LangiumModel, type AcceptedDocument } from '../../../src/index.js';

export function readSyntax(text: string, sourceId = 'memory:example') {
  return new LangiumReader().read({ sourceId, text });
}
export function modelOf(document: AcceptedDocument) {
  return new LangiumModel(document.source.sourceId, document);
}
