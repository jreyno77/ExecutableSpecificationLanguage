import { describe, expect, it } from 'vitest';
import { LangiumModel, LangiumReader, QueryInspection, type Model, type NodeKind } from '../../../src/index.js';

function sourceModel(text: string): LangiumModel {
  const read = new LangiumReader().read({ sourceId: 'model.expec', text });
  if (read.status !== 'accepted') throw new Error(JSON.stringify(read.diagnostics));
  return new LangiumModel('model', read.document);
}
function forbidScanningKind(model: Model, kind: NodeKind): void {
  for (const node of model.nodes(kind)) Object.defineProperty(node, 'kind', {
    get() { throw new Error('A completed kind index must not inspect unrelated nodes.'); },
  });
}

describe('generated source models supply indexed readable facts', () => {
  it('answers capability queries without scanning unrelated declarations after indexing', () => {
    const model = sourceModel('type Hidden = Text\nconcept Store { capability save(value: Number) }');
    forbidScanningKind(model, 'alias-type-declaration');

    const capabilities = [...new QueryInspection(model).query('capability')];

    expect(capabilities.map(capability => capability.name)).toEqual(['save']);
    expect(capabilities[0]!.parameters.map(parameter => parameter.name)).toEqual(['value']);
  });

  it('retains authored operator spans in readable unary and binary expressions', () => {
    const inspection = new QueryInspection(sourceModel('examples { example "math": -2 + 3 => 1 }'));

    const unary = [...inspection.query('unary-expression')][0]!;
    const binary = [...inspection.query('binary-expression')][0]!;

    expect(unary.operatorRange).toEqual({ sourceId: 'model.expec',
      start: { offset: 27, line: 1, column: 28 }, end: { offset: 28, line: 1, column: 29 } });
    expect(binary.operatorRange).toEqual({ sourceId: 'model.expec',
      start: { offset: 30, line: 1, column: 31 }, end: { offset: 31, line: 1, column: 32 } });
  });
});
