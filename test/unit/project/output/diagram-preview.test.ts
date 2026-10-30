import { describe, expect, it } from 'vitest';
import { Compiler, Outputs, type Check, type DiagramPreview, type OutputPreviewDocument } from '../../../../src/index.js';

const source = new Compiler().compile({ locator: 'relay', source: { sourceId: 'relay.expec', text: 'component Relay {}' }, dependencies: { modules: [], packages: [] } }).value!;
const annotation = () => ({ id: 'send', label: 'Relay.send', x: 20, y: 80, width: 260, height: 30, promises: ['Delivers the result'] });
const diagram = () => ({ width: 300, height: 200, promises: [annotation()] });
function provider(value: unknown, mediaType = 'image/svg+xml') {
  const outputs = new Outputs();
  outputs.register({ id: 'draft', validate: () => [], open: () => { throw Error('Preview must not open a project adapter'); },
    preview: async () => ({ value: [{ path: 'draft/diagram.svg', mediaType, bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"/>'), diagram: value }],
      problems: [], deferred: [] }) as Check<readonly OutputPreviewDocument[]> });
  return outputs;
}

describe('the optional diagram presentation contract', () => {
  it('owns promise lists and coordinates independently of the provider and earlier callers', async () => {
    const supplied = diagram(), outputs = provider(supplied);
    const first = await outputs.preview('draft', {}, source);
    supplied.promises[0]!.promises[0] = 'changed by provider';
    expect(first.value?.documents[0]?.diagram?.promises[0]?.promises).toEqual(['Delivers the result']);
    const captured = first.value!.documents[0]!.diagram as unknown as { promises: { y: number; promises: string[] }[] };
    captured.promises[0]!.y = 1;
    captured.promises[0]!.promises.push('changed by caller');
    const second = await outputs.preview('draft', {}, source);
    expect(second.value?.documents[0]?.diagram?.promises).toEqual([{
      id: 'send', label: 'Relay.send', x: 20, y: 80, width: 260, height: 30, promises: ['changed by provider'],
    }]);
  });

  it('allows an empty annotation list and preserves an authored empty promise string', async () => {
    const empty = await provider({ width: 300, height: 200, promises: [] }).preview('draft', {}, source);
    expect(empty.value?.documents[0]?.diagram).toEqual({ width: 300, height: 200, promises: [] });
    const supplied: DiagramPreview = { width: 300, height: 200, promises: [{ ...annotation(), promises: [''] }] };
    expect((await provider(supplied).preview('draft', {}, source)).value?.documents[0]?.diagram).toEqual(supplied);
  });

  it('rejects a region extending beyond the image surface', async () => {
    await expect(provider({ width: 300, height: 200, promises: [{ ...annotation(), x: 280, width: 40 }] }).preview('draft', {}, source)).rejects.toBeInstanceOf(TypeError);
  });
  it('rejects a region above the image surface', async () => {
    await expect(provider({ width: 300, height: 200, promises: [{ ...annotation(), y: -1 }] }).preview('draft', {}, source)).rejects.toBeInstanceOf(TypeError);
  });
  it('rejects a zero-size operation region', async () => {
    await expect(provider({ width: 300, height: 200, promises: [{ ...annotation(), width: 0 }] }).preview('draft', {}, source)).rejects.toBeInstanceOf(TypeError);
  });
  it('rejects a nonfinite image dimension', async () => {
    await expect(provider({ width: Number.NaN, height: 200, promises: [annotation()] }).preview('draft', {}, source)).rejects.toBeInstanceOf(TypeError);
  });
  it('rejects duplicate operation identities', async () => {
    await expect(provider({ width: 300, height: 200, promises: [annotation(), { ...annotation(), y: 120 }] }).preview('draft', {}, source)).rejects.toBeInstanceOf(TypeError);
  });
  it('rejects an empty operation identity', async () => {
    await expect(provider({ width: 300, height: 200, promises: [{ ...annotation(), id: '' }] }).preview('draft', {}, source)).rejects.toBeInstanceOf(TypeError);
  });
  it('rejects an empty operation label', async () => {
    await expect(provider({ width: 300, height: 200, promises: [{ ...annotation(), label: '' }] }).preview('draft', {}, source)).rejects.toBeInstanceOf(TypeError);
  });
  it('rejects an operation without any promise clauses', async () => {
    await expect(provider({ width: 300, height: 200, promises: [{ ...annotation(), promises: [] }] }).preview('draft', {}, source)).rejects.toBeInstanceOf(TypeError);
  });
  it('rejects nontext promises', async () => {
    await expect(provider({ width: 300, height: 200, promises: [{ ...annotation(), promises: [7] }] }).preview('draft', {}, source)).rejects.toBeInstanceOf(TypeError);
  });
  it('rejects undocumented image presentation fields', async () => {
    await expect(provider({ ...diagram(), revision: 1 }).preview('draft', {}, source)).rejects.toBeInstanceOf(TypeError);
  });
  it('rejects undocumented operation fields', async () => {
    await expect(provider({ width: 300, height: 200, promises: [{ ...annotation(), execute: 'send' }] }).preview('draft', {}, source)).rejects.toBeInstanceOf(TypeError);
  });
  it('rejects presentation data attached to a Markdown document', async () => {
    await expect(provider(diagram(), 'text/markdown').preview('draft', {}, source)).rejects.toBeInstanceOf(TypeError);
  });
});
