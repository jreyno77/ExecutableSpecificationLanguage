import { describe, it } from 'vitest';
import { PreviewExample } from '../../../dsl/project/output/preview.js';
import { DiagramExamples } from '../../../dsl/project/output/diagrams.js';

describe('compact promises on architectural operations', () => {
  it('exposes each operation and its exact promises without displaying full rows', async () => {
    const preview = PreviewExample.specify(`component Relay {
  public send
  capability send() returns Nothing {
    promises "Delivers the result"
    promises "Can be cancelled"
  }
  capability cache() returns Nothing { promises "Keeps a local copy" }
  capability inspect() returns Nothing
}`);
    await preview.show('uml', { directory: 'draft/uml', views: ['structure'] });
    preview.expectDiagramPromises('draft/uml/structure.svg', [
      { label: 'Relay.send', promises: ['Delivers the result', 'Can be cancelled'] },
      { label: 'Relay.cache', promises: ['Keeps a local copy'] },
    ]);
    preview.expectPromiseAnchorsOnActualRows('draft/uml/structure.svg', ['Relay.send', 'Relay.cache']);
    preview.expectNoVisiblePromises('draft/uml/structure.svg', [
      'Delivers the result', 'Can be cancelled', 'Keeps a local copy',
    ]);
    preview.expectNoFindings('uml');
  });

  it('retains full promises in the static image fallback and Markdown', async () => {
    const preview = PreviewExample.specify(`component Relay {
  capability send() returns Nothing { promises "Delivers the result" }
}`);
    await preview.show('uml', { directory: 'draft/uml', views: ['structure'] });
    preview.expectStaticSvgPromises('draft/uml/structure.svg', ['send', 'Delivers the result']);
    preview.expectDocument('uml', 'draft/uml/structure.d2', 'text/vnd.d2', 'tooltip:');
    preview.expectNoVisiblePromises('draft/uml/structure.svg', ['Delivers the result']);
    await preview.show('markdown', { directory: 'draft/docs' });
    preview.expectDocument('markdown', 'draft/docs/pages/book.md', 'text/markdown', 'Delivers the result');
  });

  it('keeps an authored empty promise and literal text on a top-level function', async () => {
    const preview = PreviewExample.specify(`function describe() returns Text {
  promises ""
  promises "Keep  two spaces and <literal> text; <script>alert(1)</script>"
}`);
    await preview.show('uml', { directory: 'draft/uml', views: ['structure'] });
    preview.expectDiagramPromises('draft/uml/structure.svg', [
      { label: 'describe', promises: ['', 'Keep  two spaces and <literal> text; <script>alert(1)</script>'] },
    ]);
    preview.expectPromiseAnchorsOnActualRows('draft/uml/structure.svg', ['describe']);
    preview.expectStaticSvgPromises('draft/uml/structure.svg', ['Keep  two spaces and <literal> text; <script>alert(1)</script>']);
    preview.expectNoActiveSvgMarkup('draft/uml/structure.svg');
  });

  it('gives operations without promise clauses an empty annotation list', async () => {
    const preview = PreviewExample.specify(`component Relay {
  capability inspect() returns Nothing
}`);
    await preview.show('uml', { directory: 'draft/uml', views: ['structure'] });
    preview.expectDiagramPromises('draft/uml/structure.svg', []);
  });

  it('uses the actual image origin and rows beneath a wide architectural title', async () => {
    const preview = PreviewExample.specify(`component \`Long architectural title with a readable name\` {
  capability first() returns Nothing
  capability second() returns Nothing { promises "A short promise" }
  capability third() returns Nothing { promises "Another promise" }
}`);
    await preview.show('uml', { directory: 'draft/uml', views: ['structure'] });
    preview.expectPromiseAnchorsOnActualRows('draft/uml/structure.svg', [
      'Long architectural title with a readable name.second', 'Long architectural title with a readable name.third',
    ]);
  });

  it('gives a type-only source a valid empty annotated image', async () => {
    const preview = PreviewExample.specify('type Payload { text: Text }');
    await preview.show('uml', { directory: 'draft/uml', views: ['structure'] });
    preview.expectDiagramPromises('draft/uml/structure.svg', []);
    preview.expectNoFindings('uml');
  });
});

describe('owned compact promise diagrams retain their relationships', { timeout: 30_000 }, () => {
  it('updates static promises without losing call endpoints, identities or handwritten notes', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify(`component Courier {
  public ship
  capability ship() returns Nothing
}
component Relay {
  capability export() returns Nothing {
    calls Courier.ship
    promises "Delivers the result"
  }
}`);
    await diagrams.create({ views: ['structure'] });
    diagrams.rememberNativeKey('Relay');
    await diagrams.append('design/structure.d2', '\n# Keep this delivery note.\r\n');
    diagrams.revise(`component Courier {
  public ship
  capability ship() returns Nothing
}
component Relay {
  capability export() returns Nothing {
    calls Courier.ship
    promises "Delivers the result and confirms receipt"
  }
}`);
    await diagrams.update();
    diagrams.expectPromiseSection('Relay', 'export', ['Delivers the result and confirms receipt']);
    diagrams.expectNativeKeyUnchanged('Relay');
    diagrams.expectFileEndsWithBytes('design/structure.d2', '\n# Keep this delivery note.\r\n');
    diagrams.expectSvgDigestMatchesActualSource('design/structure.svg', 'design/structure.d2');
    await diagrams.search('Relay.export');
    diagrams.expectOutgoingTo('Courier.ship');
    diagrams.expectCompleteWithinNativeProfile();
    await diagrams.search('Courier.ship');
    diagrams.expectIncomingDeclaredOccurrence('Relay.export');
    await diagrams.update();
    diagrams.expectUnchanged();
  });
});
