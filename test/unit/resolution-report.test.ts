import { describe, expect, it } from 'vitest';
import { createSyntaxReader, DescriptionInspection, Resolver, ResolutionQueryError, type Inspection } from '../../src/index.js';

function source(text: string): Inspection {
  const read = createSyntaxReader().read({ sourceId: 'report.expec', text });
  if (read.status !== 'accepted') throw new Error('The report example must be grammatical');
  return new DescriptionInspection(read.description);
}

describe('a consumer retains resolution facts independently of inspection', () => {
  it('can read a reference target after the supplied inspection becomes unavailable', () => {
    const inspection = source('type Message { body: Text }');
    const reference = [...inspection.nodes('reference')][0]!;
    let available = true;
    const collaborator = new Proxy(inspection, {
      get(target, property, receiver) {
        if (!available) throw new Error('Inspection is no longer available');
        return Reflect.get(target, property, receiver);
      },
    });
    const report = new Resolver().resolve(collaborator, { modules: [], packages: [] });
    available = false;

    const binding = report.binding(reference.id);
    expect(binding.status).toBe('bound');
    if (binding.status !== 'bound') throw new Error('Expected the authored Text use to resolve');
    expect(report.declaration(binding.target)).toMatchObject({
      name: 'Text', kind: 'builtin-type', origin: { kind: 'builtin', name: 'Text' },
    });
    expect(report.problems).toEqual([]);
    expect([...report.declarations()].map(declaration => declaration.name)).toContain('Message');
  });

  it('does not accept a declaration identity owned by an earlier report', () => {
    const inspection = source('type Message { body: Text }');
    const resolver = new Resolver();
    const first = resolver.resolve(inspection, { modules: [], packages: [] });
    const earlier = [...first.declarations()].find(declaration => declaration.name === 'Message');
    expect(earlier, 'The first report contains Message').toBeDefined();
    if (!earlier) throw new Error('Expected Message to have a declaration identity');

    const second = resolver.resolve(inspection, { modules: [], packages: [] });

    expect(() => second.declaration(earlier.id)).toThrow(ResolutionQueryError);
    try { second.declaration(earlier.id); } catch (error) {
      expect(error).toMatchObject({ code: 'unknown-declaration' });
    }
  });
});

